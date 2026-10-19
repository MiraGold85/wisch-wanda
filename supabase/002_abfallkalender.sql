-- Wisch-Wanda: Abfallkalender für die ganze Familie
-- Nur nötig, wenn schema.sql schon vor dem Abfallkalender ausgeführt wurde.
-- Einmal im Supabase „SQL Editor“ ausführen.
alter table public.households add column if not exists waste jsonb not null default '{}';
