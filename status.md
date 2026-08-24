# Status — 24 Aug 2026

Where the build stands, what is blocking, and what to do first tomorrow.

Repo: `ihelprobotics/ihelp-ops` (private) · branch `main` · HEAD `77044d7`,
pushed. Ten commits. Working tree clean apart from this file.

---

## Start here tomorrow

**The four failed agent runs were not Claude Code failing. They never reached
it.** Every one died at the `Check the inputs` step of `agent-run.yml`:

```
AGENT: scribe            ok
ISSUE: 1                 ok
REQUESTER: ammusharaff   ok
RUN_ID: manual-4         rejected — not a UUID
Process completed with exit code 1.
```

The step requires `run_id` to match `^[0-9a-fA-F-]{36}$`, because the platform
sends `agent_run.id` and the callback needs it to find the row. A hand-typed
value from the Actions tab cannot satisfy that.

**This contradicts our own instructions.** `docs/08` §3c says to trigger the
workflow by hand first with `run_id: test-1`, and `docs/04` Phase 3 says the
same. Following the guide as written cannot work against the workflow as
written. One of the two has to give.

Two ways to resolve, and this is a decision, not a detail:

1. **Relax the check** to any non-empty `run_id`, and let the callback fail
   softly for a manual run. The callback route already answers `404 No run with
   id X`, and since `77044d7` a non-200 callback is an annotation rather than a
   failed run — so a manual run would work end to end and simply not update any
   row. This keeps `docs/08` §3c usable, which is the whole point of that step:
   watch the agent work before trusting the button.
2. **Keep the check strict** and rewrite §3c to say "insert a row in
   `agent_run` and paste its id". More faithful to the ledger, worse as a first
   experience.

I would take (1). The strict check was written to catch the platform sending
something wrong; it is catching a human doing exactly what the guide told them
to.

Note on the previous change: the "print both streams on failure" fix in
`77044d7` addressed a symptom that did not exist as described — stderr was
empty because the agent step never ran, not because Claude Code was silent. The
change is still worth having, but it did not diagnose this.

---

## What is done and verified

**Platform.** Next.js 15, Supabase Postgres via postgres.js, NextAuth v5 with
Google. `npx tsc --noEmit` clean, `next build` compiles.

- Auth split for the edge runtime — `auth.config.ts` (no database) for
  middleware, `auth.ts` for routes. Signed-out `GET /` redirects to `/login`,
  verified against a dev server.
- Task board reads live issues from GitHub, derives all seven progress stages,
  and reports `events_recorded` so "nothing happened" and "the webhook was
  never connected" no longer render identically.
- `gh_event.number` is the **task** issue number for every event kind. Issues
  and PRs share one sequence per repo, so storing the PR number capped the
  board at 40% and left `cycle_time` permanently empty. Verified: all seven
  stages reach 100, and the control reproduces the stall.
- Row-level security holds. `npm run test:rls` — 9/9 against real Postgres as
  an unprivileged role, rolled back, zero residue. Refuses to run without
  `DATABASE_URL` or as a superuser, because a pass under either proves nothing.
- Four SQL files apply cleanly with `ON_ERROR_STOP`, `local_session` included.
- Guards that used to vanish when a variable was unset now name the missing
  variable: agent callback secret, `CRON_SECRET`, all four GitHub calls
  (one `ghFetch`), and nudges are only recorded when the mail actually left.

**GitHub side.** Both workflows registered and active — `Agent run`
(341408521), `Reviewer` (341408522). actionlint clean. Thirteen agent briefs in
`.claude/agents/`, six rewritten for this codebase. CODEOWNERS for this repo's
real paths.

---

## Blocking

| | |
|---|---|
| `run_id` validation vs `docs/08` §3c | See above. Decide before the next manual run |
| `PLATFORM_WEBHOOK` secret | **Missing.** Without it the callback logs a warning and no run ever leaves `running` |
| `PLATFORM_WEBHOOK_SECRET` secret | **Missing.** Must equal `AGENT_CALLBACK_SECRET` in `.env.local` |
| `ANTHROPIC_API_KEY` | Set |

`PLATFORM_WEBHOOK` needs a publicly reachable URL, so it wants a tunnel or a
deploy first.

Also unresolved from earlier, and it will bite the moment a run completes:
`DATABASE_URL` in `.env.local` is the **direct** connection
(`db.<ref>.supabase.co:5432`), not the transaction pooler
(`aws-0-<region>.pooler.supabase.com:6543`), and the password contains a literal
`@` that is not percent-encoded. Both fail later rather than immediately, which
is what makes them worth fixing before they are load-bearing.

---

## Known, deliberately not fixed

- **`/api/agents/run` sends `Bearer undefined`** when `GH_DISPATCH_TOKEN` is
  unset. GitHub 401s and the route surfaces "GitHub refused the dispatch (401)",
  so the error does reach the user — it just does not name the key. Left as
  finding 3 of the guard audit.
- **The Reviewer's no-test rule blocks most PRs today.** It fails when anything
  under `app/`, `lib/` or `ops/` changes without a file matching test/check/spec,
  and this repo has exactly one such file. Waivable via the PR body. Consider
  demoting it to a note until there are more tests.
- **The Reviewer is deterministic shell, not a model.** Its "silent fallback"
  and "error message" checks are regex heuristics over added lines and will miss
  what a model would catch. Deliberate: a check that sometimes blocks teaches
  people to re-run it.
- **`ops/lib/mail.mjs` captures `RESEND_API_KEY` at module load.** Not a bug,
  but it means the cron route's dynamic import fixes the key for the life of the
  serverless instance.
- Two workflow files carry a stray `# Registration touch: see git log.` comment
  from forcing registration. Harmless cruft, safe to strip.

---

## Not built yet

Phase 4 onward of `docs/04`: `/task/[number]`, `/team`, `/leave`, `/me`,
`/person/[id]`, `/analytics`. `app/lib/github.ts` already has `startTask`,
`openPR`, `branchState` and `merge` written and **nothing calls them** — the
task detail page is the missing consumer, and it is the natural next build.

Acceptance tests in `docs/09`: only Test 7 has genuinely run. Test 5 is verified
in logic but never end to end on a live task.

---

## Suggested order

1. Decide the `run_id` question, then get one manual `agent-run` to completion.
2. Fix `DATABASE_URL` (pooler, port 6543, `%40`).
3. Set the two `PLATFORM_WEBHOOK*` secrets once there is a reachable URL.
4. Run Test 5 end to end on issue #1.
5. Build `/task/[number]`.
