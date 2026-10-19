-- Wisch-Wanda: Datenbank für den Familien-Sync (Supabase)
-- Einmal komplett im Supabase „SQL Editor“ ausführen.
--
-- Prinzip: Jedes Handy meldet sich anonym an. Wer den Einladungscode einer
-- Familie kennt, wird Mitglied und sieht nur die Daten dieser Familie.

-- ---------- Tabellen ----------

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Unsere Familie' check (char_length(name) <= 80),
  invite_code text not null unique,
  room_names jsonb not null default '{}',
  goal jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table public.household_users (
  household_id uuid not null references public.households on delete cascade,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table public.members (
  household_id uuid not null references public.households on delete cascade,
  id text not null,
  name text not null check (char_length(name) <= 40),
  emoji text not null default '🙂' check (char_length(emoji) <= 16),
  created_at timestamptz not null default now(),
  primary key (household_id, id)
);

create table public.tasks (
  household_id uuid not null references public.households on delete cascade,
  id text not null,
  room text not null,
  name text not null check (char_length(name) <= 120),
  interval int not null check (interval between 1 and 365),
  effort int not null check (effort between 1 and 5),
  last_done date,
  primary key (household_id, id)
);

create table public.completions (
  household_id uuid not null references public.households on delete cascade,
  id text not null,
  task_id text,
  title text check (char_length(title) <= 120),
  date date not null,
  member_id text,
  points int not null check (points between 0 and 500),
  assignment_id text,
  created_at timestamptz not null default now(),
  primary key (household_id, id)
);
-- Eine Katalog-Aufgabe kann pro Tag nur einmal erledigt werden.
create unique index completions_task_per_day on public.completions (household_id, task_id, date) where task_id is not null;

create table public.assignments (
  household_id uuid not null references public.households on delete cascade,
  id text not null,
  task_id text,
  title text check (char_length(title) <= 120),
  points int not null default 10 check (points between 0 and 500),
  to_member text not null,
  from_member text,
  due_date date,
  note text check (char_length(note) <= 300),
  created_at timestamptz not null default now(),
  done_at date,
  done_by text,
  completion_id text,
  primary key (household_id, id)
);

create table public.plans (
  household_id uuid not null references public.households on delete cascade,
  date date not null,
  plan jsonb not null,
  primary key (household_id, date)
);

-- ---------- Zugriffsregeln ----------

create function public.is_household_member(hid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from household_users where household_id = hid and user_id = auth.uid());
$$;

alter table public.households enable row level security;
alter table public.household_users enable row level security;
alter table public.members enable row level security;
alter table public.tasks enable row level security;
alter table public.completions enable row level security;
alter table public.assignments enable row level security;
alter table public.plans enable row level security;

create policy "Familie liest" on public.households for select to authenticated using (public.is_household_member(id));
create policy "Familie ändert" on public.households for update to authenticated
  using (public.is_household_member(id)) with check (public.is_household_member(id));

create policy "eigene Mitgliedschaft sehen" on public.household_users for select to authenticated using (user_id = auth.uid());
create policy "Familie verlassen" on public.household_users for delete to authenticated using (user_id = auth.uid());

create policy "Familie" on public.members for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
create policy "Familie" on public.tasks for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
create policy "Familie" on public.completions for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
create policy "Familie" on public.assignments for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
create policy "Familie" on public.plans for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));

-- ---------- Familie gründen / beitreten ----------

create function public.create_household(p_name text)
returns public.households
language plpgsql security definer set search_path = public
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- ohne 0/O und 1/I
  u bytea;
  code text;
  i int;
  h households;
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet' using errcode = '42501';
  end if;
  loop
    u := uuid_send(gen_random_uuid());
    code := '';
    foreach i in array array[0, 1, 2, 3, 4, 5, 10, 11] loop
      code := code || substr(alphabet, 1 + get_byte(u, i) % 32, 1);
    end loop;
    exit when not exists (select 1 from households where invite_code = code);
  end loop;
  insert into households (name, invite_code)
    values (coalesce(nullif(trim(p_name), ''), 'Unsere Familie'), code)
    returning * into h;
  insert into household_users (household_id, user_id) values (h.id, auth.uid());
  return h;
end;
$$;

create function public.join_household(p_code text)
returns public.households
language plpgsql security definer set search_path = public
as $$
declare
  h households;
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet' using errcode = '42501';
  end if;
  select * into h from households where invite_code = upper(regexp_replace(p_code, '[^A-Za-z0-9]', '', 'g'));
  if not found then
    raise exception 'Code nicht gefunden' using errcode = 'P0002';
  end if;
  insert into household_users (household_id, user_id) values (h.id, auth.uid()) on conflict do nothing;
  return h;
end;
$$;

revoke execute on function public.is_household_member(uuid) from public, anon;
revoke execute on function public.create_household(text) from public, anon;
revoke execute on function public.join_household(text) from public, anon;
grant execute on function public.is_household_member(uuid) to authenticated;
grant execute on function public.create_household(text) to authenticated;
grant execute on function public.join_household(text) to authenticated;

grant select, update on public.households to authenticated;
grant select, delete on public.household_users to authenticated;
grant select, insert, update, delete on public.members, public.tasks, public.completions, public.assignments, public.plans to authenticated;

-- ---------- Live-Aktualisierung ----------

alter publication supabase_realtime add table
  public.households, public.members, public.tasks, public.completions, public.assignments, public.plans;
