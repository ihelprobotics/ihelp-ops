-- People, leave and notifications.
--
-- One rule runs through this file: the platform records identity, absence and
-- delivery preferences. It does not record presence. Nothing here counts hours
-- or logins, because the moment a dashboard shows time-online next to merged
-- work, people optimise the easier number.

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------
-- People sign in with Google, because everyone has a work Gmail and
-- non-technical staff should not need a GitHub account to book leave.
--
-- But attribution lives in git. A commit is signed by a GitHub login, CODEOWNERS
-- is a list of GitHub logins, and a PR is approved by a GitHub login. So a
-- Google account alone cannot be attributed to any work.
--
-- Therefore: Google signs you in; a linked GitHub login is required before you
-- can start a task or run an agent. Unlinked accounts can read, book leave and
-- comment — nothing more. Without this the ledger fills with work nobody owns.

alter table app_user add column if not exists email          text unique;
alter table app_user add column if not exists google_sub     text unique;
alter table app_user add column if not exists gh_linked_at   timestamptz;
alter table app_user add column if not exists pod            text;      -- platform | eldercare-ev | spatial-apps
alter table app_user add column if not exists lead_email     text;
alter table app_user add column if not exists active         boolean not null default true;

-- gh_login stays the attribution key and must be unique; it is now nullable
-- so a non-technical person can hold an account without one.
alter table app_user alter column gh_login drop not null;

-- ---------------------------------------------------------------------------
-- Leave
-- ---------------------------------------------------------------------------
-- Leave is not only an HR record. It is an input to the Escalator: a person on
-- approved leave is not stalled, and flagging them is how an accountability
-- system loses the room.

create table if not exists leave_request (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references app_user(id),
  kind         text not null,                    -- planned | sick | unpaid | comp_off
  starts_on    date not null,
  ends_on      date not null,
  half_day     boolean not null default false,
  reason       text,
  status       text not null default 'pending',  -- pending | approved | rejected | cancelled
  decided_by   uuid references app_user(id),
  decided_at   timestamptz,
  decision_note text,
  created_at   timestamptz not null default now(),
  check (ends_on >= starts_on)
);

create index if not exists leave_user_idx  on leave_request(user_id, starts_on desc);
create index if not exists leave_range_idx on leave_request(starts_on, ends_on) where status = 'approved';

-- Annual entitlement, so the balance is a fact rather than an argument.
create table if not exists leave_balance (
  user_id      uuid not null references app_user(id),
  year         int  not null,
  entitled     numeric(4,1) not null default 12,
  carried_over numeric(4,1) not null default 0,
  primary key (user_id, year)
);

create or replace view leave_taken as
select
  l.user_id, extract(year from l.starts_on)::int as year,
  sum(case when l.half_day then 0.5 else (l.ends_on - l.starts_on) + 1 end) as days
from leave_request l
where l.status = 'approved' and l.kind in ('planned','unpaid')
group by l.user_id, extract(year from l.starts_on);

create or replace view on_leave_today as
select u.id as user_id, u.gh_login, u.name, l.kind, l.ends_on
from leave_request l
join app_user u on u.id = l.user_id
where l.status = 'approved'
  and current_date between l.starts_on and l.ends_on;

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------
create table if not exists notification_log (
  id          bigserial primary key,
  user_id     uuid references app_user(id),
  kind        text not null,      -- nudge | digest | leave_decision | escalation
  sent_to     text not null,
  subject     text,
  sent_at     timestamptz not null default now()
);

-- One nudge per person per day, at most. A system that emails twice about the
-- same thing gets filtered, and then it cannot reach anyone about anything.
--
-- The zone is written out rather than left to the server's. sent_at::date is
-- not IMMUTABLE — it depends on the session TimeZone — so Postgres refuses to
-- index it, and this whole file used to stop here, taking local_session with
-- it. Naming the zone makes the expression immutable and, more importantly,
-- fixes where the day boundary falls: the digest goes out at 18:00 IST, so
-- "one per day" has to mean one per Indian day. The lookup in
-- ops/lib/daily-email.mjs uses this identical expression, which is what lets it
-- use this index.
create unique index if not exists nudge_once_per_day
  on notification_log (user_id, kind, ((sent_at at time zone 'Asia/Kolkata')::date))
  where kind = 'nudge';

-- ---------------------------------------------------------------------------
-- Local agent sessions
-- ---------------------------------------------------------------------------
-- Reported by the Claude Code hooks in .claude/settings.json when someone runs
-- an agent in their own VS Code. Soft evidence: unauthenticated, best-effort,
-- and disableable by anyone who wants to. Use it for "how is the team using
-- agents", never for accountability. The hard record is the commit and the PR.

create table if not exists local_session (
  session_id       text primary key,
  user_id          uuid references app_user(id),
  repo             text,
  branch           text,
  issue_number     int,
  files_changed    int,
  duration_minutes numeric(8,1),
  started_at       timestamptz not null default now(),
  ended_at         timestamptz
);

create index if not exists local_session_user_idx  on local_session(user_id, started_at desc);
create index if not exists local_session_issue_idx on local_session(issue_number);
