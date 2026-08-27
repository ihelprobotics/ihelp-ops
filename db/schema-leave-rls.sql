-- Row-level security for leave, and a read policy for the directory.
--
-- Applied after schema-people.sql and schema-people-growth.sql, which create
-- the tables and the app_current_user() / app_current_role() functions.
--
-- Why this file exists.
--
-- leave_request and leave_balance are scoped to a person: your dates, your
-- reason, your entitlement, and — in the case of sick leave — a fact about your
-- health. They had row-level security *enabled* and no policies at all, which
-- on Supabase is the default for every table in `public`. A table in that state
-- is closed to everyone, and the only reason the platform could read it is that
-- the application connects as `postgres`, which carries BYPASSRLS.
--
-- So the protection was entirely in app/lib/leave-data.ts scoping each query by
-- the id on the session. That is a coding convention, and docs/06 is explicit
-- that a convention is not what person-scoped data gets: "Fail closed on
-- anything scoped to a person. A bug that forgets to set the user must read
-- nothing, never everything."
--
-- After this file, forgetting the WHERE clause returns zero rows instead of
-- everybody's leave.

-- ---------------------------------------------------------------------------
-- The directory
-- ---------------------------------------------------------------------------
-- app_user is in the same state — RLS on, no policies — which matters here
-- because the approval queue joins it for the requester's name and lead, and
-- because a policy that has to ask "who leads this person" reads it too.
--
-- It is a directory, not a secret: /team already shows every colleague's name,
-- pod, role and tier to anyone signed in. So the read is open to any session
-- that has a user set, and closed to one that does not — which is the whole
-- fail-closed rule in one line.
--
-- There is deliberately no write policy. Accounts are created by the sign-in
-- callback and edited by whoever runs the platform, both of which connect as
-- the owner; anybody else writing to this table would be a bug, and without a
-- policy it is refused rather than merely discouraged.

alter table app_user enable row level security;

drop policy if exists app_user_read on app_user;
create policy app_user_read on app_user for select using (
  app_current_user() is not null
);

-- ---------------------------------------------------------------------------
-- Who may see somebody else's leave
-- ---------------------------------------------------------------------------
-- The CTO and the founder, for everyone. A lead, for the people whose
-- lead_email is theirs. Nobody else, and no role reads leave whose subject
-- cannot — the same shape as the 1:1 rule in schema-people-growth.sql.
create or replace function app_reads_all_leave() returns boolean language sql stable as $$
  select app_current_role() in ('cto', 'founder')
$$;

-- SECURITY DEFINER on purpose, and narrowly.
--
-- This has to read two app_user rows to answer, and it must keep answering
-- correctly whatever policies app_user grows later — a leave policy that
-- silently starts returning false because the directory tightened would hide
-- a lead's own team's requests from them with no error anywhere.
--
-- It returns a boolean and nothing else, takes one uuid, and pins search_path
-- so the tables it names cannot be shadowed by a schema earlier on the path.
create or replace function app_leads(subject uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
      from app_user s
      join app_user me on me.id = app_current_user()
     where s.id = subject
       and s.lead_email is not null
       and me.email is not null
       and lower(s.lead_email) = lower(me.email)
  )
$$;

revoke all on function app_leads(uuid) from public;
grant execute on function app_leads(uuid) to authenticated;
grant execute on function app_reads_all_leave() to authenticated;

-- ---------------------------------------------------------------------------
-- leave_request
-- ---------------------------------------------------------------------------
alter table leave_request enable row level security;
alter table leave_request force  row level security;

drop policy if exists leave_read       on leave_request;
drop policy if exists leave_book       on leave_request;
drop policy if exists leave_withdraw   on leave_request;
drop policy if exists leave_decide     on leave_request;

create policy leave_read on leave_request for select using (
  user_id = app_current_user()
  or app_reads_all_leave()
  or app_leads(user_id)
);

-- You book your own leave. There is no form field for whose it is, and now no
-- way to write somebody else's row even if one appeared.
create policy leave_book on leave_request for insert with check (
  user_id = app_current_user()
);

-- Withdrawing your own request, and only that.
--
-- USING picks the rows you may touch — your own, while still pending. WITH
-- CHECK constrains what they may become — cancelled, and still yours. Those two
-- halves together are what stop this policy from being "you may edit your own
-- leave", which would let anybody approve themselves by writing the status
-- directly.
create policy leave_withdraw on leave_request for update using (
  user_id = app_current_user() and status = 'pending'
) with check (
  user_id = app_current_user() and status = 'cancelled'
);

-- Deciding somebody else's. `user_id <> app_current_user()` is the same rule
-- canDecide() applies in app/lib/leave.ts, restated where it cannot be
-- forgotten: an approval is the record that somebody else knew, and a
-- self-approval records nothing at all.
create policy leave_decide on leave_request for update using (
  user_id <> app_current_user()
  and (app_reads_all_leave() or app_leads(user_id))
);

-- No DELETE policy, deliberately. Leave that can be quietly removed is worse
-- than leave that was never booked — cancelling is a status, and it is visible.

-- ---------------------------------------------------------------------------
-- leave_balance
-- ---------------------------------------------------------------------------
-- Read by the same three people. Written by nobody through the application:
-- an entitlement is agreed, then set by whoever runs the platform, which
-- connects as the owner. Without a write policy anything else is refused.
alter table leave_balance enable row level security;
alter table leave_balance force  row level security;

drop policy if exists balance_read on leave_balance;
create policy balance_read on leave_balance for select using (
  user_id = app_current_user()
  or app_reads_all_leave()
  or app_leads(user_id)
);

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- Policies decide which rows; grants decide whether the role may reach the
-- table at all. Supabase grants these by default, named here so that applying
-- this file to a fresh database is enough on its own.
grant select, insert, update on leave_request to authenticated;
grant select on leave_balance to authenticated;
grant select on app_user to authenticated;
grant select on on_leave_today, leave_taken to authenticated;
