# Status — 27 Aug 2026

Where the build stands, what is blocking, and what to do first tomorrow.

Repo: `ihelprobotics/ihelp-ops` (private) · branch `main`.
Deployed at **https://ihelp-ops-ai-decodeds-projects.vercel.app**, in the
`ai-decodeds-projects` Vercel org.

**Step 1 of `docs/04` is complete.** Phases 0 through 7 are built, tested and
live. What remains is not construction — it is three credentials, one GitHub App
install, and using the thing for a week.

---

## Start here tomorrow

Nothing on this list is code. Every phase is built, tested and live.

1. **Install the Vercel GitHub App** on `ihelprobotics` and connect the project.
   Until then every deploy needs the git remote temporarily detached (see
   *Known* below), and every deploy is a slow upload rather than a 35-second
   git build.

2. **Rotate the secrets that sat in the client's Vercel account.** See *Blocking*.

3. **Merge or close PR #2.** It now carries three commits and two scribe runs.
   A human in CODEOWNERS owns that call.

---

## Proven live, end to end

**The agent loop, twice fixed and then watched working.** Run `ad2db36b`,
dispatched through the production platform by the founder:

- The branch `agent/scribe/issue-1` already existed, and was **resumed** rather
  than recreated. Every previous re-run died here.
- PR #2 already existed, so it was **commented** rather than duplicated:
  "Another scribe run for @ammusharaff pushed to this branch."
- `agent_run` records `success`, PR #2, **$0.3110**, 3241 in / 2672 out.

**Test 5, rung by rung, with GitHub doing the delivering.** The agent's push
arrived through the webhook as `commit_event` `f263b4c` on
`agent/scribe/issue-1`, carrying `issue_number = 1` from the trailer the
workflow writes. **Task #1 moved from 20% to 40% with nobody touching the
platform.**

It stops at 40% and that is correct: PR #2 was opened on 25 August, before the
webhook existed, so no `pr_opened` event was ever recorded for it. The ladder
reports what happened, not what is true in GitHub today — which is the honest
answer, and the reason the next task opened will climb the whole way.

**Phase 7 acceptance.** The digest ran for real: it found six commits against
the founder, named Ayeesha as the one person with nothing recorded, reported
nobody on leave, and sent. Run a second time in the same day it sent nothing —
`notification_log` holds exactly one nudge row for her, refused by the
`nudge_once_per_day` index rather than by the sender remembering.

`MAIL_FROM` was `ops@ihelprobotics.com`, and the only domain verified in Resend
is `ihelprobotics.org`. Every send would have been rejected. Corrected in
`.env.local` and in Vercel.

---

## What changed today

**The platform moved to the right Vercel account.** It had been deployed under a
client's team. It now lives in `ai-decodeds-projects`, with its own project and
its own copy of every environment variable. The old project was left in place
deliberately, at your call.

**Row-level security was not in force. It is now.** `DATABASE_URL` connects as
`postgres`, which on Supabase carries BYPASSRLS, so every policy in
`db/schema-people-growth.sql` was inert on the live connection — the 1:1 a
delivery manager must not be able to read would have come back to them, with
nothing anywhere reporting a problem. `withUser()` now switches to the
unprivileged `authenticated` role inside its transaction. `npm run test:rls` had
been *refusing to run* rather than passing, which is why this was never visible.

Nothing had leaked: the four protected tables were empty. Phase 6 is what starts
filling them.

**A second thing fell out of the first.** Supabase enables RLS on every table in
`public` by default, and a table with RLS on and no policies is closed to
everyone. Nine tables are in that state, invisible while everything ran as
`postgres`. `note_access_log` is the one Phase 6 needs and now has policies of
its own in `db/schema-note-access.sql`. The other eight are listed under *Known*.

**Phase 6 — people.** `/team`, `/leave`, `/me`, `/person/[id]`, `POST /api/leave`
and `POST /api/leave/[id]`. Goals, 1:1s and feedback are read through `withUser`
off the base tables rather than the `goal_progress` view — a view executes with
its owner's row-level security, and the policy that applies should not depend on
who ran `CREATE VIEW`. An empty notes list says whether that is because none
exist or because none are yours to read.

**Phase 7 — analytics and the digest.** `/analytics` reports cycle time, review
latency, rework, claimed-versus-proven, stalled work, agent-authored share per
person, and cost per agent and per person. No hours. Medians, not means.
`ops/lib/mail.mjs` no longer captures `RESEND_API_KEY` at module load — a module
is evaluated once per process, so setting the key in Vercel and redeploying
would have looked like it had no effect while the digest went on skipping every
send and reporting that it ran.

