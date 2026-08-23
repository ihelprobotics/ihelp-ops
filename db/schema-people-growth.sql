-- Goals, one-to-ones and feedback.
--
-- This is the most sensitive data in the platform. Visibility is enforced by
-- Postgres row-level security rather than by application code, for the same
-- reason tenant isolation is: an application filter is a coding convention that
-- one forgotten WHERE clause defeats, and here that mistake is somebody reading
-- a private conversation about a colleague.
--
-- Two rules run through the whole file:
--
--   1. Nothing is written about a person that the person cannot read. There are
--      no private manager files. This is enforced in the policies, not asked for
--      in a guideline.
--
--   2. Notes stay with the pair; outcomes leave it. What was said in a 1:1 is
--      visible to the two people in the room (and the CTO). What was agreed
--      becomes a goal or a task, which is visible normally.

-- ---------------------------------------------------------------------------
-- Session context. Set per transaction, exactly like the EV platform does.
-- Unset context returns nothing — fail closed, so a bug that forgets to set the
-- user reads no rows rather than every row.
-- ---------------------------------------------------------------------------
create or replace function app_current_user() returns uuid language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

create or replace function app_current_role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('app.user_role', true), ''), 'none')
$$;

-- Who may read every 1:1, including ones they did not write.
-- Currently the CTO alone. If the founder should also have this, add
-- 'founder' to the list here — it is deliberately one line, in one place.
create or replace function app_reads_all_notes() returns boolean language sql stable as $$
  select app_current_role() in ('cto')
$$;

-- ---------------------------------------------------------------------------
-- Goals — 30 / 60 / 90 day, matched to the internship clock
-- ---------------------------------------------------------------------------
create table if not exists goal (
  id            uuid primary key default gen_random_uuid(),
  subject_id    uuid not null references app_user(id),
  author_id     uuid not null references app_user(id),   -- the lead who set it
  cycle         text not null,                            -- day30 | day60 | day90 | custom
  starts_on     date not null,
  due_on        date not null,
  statement     text not null,
  status        text not null default 'open',             -- open | met | partly | missed | dropped
  closing_note  text,                                     -- written by a human, at the end
  closed_at     timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists goal_subject_idx on goal(subject_id, due_on desc);

-- Evidence: what actually happened, linked to the goal. Populated from GitHub
-- where an issue is already tied to the goal, and by hand otherwise.
create table if not exists goal_evidence (
  id         uuid primary key default gen_random_uuid(),
  goal_id    uuid not null references goal(id) on delete cascade,
  kind       text not null,          -- issue | pr | doc | demo | report
  url        text not null,
  label      text,
  landed     boolean default false,  -- merged, published, delivered
  added_at   timestamptz not null default now()
);

-- Deliberately a count of linked and landed evidence, never a score.
-- A percentage against a person's name is the completion meter again, attached
-- to a human instead of a task — and people optimise it far harder.
create or replace view goal_progress as
select
  g.id as goal_id, g.subject_id, g.cycle, g.statement, g.status, g.due_on,
  count(e.id)                                   as evidence_linked,
  count(e.id) filter (where e.landed)           as evidence_landed
from goal g
left join goal_evidence e on e.goal_id = g.id
group by g.id;

-- ---------------------------------------------------------------------------
-- One-to-ones
-- ---------------------------------------------------------------------------
create table if not exists one_on_one (
  id             uuid primary key default gen_random_uuid(),
  subject_id     uuid not null references app_user(id),
  author_id      uuid not null references app_user(id),   -- CTO or delivery manager
  held_on        date not null,
  notes          text,                                    -- stays with the pair
  agreed_actions text,                                    -- the part that leaves the room
  created_at     timestamptz not null default now()
);

create index if not exists one_on_one_subject_idx on one_on_one(subject_id, held_on desc);

-- ---------------------------------------------------------------------------
-- Feedback about a person — always readable by that person
-- ---------------------------------------------------------------------------
create table if not exists feedback_note (
  id          uuid primary key default gen_random_uuid(),
  subject_id  uuid not null references app_user(id),
  author_id   uuid not null references app_user(id),
  body        text not null,
  shared_at   timestamptz not null default now(),  -- when the subject could first see it
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table goal          enable row level security;
alter table goal          force  row level security;
alter table goal_evidence enable row level security;
alter table goal_evidence force  row level security;
alter table one_on_one    enable row level security;
alter table one_on_one    force  row level security;
alter table feedback_note enable row level security;
alter table feedback_note force  row level security;

-- Goals: the person, the lead who set it, and the CTO.
create policy goal_read on goal for select using (
  subject_id = app_current_user()
  or author_id = app_current_user()
  or app_reads_all_notes()
);
create policy goal_write on goal for insert with check (
  author_id = app_current_user() and app_current_role() in ('cto','lead','founder')
);
create policy goal_update on goal for update using (
  author_id = app_current_user() or app_reads_all_notes()
);

create policy goal_ev_read on goal_evidence for select using (
  exists (select 1 from goal g where g.id = goal_id and (
    g.subject_id = app_current_user() or g.author_id = app_current_user() or app_reads_all_notes()
  ))
);
create policy goal_ev_write on goal_evidence for insert with check (
  exists (select 1 from goal g where g.id = goal_id and (
    g.subject_id = app_current_user() or g.author_id = app_current_user()
  ))
);

-- One-to-ones. This is the policy that carries the whole design:
--
--   the subject      — always, for every note written about them
--   the author       — the notes they wrote
--   the CTO          — everything
--   the delivery lead— only what they wrote themselves
--
-- So the delivery manager cannot read the CTO's notes, and no lead can read
-- another lead's. There is no role that reads a note its subject cannot.
create policy one_on_one_read on one_on_one for select using (
  subject_id = app_current_user()
  or author_id = app_current_user()
  or app_reads_all_notes()
);
create policy one_on_one_write on one_on_one for insert with check (
  author_id = app_current_user() and app_current_role() in ('cto','lead','founder')
);
-- Only the author edits, and only for a week. A note quietly rewritten months
-- later is worse than no note.
create policy one_on_one_update on one_on_one for update using (
  author_id = app_current_user() and created_at > now() - interval '7 days'
);

create policy feedback_read on feedback_note for select using (
  subject_id = app_current_user()
  or author_id = app_current_user()
  or app_reads_all_notes()
);
create policy feedback_write on feedback_note for insert with check (
  author_id = app_current_user() and app_current_role() in ('cto','lead','founder')
);

-- ---------------------------------------------------------------------------
-- Access log
-- ---------------------------------------------------------------------------
-- Records when someone reads a 1:1 they neither wrote nor is about. Not
-- surveillance of the reader — the opposite. A person can see who has opened
-- notes about them, which is what makes "the CTO can read everything"
-- acceptable rather than quietly corrosive.
create table if not exists note_access_log (
  id         bigserial primary key,
  note_id    uuid not null,
  reader_id  uuid not null references app_user(id),
  subject_id uuid not null references app_user(id),
  read_at    timestamptz not null default now()
);

create index if not exists note_access_subject_idx on note_access_log(subject_id, read_at desc);
