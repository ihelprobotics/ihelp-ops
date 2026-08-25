# Status — 25 Aug 2026

Where the build stands, what is blocking, and what to do first tomorrow.

Repo: `ihelprobotics/ihelp-ops` (private) · branch `main` · HEAD `60fef28`,
pushed. Deployed at **https://ihelp-ops.vercel.app**.

---

## Start here tomorrow

**Two things need a browser and a human, and both are one minute each.**

1. **Give Vercel access to the repository.** Vercel cannot see
   `ihelprobotics/ihelp-ops`, so the project is not git-linked and every deploy
   is a file upload from a laptop — which is what turned a 33-second deploy
   into a twenty-minute one this afternoon. Install the Vercel GitHub App on
   the `ihelprobotics` org and grant it this repo, then
   `vercel link` again. After that, push deploys.

2. **Add the production redirect URI to Google.** Google Cloud Console →
   Credentials → the OAuth client → Authorised redirect URIs →
   `https://ihelp-ops.vercel.app/api/auth/callback/google`. Until it is there,
   the deployed UI cannot be signed into. The webhook and callback routes are
   outside the session check and already work.

Neither blocks the loop below; both block a person using it.

---

## What is done and verified

**The agent loop runs end to end.** Run 32833986759: scribe against issue #1,
2m32s, cost $0.5201, pull request #2 opened, Reviewer passed. This is the first
time it has completed, and the four earlier failures were never Claude Code —
they died at input validation before the agent step.

- `run_id` no longer has to be a UUID. `docs/08` §3c tells you to trigger the
  workflow by hand with `test-1`, and the check rejected exactly that. It now
  only has to be safe; the platform still sends `agent_run.id`, and the callback
  answers a non-UUID with a 404 that says a manual run has no row and is
  expected to. Non-200 has been an annotation rather than a failure since
  `77044d7`, so the documented first run now works.
- The workflow was committing its own scratch files — `issue.json`,
  `prompt.txt`, the full `result.json` transcript — into the agent's pull
  request, because the commit step is `git add -A`. Worse, it meant
  `git status --porcelain` was never empty, so the "changed nothing" path could
  not fire and a too-vague issue would have produced a pull request containing
  nothing but logs. Everything the workflow writes now lives in `$RUNNER_TEMP`.
- `DATABASE_URL` is the transaction pooler:
  `postgres.<ref>@aws-0-ap-northeast-2.pooler.supabase.com:6543`, password
  `%40`-encoded. The old direct host does not resolve at all from here — it is
  IPv6-only. Eighteen tables and views confirmed present over the pooler.
- Two `agent_run` rows stuck in `running` since yesterday are closed. They were
  holding the founder at the two-concurrent-run limit.
- `PLATFORM_WEBHOOK` and `PLATFORM_WEBHOOK_SECRET` are set in the repo.
  Production answers the callback and fails closed on a missing secret with the
  message that names it — verified live.

**Phase 4: `/task/[number]` is built.** Branch, pull request, checks, Reviewer
verdict, human approval and mergeability read live from GitHub; commits and
agent runs with cost from the database; comments posted to the GitHub issue and
not copied here. Start task, open PR, merge and comment all work through
`/api/tasks/[number]`. `next build` clean, `npx tsc --noEmit` clean.

Three defects surfaced by building the first consumer of `app/lib/github.ts`:

- The progress ladder existed twice. It is now `app/lib/progress.ts` and both
  screens use it. Its `hasBranch` matched `issue-${n}` as a substring, so a
  branch for issue #10 showed task #1 as branched.
- `branchState` read `mergeable_state` off the pull request *list* endpoint,
  where GitHub never puts it. Every task read "unknown".
- `branchState` threw away the whole page on a 403 from check-runs.

**Still verified from before.** RLS 9/9 against real Postgres. Four SQL files
apply cleanly. Guards name the missing variable. Both workflows registered.

---

## Blocking

| | |
|---|---|
| Vercel cannot see the repo | Install the GitHub App on `ihelprobotics`. Until then deploys are slow uploads |
| Google redirect URI | Add the production callback URL, or nobody can sign in to the deployment |
| `GH_DISPATCH_TOKEN` cannot read check runs | 403 on `/check-runs`. A fine-grained token needs **Checks: read**. The task page says so rather than guessing, but it cannot report CI until this is fixed |
| `RESEND_API_KEY` and `DIGEST_TO` are empty | Phase 7 only. The digest cannot send without them |

---

## Known, deliberately not fixed

- **`/api/agents/run` sends `Bearer undefined`** when `GH_DISPATCH_TOKEN` is
  unset. The 401 reaches the user; it just does not name the key.
- **The Reviewer's no-test rule blocks most PRs today.** Waivable via the PR
  body. Consider demoting it to a note until there are more tests.
- **The Reviewer is deterministic shell, not a model.** Regex heuristics over
  added lines. Deliberate.
- **`ops/lib/mail.mjs` captures `RESEND_API_KEY` at module load.**
- Two workflow files carry a stray `# Registration touch: see git log.`
  comment. Harmless, safe to strip.
- **PR #2 is open and unmerged.** The scribe's `ops/README.md`, 144 lines, is
  worth reading before it is merged — a human in CODEOWNERS owns that.

---

## Not built yet

Phase 5 is wired but unproven: the GitHub webhook has never been connected, so
`gh_event` is empty, every task reads 10% and `cycle_time` has nothing in it.
The board says so rather than showing a quiet week, which is the point.

Phase 6 and 7 of `docs/04`: `/team`, `/leave`, `/me`, `/person/[id]`,
`/analytics`.

Acceptance tests in `docs/09`: Test 7 has run. Test 5 needs the webhook
connected — it is the next one, and it is now one settings page away.

---

## Suggested order

1. Vercel GitHub App, then `vercel link` — everything after this gets faster.
2. Google redirect URI, then sign in to the deployment and read `/task/1`.
3. Add the repository webhook to `https://ihelp-ops.vercel.app/api/webhooks/github`
   with `GH_WEBHOOK_SECRET`, and watch a task climb past 10%.
4. Run Test 5 end to end on issue #1.
5. Give `GH_DISPATCH_TOKEN` **Checks: read**.
6. Build Phase 6.
