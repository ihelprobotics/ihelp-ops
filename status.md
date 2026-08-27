# Status — 26 Aug 2026

Where the build stands, what is blocking, and what to do first tomorrow.

Repo: `ihelprobotics/ihelp-ops` (private) · branch `main`. Deployed at
**https://ihelp-ops.vercel.app**.

---

## Start here tomorrow

**Three things need a browser and a human. Together they are about five minutes.**

1. **Add the repository webhook.** Settings → Webhooks → Add webhook. Payload
   URL `https://ihelp-ops.vercel.app/api/webhooks/github`, content type
   `application/json`, secret = the same string as `GH_WEBHOOK_SECRET`, events:
   Issues, Pull requests, Pull request reviews, Pushes, Workflow runs. The route
   behind it is now proven correct end to end (`npm run test:webhook`, 38
   assertions), so this is the only thing standing between the board and moving
   progress bars.

2. **Give Vercel access to the repository.** Vercel cannot see
   `ihelprobotics/ihelp-ops`, so the project is not git-linked and every deploy
   is a file upload from a laptop. Install the Vercel GitHub App on the
   `ihelprobotics` org, grant it this repo, then `vercel link` again.

3. **Add the production redirect URI to Google.** Google Cloud Console →
   Credentials → the OAuth client → Authorised redirect URIs →
   `https://ihelp-ops.vercel.app/api/auth/callback/google`. Until it is there,
   the deployed UI cannot be signed into.

---

## What changed today

**Row-level security was not in force. It is now.**

`DATABASE_URL` connects as `postgres`, and on Supabase that role carries
BYPASSRLS. Every policy in `db/schema-people-growth.sql` was therefore inert on
the live connection: the 1:1 a delivery manager must not be able to read would
have come back to them, and nothing anywhere would have reported a problem.
`npm run test:rls` had been refusing to run rather than passing — it checks the
login role and correctly declined to prove anything about it.

`lib/db.ts` now switches role inside `withUser()`: `set local role
authenticated`, transaction-scoped exactly like the `set_config` calls beside
it, so the pooled connection is unchanged when the transaction ends.
`authenticated` is a Supabase built-in with no superuser bit, no BYPASSRLS, and
the table grants already in place — which is what let this be a fix with no new
credential behind it. Override with `DB_APP_ROLE` when the app gets a login role
of its own.

Nothing had leaked: `goal`, `one_on_one`, `feedback_note` and `note_access_log`
were all empty. Phase 6 is what starts filling them, so this was the last moment
it was free to fix.

**A second thing fell out of the first.** Supabase enables row-level security on
every table in `public` by default, and a table with RLS on and no policies is
closed to everyone. Nine tables are in that state, invisible for as long as
everything ran as `postgres`. `note_access_log` is the one Phase 6 needs, and it
now has policies of its own in `db/schema-note-access.sql`: the subject and the
CTO read the log, and you may record a read you performed and no other kind.
The other eight still read as `postgres` — see *Known* below.

---

## What is done and verified

**Phase 5 — the webhook route is correct.** `npm run test:webhook`, 38
assertions, real HTTP with real HMAC signatures against real Postgres:

- Unsigned, wrongly-signed, tampered and truncated deliveries are all refused
  401 and none of them writes a row.
- The ladder climbs 10 → 20 → 40 → 60 → 75 → 90 → 100, each rung observed
  rather than assumed.
- **Every event is filed under the issue number, never the pull request's.**
  This is the failure docs/09 Test 5 exists to catch: the events were delivered
  for issue 41 with the PR numbered 57, and all five rows carry 41.
- `cycle_time` and `review_latency` both return the row `/analytics` will read.
- The payload is stored as a jsonb object, not a string containing one.
- A pull request with no task branch links by its `Closes #n`; one with neither
  is stored as a gap rather than attached to the nearest number.
- A merge closes the `agent_run` behind it, with `pr_url` and `finished_at`.

