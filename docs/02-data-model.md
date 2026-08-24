# Data model

Four SQL files in `db/`, applied in this order. They are the schema of record —
do not create tables in application code.

| File | Contents |
|---|---|
| `schema.sql` | `app_user`, `agent_run`, `gh_event`, `commit_event`; views `cycle_time`, `review_latency` |
| `schema-people.sql` | Identity columns, `leave_request`, `leave_balance`, `notification_log`, `local_session`; views `leave_taken`, `on_leave_today` |
| `schema-people-growth.sql` | `goal`, `goal_evidence`, `one_on_one`, `feedback_note`, `note_access_log`; row-level security; view `goal_progress` |
| `schema-constraints.sql` | Normalises `gh_login`, then constrains it to a real GitHub username |

`schema-constraints.sql` runs last because it repairs data before it restricts
it. `gh_login` had been set to a full GitHub profile URL, and nothing rejected
it: the header rendered `@https://github.com/name` and looked merely untidy,
while every system that matches on a username had quietly stopped matching — PR
mentions addressed nobody, commit attribution found no user, and CODEOWNERS
never fired, so the approval rule the merge path depends on silently did not
apply. A wrong `gh_login` is worse than a missing one. A missing one is refused
at the door; a wrong one is accepted everywhere and works nowhere.

The file normalises URL, `@handle` and whitespace forms first, sets anything
still unusable to null rather than guessing, and only then adds the constraint —
in that order, because a constraint added over bad data fails with a message
about the constraint instead of about the data.

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
and FORCE are set. Unset context returns no rows — fail closed.

Session context is set per transaction, and **the context and the query must be
in the same transaction.** Use `withUser` from `lib/db.ts`:

```ts
import { withUser } from "@/lib/db";

const notes = await withUser(session.user.id, session.user.role, (tx) =>
  tx`select held_on, notes, agreed_actions from one_on_one where subject_id = ${id}`
);
```

Never this:

```ts
await sql`select set_config('app.user_id', ${id}, true)`;
await sql`select * from one_on_one`;          // <- a different transaction
```

The `true` argument makes the setting transaction-scoped, which is what stops it
leaking across a pooled connection to the next request. Any pooled driver —
Supabase's Supavisor, Neon's HTTP driver — treats each separate `sql` call as
its own transaction, so the second query above runs with no context at all. RLS
then does exactly what it should and returns nothing. **The failure is silent:**
zero rows reads as "this person has no notes", not as a bug, and it will not
look wrong until someone notices a person's history is permanently empty.

`db/rls-check.mjs` proves this holds. `npm run test:rls` with `DATABASE_URL`
set; it refuses to run without one, and refuses to run as a superuser, because
policies do not apply to superusers and a pass under one would mean nothing.

These four tables have no DELETE policy. Notes are append-only through the
application: the author may correct one for seven days, and nobody may remove
one. A note that can be quietly deleted is worse than no note.

## Erasure

Append-only is a design decision, not a position on the law. A person has a
right to erasure under the DPDP Act, and this schema does not implement it —
deliberately, because a delete button on a 1:1 is a delete button on the record
of what was said about someone, and the person most likely to want it gone is
rarely the subject.

So erasure is a human act with a paper trail. The CTO executes it as a direct
SQL statement against the database, outside the application, with a written
reason recorded alongside the request. Two properties follow, and both are the
point: it cannot happen by accident, and it cannot happen without someone's name
on it. If it were routine enough to build a screen for, it would be routine
enough to do quietly.

The same applies to a departing intern's `app_user` row. Deactivate with
`active = false`; do not delete. The row is referenced by `agent_run`,
`commit_event` attribution and every note, and removing it would rewrite history
that other people's records depend on.

`app_reads_all_notes()` currently returns true for `cto` only. Changing who can
read every 1:1 is a one-line change in that one function, deliberately.

## Rules

- Every query touching a person's data goes through `withUser`. Not "sets the
  context first" — in the same transaction, which is what `withUser` is for.
- Never `select *` from `one_on_one` in a shared context.
- Reads of a 1:1 by someone who is neither author nor subject insert a row in
  `note_access_log`. The subject can see that log.
