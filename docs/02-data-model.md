# Data model

Three SQL files in `db/`, applied in this order. They are the schema of record —
do not create tables in application code.

| File | Contents |
|---|---|
| `schema.sql` | `app_user`, `agent_run`, `gh_event`, `commit_event`; views `cycle_time`, `review_latency` |
| `schema-people.sql` | Identity columns, `leave_request`, `leave_balance`, `notification_log`, `local_session`; views `leave_taken`, `on_leave_today` |
| `schema-people-growth.sql` | `goal`, `goal_evidence`, `one_on_one`, `feedback_note`, `note_access_log`; row-level security; view `goal_progress` |

## Core

**`app_user`** — `email` (Google, unique), `google_sub`, `gh_login` (nullable,
unique, the attribution key), `role` (member/lead/cto/founder), `agent_tier`
(week1/week2/full), `pod`, `lead_email`, `active`, `gh_linked_at`.

**`agent_run`** — one row per platform-dispatched run: `requester_id`, `agent`,
`repo`, `issue_number`, `status` (queued/running/success/failure/no_changes),
`pr_url`, `logs_url`, `input_tokens`, `output_tokens`, `cost_usd`.

**`gh_event`** — mirror of GitHub events for analytics: `kind` (issue_opened,
pr_opened, pr_merged, review_submitted), `repo`, `number`, `actor`,
`agent_authored`, `occurred_at`, `payload`.

**`commit_event`** — `sha` (primary key), `author`, `branch`, `message`,
`issue_number` parsed from the `iHelp-Task:` trailer, `committed_at`.

**`local_session`** — agent sessions on people's own machines. Soft evidence.

## Derived progress

Read from `gh_event`. Never stored on the task, never typed.

| Stage | % |
|---|---|
| Issue opened | 10 |
| Branch created | 20 |
| First commit | 40 |
| PR opened | 60 |
| Checks green | 75 |
| Human approved | 90 |
| Merged | 100 |

## Row-level security

Applies to `goal`, `goal_evidence`, `one_on_one`, `feedback_note`. Both ENABLE
and FORCE are set. Session context is set per transaction:

```sql
select set_config('app.user_id',   $1, true);
select set_config('app.user_role', $2, true);
```

`true` makes it transaction-scoped so it cannot leak across a pooled connection.
Unset context returns no rows — fail closed.

`app_reads_all_notes()` currently returns true for `cto` only. Changing who can
read every 1:1 is a one-line change in that one function, deliberately.

## Rules

- Every query touching a person's data sets session context first.
- Never `select *` from `one_on_one` in a shared context.
- Reads of a 1:1 by someone who is neither author nor subject insert a row in
  `note_access_log`. The subject can see that log.
