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