**The webhook is live.** Real deliveries are arriving from GitHub: both of
today's pushed commits are in `commit_event`, and a `workflow_run` conclusion is
in `gh_event`. Their task numbers are null, correctly — the commits were on
`main` with no `iHelp-Task:` trailer, and the workflow ran on `main` too.

---

## What is verified

Five suites, each refusing to run without a real database, each asserting it
left nothing behind. All pass locally and the last three also pass against
production.

| | | |
|---|---|---|
| `npm run test:rls` | 12 | The three docs/04 assertions, and that `withUser` makes the policies apply at all |
| `npm run test:people` | 54 | Leave rules, `on_leave_today`, the digest's own filter, the one-nudge-a-day index, the person page under policy |
| `npm run test:webhook` | 38 | Signed deliveries over HTTP; the ladder 10 → 100; every row filed under the issue and never the pull request |
| `npm run test:pages` | 52 | The four people screens, signed in as three people with real Auth.js cookies |
| `npm run test:analytics` | 22 | Two tasks with cycle time, review latency, rework and cost known by hand, read back off the rendered page |

`npm run digest` runs end to end: it found today's two commits as artifacts,
named the one person with nothing on record, reported nobody on leave, and — with
no mail key — skipped the send *and* refused to write `notification_log`, so
tomorrow's nudge is not silently suppressed.

---

## Blocking

| | |
|---|---|
| Secrets exposed in the client's Vercel account | `DATABASE_URL`, `GH_DISPATCH_TOKEN`, `AUTH_SECRET`, `AUTH_GOOGLE_SECRET`, `AGENT_CALLBACK_SECRET`, `GH_WEBHOOK_SECRET`, `CRON_SECRET`. Deleting that project does not un-expose them — rotate |
| Vercel cannot see the repo | Deploys need the remote detached, and take twenty minutes instead of forty seconds |
| `GH_DISPATCH_TOKEN` cannot read check runs | 403 on `/check-runs`. Being replaced with a classic token carrying `repo`. The task page names the missing permission rather than guessing about CI |
| `GH_DISPATCH_TOKEN` expires 23 Sep 2026 | When it does, the board, task pages, agent dispatch and the digest all stop at once, with no warning first |
| The Reviewer needs manual approval to run | Its workflow sits at `action_required` on the agent's branch, so the 75% rung cannot be reached on that task |

---

## Known, deliberately not fixed

- **Every deploy needs `git remote remove origin` first.** The CLI reads the
  local remote and stamps the deployment as a GitHub one; Vercel then tries to
  verify the commit author against a repository the project is not connected to,
  cannot, and blocks the deployment before any build runs. Installing the GitHub
  App removes this entirely.
- **Eight tables have RLS enabled and no policies**, readable only because the
  app connects as a BYPASSRLS role: `app_user`, `agent_run`, `gh_event`,
  `commit_event`, `leave_request`, `leave_balance`, `notification_log`,
  `local_session`. Two of those — `leave_request` and `leave_balance` — are
  person-scoped and today rest on application code alone, in
  `app/lib/leave-data.ts`, which scopes every query by the id on the session.
  That is one forgotten WHERE clause away from being wrong.
- **A dedicated login role** would be better than `authenticated`. That needs a
  password and a change to `DATABASE_URL` in two places. `DB_APP_ROLE` is the seam.
- **`git config user.email` is repo-locally the GitHub noreply address.** Vercel
  blocks deployments whose commit author it cannot match to a GitHub account.
- **`/api/agents/run` sends `Bearer undefined`** when `GH_DISPATCH_TOKEN` is
  unset. The 401 reaches the user; it just does not name the key.
- **The Reviewer's no-test rule blocks most PRs today.** Waivable via the PR body.
- **The Reviewer is deterministic shell, not a model.** Deliberate.
- **PR #2 is open and unmerged.** The scribe's `ops/README.md`, 144 lines.
- **No clash detection in the leave queue** — a lead approving cannot see who
  else from the pod is already away that week.

---

## Acceptance, against docs/09

Tests 1–4 and 6 were proven earlier.

**Test 5** is proven at every level the platform controls — 38 assertions
covering the whole ladder, the numbering trap, `cycle_time` and
`review_latency` — and now also observed live: a real agent push moved task #1
from 20% to 40% through the real webhook, with nobody touching the platform.

**Test 7** is complete. Its privacy assertions hold under `test:rls` and
`test:people`; its leave and nudge behaviour is proven both in the test suite
and by two real digest runs, the second of which correctly sent nothing.

**Test 8** — nothing is typed. There is no writable progress field anywhere and
no hours anywhere, and `/analytics` says so on the page.

That is Step 1 finished. Stop building and use it for a week. The next thing to
build is whatever the first intern gets stuck on — not whatever looks
unfinished.
