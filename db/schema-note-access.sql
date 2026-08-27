-- Policies for note_access_log.
--
-- Applied after schema-people-growth.sql, which creates the table and the
-- app_current_user() / app_reads_all_notes() functions this file uses.
--
-- Why this is a separate file rather than three lines added to that one: it was
-- found later, and for a reason worth writing down.
--
-- Supabase enables row-level security on every table in `public` by default. A
-- table with RLS enabled and no policies is not open — it is closed to
-- everyone, completely. That was invisible for as long as the application
-- connected as `postgres`, which carries BYPASSRLS and ignores the whole
-- mechanism, and it surfaced the moment lib/db.ts started switching to an
-- unprivileged role so that the policies on the other four tables would
-- actually apply. The first write to this table then failed with
-- "new row violates row-level security policy", which is the correct behaviour
-- of a table nobody had granted access to.
--
-- The three tables next to it — goal, one_on_one, feedback_note — were already
-- policed. This one was not, because it is written by the platform rather than
-- by a person, and writes by the platform were invisibly privileged.

alter table note_access_log enable row level security;
alter table note_access_log force  row level security;

-- Re-appliable. CREATE POLICY has no IF NOT EXISTS, and this file is meant to
-- be safe to run against a database that already has these.
drop policy if exists note_access_read  on note_access_log;
drop policy if exists note_access_write on note_access_log;

-- The subject reads their own log, and the CTO can read it too.
--
-- This is the row that makes "the CTO can read every 1:1" acceptable rather
-- than quietly corrosive: the person the notes are about can see who opened
-- them. A log that the subject cannot read would be surveillance of the reader
-- and nothing else, which is the opposite of the point.
create policy note_access_read on note_access_log for select using (
  subject_id = app_current_user()
  or app_reads_all_notes()
);

-- You may record a read you performed, and no other kind.
--
-- Not "any signed-in user may insert": the reader_id is the whole content of
-- the row, and a log where anyone can write anyone else's name is not evidence
-- of anything. There is deliberately no UPDATE or DELETE policy — an access log
-- that can be edited afterwards is worse than no access log.
create policy note_access_write on note_access_log for insert with check (
  reader_id = app_current_user()
);

-- bigserial. Without this the insert fails on the sequence rather than on the
-- table, and the message names neither.
grant usage, select on sequence note_access_log_id_seq to authenticated;
