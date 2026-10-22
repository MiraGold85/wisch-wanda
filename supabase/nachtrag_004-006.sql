-- Wisch-Wanda: Nachtrag 004 + 005 + 006 in einem Rutsch (einmal im SQL Editor ausführen)

-- Wisch-Wanda: Eltern-Rechte und feste Handys
-- Einmal im Supabase „SQL Editor“ ausführen (nach schema.sql, 002 und 003).
-- Mehrfaches Ausführen schadet nicht.
--
-- Solange noch niemand als Eltern eingetragen ist, ändert sich nichts: Alle dürfen alles.
-- Wer die Familie gegründet hat, legt in der App fest, wer die Eltern sind.

-- ---------- Rollen und Handy-Bindung ----------

alter table public.members add column if not exists role text not null default 'child'
  check (role in ('parent', 'child'));
alter table public.household_users add column if not exists member_id text;

-- Einrichtungs-Codes: Damit übernimmt ein neues Handy eine Person, die schon vergeben ist.
create table if not exists public.member_codes (
  code text primary key,
  household_id uuid not null references public.households on delete cascade,
  member_id text not null,
  expires_at timestamptz not null default now() + interval '24 hours'
);
alter table public.member_codes enable row level security; -- nur über die Funktionen unten erreichbar

-- ---------- Hilfsfunktionen ----------

-- Welche Person ist dieses Handy?
create or replace function public.my_member(hid uuid)
returns text language sql stable security definer set search_path = public
as $$ select member_id from household_users where household_id = hid and user_id = auth.uid() $$;

create or replace function public.has_parents(hid uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from members where household_id = hid and role = 'parent') $$;

create or replace function public.is_parent(hid uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from household_users hu
    join members m on m.household_id = hu.household_id and m.id = hu.member_id
    where hu.household_id = hid and hu.user_id = auth.uid() and m.role = 'parent')
$$;

-- Das Handy, mit dem die Familie gegründet wurde (das älteste)
create or replace function public.is_founder(hid uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select auth.uid() = (select user_id from household_users where household_id = hid order by created_at, user_id limit 1)
$$;

-- Darf die Familie verwalten: Eltern – oder alle, solange es noch keine Eltern gibt.
create or replace function public.can_manage(hid uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select is_household_member(hid) and (is_parent(hid) or not has_parents(hid)) $$;

-- ---------- Zugriffsregeln neu ----------

drop policy if exists "Familie ändert" on public.households;
create policy "Familie ändert" on public.households for update to authenticated
  using (public.can_manage(id)) with check (public.can_manage(id));

drop policy if exists "eigene Mitgliedschaft sehen" on public.household_users;
create policy "eigene Mitgliedschaft sehen" on public.household_users for select to authenticated
  using (public.is_household_member(household_id));

drop policy if exists "Familie" on public.members;
drop policy if exists "Familie liest" on public.members;
drop policy if exists "Neue Person" on public.members;
drop policy if exists "Eltern ändern" on public.members;
drop policy if exists "Eltern löschen" on public.members;
create policy "Familie liest" on public.members for select to authenticated using (public.is_household_member(household_id));
-- Wer neu dazukommt, darf sich selbst als Kind anlegen
create policy "Neue Person" on public.members for insert to authenticated
  with check (public.is_household_member(household_id) and (public.can_manage(household_id) or role = 'child'));
create policy "Eltern ändern" on public.members for update to authenticated
  using (public.can_manage(household_id)) with check (public.can_manage(household_id));
create policy "Eltern löschen" on public.members for delete to authenticated using (public.can_manage(household_id));

drop policy if exists "Familie" on public.tasks;
drop policy if exists "Familie liest" on public.tasks;
drop policy if exists "Eltern verwalten" on public.tasks;
create policy "Familie liest" on public.tasks for select to authenticated using (public.is_household_member(household_id));
create policy "Eltern verwalten" on public.tasks for all to authenticated
  using (public.can_manage(household_id)) with check (public.can_manage(household_id));

-- Abhaken nur unter dem eigenen Namen
drop policy if exists "Familie" on public.completions;
drop policy if exists "Familie liest" on public.completions;
drop policy if exists "Eigene Erledigung" on public.completions;
create policy "Familie liest" on public.completions for select to authenticated using (public.is_household_member(household_id));
create policy "Eigene Erledigung" on public.completions for all to authenticated
  using (public.is_household_member(household_id) and (member_id = public.my_member(household_id) or public.can_manage(household_id)))
  with check (public.is_household_member(household_id) and (member_id = public.my_member(household_id) or public.can_manage(household_id)));

-- Zuschicken nur als man selbst; erledigen dürfen alle; zurückziehen Absender, Eltern – und liegen gebliebene „Übernehme ich“
drop policy if exists "Familie" on public.assignments;
drop policy if exists "Familie liest" on public.assignments;
drop policy if exists "Zuschicken" on public.assignments;
drop policy if exists "Erledigen" on public.assignments;
drop policy if exists "Zurückziehen" on public.assignments;
create policy "Familie liest" on public.assignments for select to authenticated using (public.is_household_member(household_id));
create policy "Zuschicken" on public.assignments for insert to authenticated
  with check (public.is_household_member(household_id) and (from_member = public.my_member(household_id) or public.can_manage(household_id)));
create policy "Erledigen" on public.assignments for update to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
create policy "Zurückziehen" on public.assignments for delete to authenticated
  using (public.is_household_member(household_id)
    and (from_member = public.my_member(household_id) or to_member = from_member or public.can_manage(household_id)));

-- Benachrichtigungen nur für sich selbst anmelden
drop policy if exists "Familie" on public.push_subscriptions;
drop policy if exists "Familie liest" on public.push_subscriptions;
drop policy if exists "Eigenes Handy" on public.push_subscriptions;
drop policy if exists "Eigenes Handy ändern" on public.push_subscriptions;
drop policy if exists "Abmelden" on public.push_subscriptions;
create policy "Familie liest" on public.push_subscriptions for select to authenticated using (public.is_household_member(household_id));
create policy "Eigenes Handy" on public.push_subscriptions for insert to authenticated
  with check (public.is_household_member(household_id) and member_id = public.my_member(household_id));
create policy "Eigenes Handy ändern" on public.push_subscriptions for update to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id) and member_id = public.my_member(household_id));
create policy "Abmelden" on public.push_subscriptions for delete to authenticated using (public.is_household_member(household_id));

