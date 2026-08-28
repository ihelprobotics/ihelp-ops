-- Conversations with the agents.
--
-- Applied after schema-people.sql and schema-leave-rls.sql, which create
-- app_user and the app_current_user() function.
--
-- This table is a deliberate exception to something the rest of the schema is
-- careful about, and it is worth being explicit rather than quiet.
--
-- db/schema-people.sql says of local_session: "Never what was typed." The
-- platform records that an editor session happened, on which branch, for how
-- long — and no content, because content is the part that turns a record into
-- surveillance.
--
-- A conversation cannot work that way. A chat with no history is not a chat; it
-- is a series of unrelated questions. So this is the one place the platform
-- stores what somebody typed, and three things make that acceptable:
--
--   It is yours alone. Not your lead's, not the CTO's, not the founder's. The
--   policy below has exactly one clause. This is your scratchpad, the same as a
--   terminal on your own laptop.
--
--   It is not a record of work. Progress still comes from artifacts. Nothing
--   said here moves a task, and nothing here is evidence of anything. If
--   something from a conversation matters, it goes on the task as a comment —
--   which is public, on the GitHub issue, and is the record.
--
--   It is deletable. Unlike a 1:1 note or an audit line, which must not be
--   quietly removable, you may delete your own conversation. A scratchpad you
--   cannot clear is not a scratchpad.

create table if not exists chat_thread (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references app_user(id) on delete cascade,
  repo          text not null,
  issue_number  int  not null,
  agent         text not null,
  created_at    timestamptz not null default now(),
  -- One conversation per person, per agent, per task. Opening the task again
  -- continues where you left off rather than starting somebody a new thread
  -- they did not ask for.
  unique (user_id, repo, issue_number, agent)
);

create table if not exists chat_message (
  id            bigserial primary key,
  thread_id     uuid not null references chat_thread(id) on delete cascade,
  role          text not null check (role in ('user', 'assistant')),
  content       text not null,
  -- What the exchange cost. The same discipline as agent_run: a conversation
  -- with an agent is money, and money that nobody can see is money nobody
  -- manages.
  input_tokens  int,
  output_tokens int,
  cost_usd      numeric(10,4),
  created_at    timestamptz not null default now()
);

create index if not exists chat_thread_user_idx  on chat_thread(user_id, created_at desc);
create index if not exists chat_thread_task_idx  on chat_thread(repo, issue_number);
create index if not exists chat_message_thread_idx on chat_message(thread_id, created_at);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table chat_thread  enable row level security;
alter table chat_thread  force  row level security;
alter table chat_message enable row level security;
alter table chat_message force  row level security;

drop policy if exists chat_thread_own   on chat_thread;
drop policy if exists chat_thread_write on chat_thread;
drop policy if exists chat_thread_gone  on chat_thread;
drop policy if exists chat_message_own   on chat_message;
drop policy if exists chat_message_write on chat_message;
drop policy if exists chat_message_gone  on chat_message;

-- Yours, and nobody else's. There is no admin clause on purpose: a founder who
-- can read every conversation every engineer has had with an agent is a
-- different product from this one.
create policy chat_thread_own on chat_thread for select using (
  user_id = app_current_user()
);
create policy chat_thread_write on chat_thread for insert with check (
  user_id = app_current_user()
);
create policy chat_thread_gone on chat_thread for delete using (
  user_id = app_current_user()
);

create policy chat_message_own on chat_message for select using (
  exists (select 1 from chat_thread t where t.id = thread_id and t.user_id = app_current_user())
);
create policy chat_message_write on chat_message for insert with check (
  exists (select 1 from chat_thread t where t.id = thread_id and t.user_id = app_current_user())
);
create policy chat_message_gone on chat_message for delete using (
  exists (select 1 from chat_thread t where t.id = thread_id and t.user_id = app_current_user())
);

-- No UPDATE policy on either. A message that can be edited after the fact is a
-- transcript nobody can rely on, including you.

grant select, insert, delete on chat_thread, chat_message to authenticated;
grant usage, select on sequence chat_message_id_seq to authenticated;
