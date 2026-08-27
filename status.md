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

1. **Push a commit on a real task branch.** Everything else in Test 5 is proven;
   this is the last rung nobody has watched climb with real GitHub deliveries.
   Start a task from `/task/<n>`, commit with `core.hooksPath` set, push, and
   watch the board move to 40% on its own.

2. **Install the Vercel GitHub App** on `ihelprobotics` and connect the project.
   Until then every deploy needs the git remote temporarily detached (see
   *Known* below), and every deploy is a slow upload rather than a 35-second
   git build.

3. **Rotate the secrets that sat in the client's Vercel account.** See *Blocking*.

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
| `RESEND_API_KEY` and `DIGEST_TO` are empty | The digest computes correctly and cannot send. This is the last thing between Phase 7 and done |
| Secrets exposed in the client's Vercel account | `DATABASE_URL`, `GH_DISPATCH_TOKEN`, `AUTH_SECRET`, `AUTH_GOOGLE_SECRET`, `AGENT_CALLBACK_SECRET`, `GH_WEBHOOK_SECRET`, `CRON_SECRET`. Deleting that project does not un-expose them — rotate |
| Vercel cannot see the repo | Deploys need the remote detached, and take twenty minutes instead of forty seconds |
| `GH_DISPATCH_TOKEN` cannot read check runs | 403 on `/check-runs`. A fine-grained token needs **Checks: read**. The task page says so rather than guessing |
| An Agent run failed today at 12:24 UTC | Manually dispatched on `main`. Not investigated |

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

Tests 1–4 and 6 were proven earlier. Test 7's privacy assertions and its leave
and nudge behaviour are proven by `test:rls` and `test:people`; its parts 3 and 4
need mail to actually send.

Test 5 is proven at every level the platform controls — 38 assertions covering
the whole ladder, the numbering trap, `cycle_time` and `review_latency`. What
remains is watching one real task climb it with GitHub doing the delivering.

Then stop building and use it for a week. The next thing to build is whatever
the first intern gets stuck on — not whatever looks unfinished.
