-- iHelp platform schema.
--
-- Deliberately thin. GitHub remains the source of truth for issues, PRs and
-- commits. This database stores only what GitHub cannot: who asked for an agent
-- run, what it cost, and derived analytics we want to query quickly.
--
-- Mirroring GitHub state here would create a second version of the truth, and
-- then nobody knows which one is real.

create table if not exists app_user (
  id            uuid primary key default gen_random_uuid(),
  gh_login      text unique not null,
  name          text,
  role          text not null default 'member',   -- member | lead | cto | founder
  agent_tier    text not null default 'week1',    -- week1 | week2 | full
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz
);

-- One row per agent invocation. This is the platform's real subject matter.
create table if not exists agent_run (
  id             uuid primary key default gen_random_uuid(),
  requester_id   uuid not null references app_user(id),
  agent          text not null,
  repo           text not null,
  issue_number   int  not null,
  status         text not null default 'queued',  -- queued|running|success|failure|no_changes
  pr_url         text,
  logs_url       text,
  input_tokens   int,
  output_tokens  int,
  cost_usd       numeric(10,4),
  started_at     timestamptz not null default now(),
  finished_at    timestamptz
);

create index if not exists agent_run_requester_idx on agent_run(requester_id, started_at desc);
create index if not exists agent_run_issue_idx     on agent_run(repo, issue_number);

-- Mirror of GitHub events, written by the webhook. Analytics source.
create table if not exists gh_event (
  id             bigserial primary key,
  kind           text not null,        -- issue_opened | pr_opened | pr_merged | review_submitted
  repo           text not null,
  number         int,
  actor          text,
  agent_authored boolean default false,
  occurred_at    timestamptz not null,
  payload        jsonb
);

create index if not exists gh_event_kind_idx  on gh_event(kind, occurred_at desc);
create index if not exists gh_event_actor_idx on gh_event(actor, occurred_at desc);

-- Cycle time: issue opened to PR merged. The speed number that matters.
create or replace view cycle_time as
select
  o.repo,
  o.number                                   as issue_number,
  o.actor                                    as opened_by,
  o.occurred_at                              as opened_at,
  m.occurred_at                              as merged_at,
  extract(epoch from (m.occurred_at - o.occurred_at))/3600 as hours,
  m.agent_authored
from gh_event o
join gh_event m
  on m.repo = o.repo and m.number = o.number and m.kind = 'pr_merged'
where o.kind = 'issue_opened';

-- Review latency: PR opened to first human approval. Tells you the
-- second-reviewer gap is biting before anyone complains about it.
-- Postgres will not rename a view column through CREATE OR REPLACE, and this
-- one was called pr_number until gh_event.number became the task number
-- throughout. Dropping first is what lets this file be re-applied to a database
-- that already has the old shape.
drop view if exists review_latency;

create view review_latency as
select
  p.repo, p.number as task_number, p.actor as author,
  p.occurred_at as opened_at,
  min(r.occurred_at) as approved_at,
  extract(epoch from (min(r.occurred_at) - p.occurred_at))/3600 as hours
from gh_event p
left join gh_event r
  on r.repo = p.repo and r.number = p.number and r.kind = 'review_submitted'
where p.kind = 'pr_opened'
group by p.repo, p.number, p.actor, p.occurred_at;

-- There is deliberately no session, presence, or time-on-platform table.
-- Hours online are not a measure of anything this company wants more of, and
-- putting them on the same dashboard as artifacts teaches people to optimise
-- the wrong one.

-- Commits, attributed to a task by the iHelp-Task trailer that the
-- prepare-commit-msg hook writes. This is how work done locally in VS Code
-- becomes visible in the platform: not by watching the editor, but by reading
-- what was pushed.
create table if not exists commit_event (
  sha           text primary key,
  repo          text not null,
  author        text,
  branch        text,
  message       text,
  issue_number  int,
  committed_at  timestamptz not null
);

create index if not exists commit_event_author_idx on commit_event(author, committed_at desc);
create index if not exists commit_event_issue_idx  on commit_event(repo, issue_number);
