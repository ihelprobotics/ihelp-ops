-- Who changed whose role, when, and from what.
--
-- Applied after schema-people.sql and schema-leave-rls.sql, which create
-- app_user and the app_current_user() / app_reads_all_leave() functions.
--
-- Everything else in this platform is derived from an artifact: a branch, a
-- commit, a pull request, an approval. A role was the exception — it changed
-- because somebody set it, and the only record was the value itself. You could
-- see that a person was a lead; you could not see when that happened, who
-- decided it, or what they were before.
--
-- That is the same shape as the completion percentage this whole product exists
-- to refuse: a state with no evidence behind it. So the change becomes the
-- artifact, and the row below is it.
--
-- The subject can read their own history. That is not a nicety — docs/06:
-- "Nothing is written about a person that the person cannot read." A record of
-- somebody being demoted that they cannot see would be exactly the private
-- manager file this codebase does not have.

create table if not exists role_change (
  id          bigserial primary key,
  subject_id  uuid not null references app_user(id),
  actor_id    uuid not null references app_user(id),
  -- {"role": {"from": "member", "to": "lead"}, ...} — only fields that moved.
  -- jsonb rather than a column per field: the set of things an admin can change
  -- will grow, and a schema migration per field would mean the audit lags the
  -- thing it audits.
  changed     jsonb not null,
  changed_at  timestamptz not null default now()
);

create index if not exists role_change_subject_idx on role_change(subject_id, changed_at desc);
create index if not exists role_change_when_idx    on role_change(changed_at desc);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table role_change enable row level security;
alter table role_change force  row level security;

drop policy if exists role_change_read on role_change;

-- The person it is about, and the people who can make one. Nobody else: what
-- your role was last month is not a colleague's business.
create policy role_change_read on role_change for select using (
  subject_id = app_current_user()
  or app_reads_all_leave()
);

-- No INSERT, UPDATE or DELETE policy, deliberately. The row is written by
-- /api/admin/people/[id], which connects as the owner — and an audit trail that
-- the audited can edit is not one. Not even an admin can remove a line here
-- through the application.

grant select on role_change to authenticated;
