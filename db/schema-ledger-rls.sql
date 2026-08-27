-- Policies for the last five tables: the artifact ledger, and two records that
-- are about a person.
--
-- Applied after schema.sql, schema-people.sql and schema-leave-rls.sql, which
-- create the tables and the app_current_user() / app_leads() functions.
--
-- These are the tables left over after leave and notes were policed. They fall
-- into two groups, and the groups get different rules — which is the whole
-- reason this file is worth writing rather than blanket-opening everything.
--
--   The ledger — gh_event, commit_event, agent_run — records what happened in
--   GitHub and what it cost. It is not about a person in the way a 1:1 is: it
--   is the evidence the board and /analytics are computed from, and every
--   number derived from it is already visible to the whole team. Anyone signed
--   in reads it. Nobody writes it through a session.
--
--   notification_log and local_session are about a person. Being nudged means
--   you had nothing recorded that day; a local session says which branch you
--   sat on and for how long. Those get the same rule as leave: you, your lead,
--   and the CTO.
--
-- Every one of these tables is written by the platform itself — the webhook,
-- the agent callback, the digest, the Claude Code hooks — all of which connect
-- as the owner. So none of them gets an INSERT or UPDATE policy: a write
-- arriving from a user session would be a bug, and with no policy it is refused
-- rather than merely unexpected.

-- ---------------------------------------------------------------------------
-- The ledger
-- ---------------------------------------------------------------------------
-- Read by anyone signed in, and by nobody who is not. `app_current_user() is
-- not null` is the whole check: with no session context set the read returns
-- nothing, which is the fail-closed behaviour every other table here has.

alter table gh_event enable row level security;
drop policy if exists gh_event_read on gh_event;
create policy gh_event_read on gh_event for select using (
  app_current_user() is not null
);

alter table commit_event enable row level security;
drop policy if exists commit_event_read on commit_event;
create policy commit_event_read on commit_event for select using (
  app_current_user() is not null
);

-- agent_run carries cost against a requester's name. That is deliberately open
-- to the team: /analytics reports cost per person, because a number the company
-- is spending should not be something only the person spending it can see.
alter table agent_run enable row level security;
drop policy if exists agent_run_read on agent_run;
create policy agent_run_read on agent_run for select using (
  app_current_user() is not null
);

-- ---------------------------------------------------------------------------
-- The two that are about a person
-- ---------------------------------------------------------------------------
-- A nudge means "nothing was recorded against your name today". Who received
-- one, and how often, is exactly the kind of fact that should not be readable
-- across the team — it is the raw material for a conversation with your lead,
-- not for a comparison between colleagues.
--
-- The digest rows have a null user_id: they are addressed to a lead and are
-- about everybody, so they belong to no one person. Those stay closed to
-- everyone except the roles that receive them.
alter table notification_log enable row level security;
alter table notification_log force  row level security;
drop policy if exists notification_read on notification_log;
create policy notification_read on notification_log for select using (
  (user_id is not null and (
     user_id = app_current_user()
     or app_reads_all_leave()
     or app_leads(user_id)
  ))
  or (user_id is null and app_reads_all_leave())
);

-- Soft evidence, and the schema says so: unauthenticated, best-effort, and
-- disableable by anyone who wants to. docs/06 — use it for "how is the team
-- using agents", never for accountability. Same readers as a nudge.
alter table local_session enable row level security;
alter table local_session force  row level security;
drop policy if exists local_session_read on local_session;
create policy local_session_read on local_session for select using (
  user_id is not null and (
    user_id = app_current_user()
    or app_reads_all_leave()
    or app_leads(user_id)
  )
);

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- Policies decide which rows; grants decide whether the role reaches the table
-- at all. Read only, for all five — the platform writes them as the owner.
grant select on gh_event, commit_event, agent_run to authenticated;
grant select on notification_log, local_session to authenticated;

-- The views the application reads over these tables. A view runs with its
-- owner's row-level security, so these answer for the whole company by design:
-- cycle time and review latency are team numbers on /analytics, and there is no
-- per-person reading of them to protect.
grant select on cycle_time, review_latency, goal_progress to authenticated;
