-- Wisch-Wanda: Push-Benachrichtigungen
-- Einmal im Supabase „SQL Editor“ ausführen (nach schema.sql und 002_abfallkalender.sql).
-- Mehrfaches Ausführen schadet nicht.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- ---------- Wer möchte Benachrichtigungen? (ein Eintrag pro Handy) ----------

create table if not exists public.push_subscriptions (
  endpoint text primary key,
  household_id uuid not null references public.households on delete cascade,
  member_id text,
  p256dh text not null,
  auth text not null,
  remind_hour int check (remind_hour between 0 and 23), -- tägliche Erinnerung, null = aus
  waste boolean not null default true,                    -- Müll-Erinnerung am Vorabend
  updated_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;
drop policy if exists "Familie" on public.push_subscriptions;
create policy "Familie" on public.push_subscriptions for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- ---------- Interne Einstellungen (für die App unsichtbar) ----------

create schema if not exists wanda_private;
revoke all on schema wanda_private from public, anon, authenticated;

create table if not exists wanda_private.config (
  id int primary key default 1 check (id = 1),
  secret text not null,       -- schützt den Push-Dienst vor fremden Aufrufen
  function_url text not null,
  vapid_public text,          -- wird vom Push-Dienst beim ersten Start erzeugt
  vapid_private text
);

insert into wanda_private.config (secret, function_url)
values (
  replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  'https://gdbkdybfuppvczdtcakh.supabase.co/functions/v1/wanda-push'
)
on conflict (id) do nothing;

-- Nur der Push-Dienst (service_role) darf die Einstellungen lesen und die Schlüssel speichern.
create or replace function public.wanda_push_config()
returns jsonb language sql security definer set search_path = wanda_private
as $$ select to_jsonb(c) from config c where id = 1 $$;

create or replace function public.wanda_push_set_vapid(p_public text, p_private text)
returns void language sql security definer set search_path = wanda_private
as $$ update config set vapid_public = p_public, vapid_private = p_private where id = 1 and vapid_public is null $$;

revoke execute on function public.wanda_push_config() from public, anon, authenticated;
revoke execute on function public.wanda_push_set_vapid(text, text) from public, anon, authenticated;
grant execute on function public.wanda_push_config() to service_role;
grant execute on function public.wanda_push_set_vapid(text, text) to service_role;

-- ---------- Push-Dienst aufrufen ----------

create or replace function wanda_private.call_push(p_body jsonb)
returns void language plpgsql security definer set search_path = wanda_private, extensions
as $$
declare
  c config;
begin
  select * into c from config where id = 1;
  perform net.http_post(
    url := c.function_url,
    body := p_body,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-wanda-secret', c.secret),
    timeout_milliseconds := 10000
  );
end;
$$;
revoke execute on function wanda_private.call_push(jsonb) from public, anon, authenticated;

-- Neue oder erledigte zugeschickte Aufgabe → Benachrichtigung
create or replace function wanda_private.on_assignment_change()
returns trigger language plpgsql security definer set search_path = wanda_private
as $$
begin
  if tg_op = 'INSERT' or (new.done_at is not null and old.done_at is null) then
    perform call_push(jsonb_build_object(
      'type', lower(tg_op), 'table', 'assignments', 'household_id', new.household_id, 'id', new.id));
  end if;
  return null;
end;
$$;

drop trigger if exists wanda_push on public.assignments;
create trigger wanda_push after insert or update on public.assignments
  for each row execute function wanda_private.on_assignment_change();

-- Jede volle Stunde: Müll-Erinnerung (18 Uhr) und tägliche Erinnerungen
select cron.unschedule(jobid) from cron.job where jobname = 'wanda-stuendlich';
select cron.schedule('wanda-stuendlich', '0 * * * *', $$ select wanda_private.call_push('{"type":"hourly"}'::jsonb) $$);
