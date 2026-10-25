-- Wisch-Wanda: Beweisfotos bestätigen
-- Einmal im Supabase „SQL Editor“ ausführen (nach 006_schutz.sql). Mehrfaches Ausführen schadet nicht.
--
-- • Eltern dürfen eine Erledigung für jemand anderen eintragen – das passiert beim „👍 Passt“ auf ein Beweisfoto.
-- • Eine Reservierung (🙋) gilt weiter: abhaken kann nur, für wen die Aufgabe reserviert ist.
-- • Benachrichtigung, wenn ein Foto ankommt oder zurückgewiesen wird.

-- Hat heute jemand anderes als p_member diese Aufgabe übernommen?
create or replace function public.claimed_for_other(hid uuid, p_task text, p_title text, p_date date, p_member text)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from assignments a
    where a.household_id = hid and a.to_member = a.from_member and a.due_date = p_date and a.done_at is null
      and a.to_member is distinct from p_member
      and ((p_task is not null and a.task_id = p_task) or (p_task is null and a.task_id is null and a.title = p_title)))
$$;
revoke execute on function public.claimed_for_other(uuid, text, text, date, text) from public, anon;
grant execute on function public.claimed_for_other(uuid, text, text, date, text) to authenticated;

drop policy if exists "Abhaken" on public.completions;
create policy "Abhaken" on public.completions for insert to authenticated
  with check (public.is_household_member(household_id)
    and (member_id = public.my_member(household_id) or public.is_parent(household_id) or not public.has_parents(household_id))
    and not public.claimed_for_other(household_id, task_id, title, date, member_id));

-- Benachrichtigung auch bei neuem oder zurückgewiesenem Foto
create or replace function wanda_private.on_assignment_change()
returns trigger language plpgsql security definer set search_path = wanda_private
as $$
begin
  if tg_op = 'INSERT' or (new.done_at is not null and old.done_at is null)
     or (new.photo_path is distinct from old.photo_path and new.done_at is null) then
    perform call_push(jsonb_build_object(
      'type', lower(tg_op), 'table', 'assignments', 'household_id', new.household_id, 'id', new.id));
  end if;
  return null;
end;
$$;