What this does not prove is that GitHub is configured to send anything. That is
item 1 above.

**Phase 6 — built, and proven.** `/team`, `/leave`, `/me`, `/person/[id]`, plus
`POST /api/leave` and `POST /api/leave/[id]`.

- `npm run test:rls` — 12 assertions. The three docs/04 names all hold: a lead
  cannot read a 1:1 authored by the CTO, every subject reads every note about
  themselves, unset context returns zero rows.
- `npm run test:people` — 54 assertions. The leave rules; approved leave putting
  a person in `on_leave_today` and out of the digest's nudge list; `leave_taken`
  counting the same days `daysOf` does; the second nudge in a day refused by the
  index; and the person page's reads under the policies.
- `npm run test:pages` — 52 assertions. Signs in as a CTO, a lead and a member
  with real Auth.js session cookies and reads what each is served. A colleague's
  page does not contain the 1:1 they did not write, does contain the one they
  did, and says which rule made the difference. The CTO reading the lead's note
  logs exactly one row; reading their own logs none; the subject sees the log.

All four leave the database exactly as they found it, and assert that they did.

---

## Blocking

| | |
|---|---|
| Repository webhook not connected | `gh_event` is empty, every task reads 10%. One settings page |
| Vercel cannot see the repo | Deploys are slow uploads until the GitHub App is installed |
| Google redirect URI | Nobody can sign in to the deployment |
| `GH_DISPATCH_TOKEN` cannot read check runs | 403 on `/check-runs`. A fine-grained token needs **Checks: read**. The task page says so rather than guessing |
| `RESEND_API_KEY` and `DIGEST_TO` | Phase 7. The digest cannot send, so Test 7 parts 3 and 4 cannot be observed as mail |

---

## Known, deliberately not fixed

- **Eight tables have RLS enabled and no policies**, and are readable only
  because the app connects as a BYPASSRLS role: `app_user`, `agent_run`,
  `gh_event`, `commit_event`, `leave_request`, `leave_balance`,
  `notification_log`, `local_session`. Two of those — `leave_request` and
  `leave_balance` — are person-scoped and are today protected by application
  code alone, in `app/lib/leave-data.ts`, which scopes every query by the id on
  the session. That is one forgotten WHERE clause away from being wrong, and it
  is the next thing worth hardening.
- **A dedicated login role** would be better than `authenticated`. That needs a
  password and a change to `DATABASE_URL` in two places, which is a decision, not
  a refactor. `DB_APP_ROLE` is the seam.
- **`/api/agents/run` sends `Bearer undefined`** when `GH_DISPATCH_TOKEN` is
  unset. The 401 reaches the user; it just does not name the key.
- **The Reviewer's no-test rule blocks most PRs today.** Waivable via the PR body.
- **The Reviewer is deterministic shell, not a model.** Deliberate.
- **`ops/lib/mail.mjs` captures `RESEND_API_KEY` at module load.**
- **PR #2 is open and unmerged.** The scribe's `ops/README.md`, 144 lines.
- No clash detection in the leave queue: a lead approving cannot see who else
  from the pod is already away that week. Worth adding before the first holiday
  season, not before that.

---

## Not built yet

Phase 7 of `docs/04`: `/analytics`, and wiring `ops/daily-email.mjs` to a real
Resend key.

Acceptance tests in `docs/09`: Tests 5 and 7 are proven at every level the
platform controls. Test 5 finishes when a real push moves a real task; Test 7
parts 3 and 4 finish when mail can actually send.

---

## Suggested order

1. Repository webhook, then push a commit and watch a task pass 10%.
2. Vercel GitHub App, then `vercel link` — everything after this gets faster.
3. Google redirect URI, then sign in and read `/team`, `/leave` and `/me`.
4. `PAGE_URL=https://ihelp-ops.vercel.app npm run test:pages` — the same 52
   assertions against production.
5. Give `GH_DISPATCH_TOKEN` **Checks: read**.
6. Build Phase 7.