-- ---------- Funktionen für die App ----------

-- Was darf dieses Handy?
create or replace function public.wanda_rights(p_household uuid)
returns jsonb language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'member', my_member(p_household),
    'is_parent', is_parent(p_household),
    'has_parents', has_parents(p_household),
    'is_founder', is_founder(p_household),
    'can_manage', can_manage(p_household))
  where is_household_member(p_household)
$$;

-- Dieses Handy als Person festlegen
create or replace function public.claim_member(p_household uuid, p_member text, p_code text default null)
returns void language plpgsql security definer set search_path = public
as $$
declare
  v_role text;
  v_taken boolean;
begin
  if not is_household_member(p_household) then
    raise exception 'Kein Mitglied dieser Familie' using errcode = '42501';
  end if;
  select role into v_role from members where household_id = p_household and id = p_member;
  if not found then
    raise exception 'Person nicht gefunden' using errcode = 'P0002';
  end if;
  if my_member(p_household) is not distinct from p_member then
    return;
  end if;
  v_taken := exists (select 1 from household_users where household_id = p_household and member_id = p_member and user_id <> auth.uid());
  if p_code is not null and p_code <> '' then
    delete from member_codes
      where code = upper(regexp_replace(p_code, '[^A-Za-z0-9]', '', 'g'))
        and household_id = p_household and member_id = p_member and expires_at > now();
    if not found then
      raise exception 'Code ungültig oder abgelaufen' using errcode = 'WW001';
    end if;
  elsif v_taken or (v_role = 'parent' and has_parents(p_household) and not is_founder(p_household)) then
    raise exception 'Für diese Person ist ein Einrichtungs-Code der Eltern nötig' using errcode = 'WW002';
  end if;
  update household_users set member_id = p_member where household_id = p_household and user_id = auth.uid();
end;
$$;

-- Einrichtungs-Code für ein neues Handy (nur Eltern)
create or replace function public.create_member_code(p_household uuid, p_member text)
returns text language plpgsql security definer set search_path = public
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  u bytea;
  v_code text := '';
  i int;
begin
  if not can_manage(p_household) then
    raise exception 'Nur Eltern können Codes erstellen' using errcode = '42501';
  end if;
  if not exists (select 1 from members where household_id = p_household and id = p_member) then
    raise exception 'Person nicht gefunden' using errcode = 'P0002';
  end if;
  delete from member_codes where expires_at < now();
  u := uuid_send(gen_random_uuid());
  foreach i in array array[0, 1, 2, 3, 4, 5] loop
    v_code := v_code || substr(alphabet, 1 + get_byte(u, i) % 32, 1);
  end loop;
  insert into member_codes (code, household_id, member_id) values (v_code, p_household, p_member);
  return v_code;
end;
$$;

-- Wer sind die Eltern? Beim ersten Mal darf das nur, wer die Familie gegründet hat.
create or replace function public.set_parents(p_household uuid, p_members text[])
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not (is_parent(p_household) or (is_household_member(p_household) and not has_parents(p_household) and is_founder(p_household))) then
    raise exception 'Nur Eltern können das festlegen' using errcode = '42501';
  end if;
  if coalesce(array_length(p_members, 1), 0) = 0 then
    raise exception 'Mindestens eine Person muss Eltern sein' using errcode = 'WW003';
  end if;
  update members set role = case when id = any (p_members) then 'parent' else 'child' end
    where household_id = p_household;
