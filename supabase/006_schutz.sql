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