end;
$$;

revoke execute on function public.my_member(uuid), public.has_parents(uuid), public.is_parent(uuid),
  public.is_founder(uuid), public.can_manage(uuid), public.wanda_rights(uuid),
  public.claim_member(uuid, text, text), public.create_member_code(uuid, text), public.set_parents(uuid, text[])
  from public, anon;
grant execute on function public.my_member(uuid), public.has_parents(uuid), public.is_parent(uuid),
  public.is_founder(uuid), public.can_manage(uuid), public.wanda_rights(uuid),
  public.claim_member(uuid, text, text), public.create_member_code(uuid, text), public.set_parents(uuid, text[])
  to authenticated;

-- Wisch-Wanda: Beweisfotos für zugeschickte Aufgaben
-- Einmal im Supabase „SQL Editor“ ausführen. Mehrfaches Ausführen schadet nicht.

alter table public.assignments add column if not exists photo boolean not null default false; -- Foto verlangt
alter table public.assignments add column if not exists photo_path text;                        -- Foto im Speicher

-- Privater Speicher: Fotos liegen unter <familie>/<datei>.jpg, sehen kann sie nur die eigene Familie.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wanda-fotos', 'wanda-fotos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create or replace function public.photo_household(p_name text)
returns uuid language plpgsql immutable
as $$
begin
  return split_part(p_name, '/', 1)::uuid;
exception when others then
  return null;
end;
$$;

drop policy if exists "Wanda-Fotos ansehen" on storage.objects;
drop policy if exists "Wanda-Fotos hochladen" on storage.objects;
drop policy if exists "Wanda-Fotos löschen" on storage.objects;
create policy "Wanda-Fotos ansehen" on storage.objects for select to authenticated
  using (bucket_id = 'wanda-fotos' and public.is_household_member(public.photo_household(name)));
create policy "Wanda-Fotos hochladen" on storage.objects for insert to authenticated
  with check (bucket_id = 'wanda-fotos' and public.is_household_member(public.photo_household(name)));
create policy "Wanda-Fotos löschen" on storage.objects for delete to authenticated
  using (bucket_id = 'wanda-fotos' and public.is_household_member(public.photo_household(name)));

-- Wisch-Wanda: Reservierungen und Erledigungen schützen
-- Einmal im Supabase „SQL Editor“ ausführen (nach 004_eltern.sql). Mehrfaches Ausführen schadet nicht.
--
-- • Hat jemand eine Aufgabe mit 🙋 übernommen, kann nur diese Person sie heute abhaken.
-- • Den Haken einer Erledigung kann nur wegnehmen, wer sie erledigt hat – oder Eltern.
-- Das gilt sofort, auch wenn noch keine Eltern festgelegt sind.

-- Hat heute jemand anderes diese Aufgabe übernommen?
create or replace function public.claimed_by_other(hid uuid, p_task text, p_title text, p_date date)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from assignments a
    where a.household_id = hid and a.to_member = a.from_member and a.due_date = p_date and a.done_at is null
      and a.to_member is distinct from my_member(hid)
      and ((p_task is not null and a.task_id = p_task) or (p_task is null and a.task_id is null and a.title = p_title)))
$$;
revoke execute on function public.claimed_by_other(uuid, text, text, date) from public, anon;
grant execute on function public.claimed_by_other(uuid, text, text, date) to authenticated;

drop policy if exists "Eigene Erledigung" on public.completions;
drop policy if exists "Abhaken" on public.completions;
drop policy if exists "Abhaken ändern" on public.completions;
drop policy if exists "Haken entfernen" on public.completions;

-- Abhaken: unter dem eigenen Namen (vor dem Festlegen der Eltern auch für andere, z. B. beim
-- Hochladen der bisherigen Daten) – und nicht, wenn jemand anderes die Aufgabe übernommen hat.
create policy "Abhaken" on public.completions for insert to authenticated
  with check (public.is_household_member(household_id)
    and (member_id = public.my_member(household_id) or not public.has_parents(household_id))
    and not public.claimed_by_other(household_id, task_id, title, date));
create policy "Abhaken ändern" on public.completions for update to authenticated
  using (public.is_household_member(household_id) and (member_id = public.my_member(household_id) or public.is_parent(household_id)))
  with check (public.is_household_member(household_id) and (member_id = public.my_member(household_id) or public.is_parent(household_id)));
-- Haken wegnehmen: nur die eigene Erledigung – oder als Eltern
create policy "Haken entfernen" on public.completions for delete to authenticated
  using (public.is_household_member(household_id) and (member_id = public.my_member(household_id) or public.is_parent(household_id)));
