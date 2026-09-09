# Status — 9 Sep 2026

Where the build stands, what is blocking, and what to do first tomorrow.

Repo: `ihelprobotics/ihelp-ops` (private) · branch `main`.
Deployed at **https://ihelp-ops-live.vercel.app**, in the `ai-decodeds-projects`
Vercel team. The older `ihelp-ops-ai-decodeds-projects.vercel.app` is an alias
on the same project, so handouts printed with it still work.

**Step 1 of `docs/04` is complete, and four changes have landed since.** The
platform is healthy and signed-in use works. One thing is hard-blocked: nothing
can be deployed, for a reason outside this repository.

---

## Start here tomorrow

1. **Open the Vercel dashboard for `ai-decodeds-projects`.** Every deployment
   for the last ten days comes back `BLOCKED`. Nothing in this codebase can fix
   that — see *Deployment* below. A dashboard banner will usually name the
   cause, and the API does not expose it.

2. **Decide about the plan.** If it is the Team-on-Hobby mismatch, upgrading to
   Pro fixes it and also retires `ops/deploy.mjs`, which exists only to route
   around a deploy path the plan already refuses.

3. **Use it for a week.** The next thing to build is whatever the first intern
   gets stuck on.

---

## Deployment — blocked, and not by anything here

**Do not trust the previous version of this file on how to deploy.** It said to
push to `main`. That has never worked for this project and does not now:
`ihelp-ops` is a private organisation repository on the Hobby plan, which Vercel
refuses outright. Deploys go through `node ops/deploy.mjs`, which builds locally
and uploads prebuilt output to `ihelp-ops-live`, a second project with no
repository attached.

That path now fails too. On 8–9 Sep, five attempts:

| Variant | Result |
|---|---|
| `node ops/deploy.mjs` (pull, build, flatten, deploy) | `BLOCKED` |
| `vercel deploy --prebuilt --prod`, twice | `BLOCKED` |
| `vercel deploy` — source upload, **preview** target | `BLOCKED` |
| `vercel deploy --prebuilt --prod --scope <personal>` | *"You cannot set your Personal Account as the scope."* |

What this rules out: it is not a daily cap (the date rolled over mid-attempt and
it still blocks), not the upload (two attempts uploaded fully and reached
"Building…"), not production-specific (a preview blocks identically), not the
symlink bug `ops/deploy.mjs` works around (flatten ran fine, 30 symlinks
replaced), and not stale auth (`vercel whoami` answers throughout).

It is also **not the commit-author theory** the previous version of this file
recorded. The CLI is authenticated as `ai-decoded` / `aidecoded23@gmail.com`,
which is the account that owns the team; and a preview deploy carrying the same
git metadata blocks the same way.

The account state: team not blocked, billing `active`, nothing overdue, project
not paused. The one anomaly is that `ai-decodeds-projects` is a **Team on the
`hobby` plan**, and Hobby is a personal-account tier.

**`vercel ls` renders `BLOCKED` as `UNKNOWN`.** That is worth knowing, because
it reads as a hung upload. Only the API tells the truth:

```
GET /v6/deployments?projectId=…  ->  readyState: BLOCKED
```

The last `READY` deployment is from 29 Aug. **Production therefore serves code
from 29 Aug**: the sign-in fix and the conversation-dispatch feature are on
`main` and are not live.

Two one-off steps still apply whenever a deploy does land, both in
`ops/deploy.mjs`'s closing note: Deployment Protection has to be off, and the
deployment's callback URL has to be in Google's authorised redirect URIs or
sign-in fails with `redirect_uri_mismatch`.

---

## The database was deleted, and is back

Between 29 Aug and 8 Sep the Supabase project behind `DATABASE_URL` stopped
existing — `ENOTFOUND … tenant/user postgres.<ref> not found`, with `NXDOMAIN`
on both the pooler tenant and the project host, which is deletion rather than
the free-tier pause. Every table went with it, including the ledger that held
the proof the agent loop had run.

It has since been restored. `/api/health` reports `ok` on all five checks, two
active accounts, and the webhook receiving — 15 events, most recently the merge
of PR #10.

There are no database backups anywhere in this repository. All sixteen tables
rebuild from `db/*.sql`; none of the rows do.

---

## What landed since 27 Aug

**Conversation dispatch (PR #10).** The chat and the dispatch button did not know
about each other: you could reason with an agent about exactly what should
change, press Run, and the run would re-read the issue and work from that alone.
"Have it do this" now sends a `brief` — one box you confirm — into
`agent-run.yml`, which appends it to the prompt and quotes it in the pull request
body. The chat still cannot write; tiers still gate the button and not the
talking; the issue is still the task.

The brief is a box rather than the transcript on purpose. The conversation is
private with no admin escape, and a run is public. Sending the thread would undo
the trade that lets the platform store what somebody typed at all.

**A dead database is not a permissions decision (PR #9).** Signing in against
the deleted project reported *"You do not have permission to sign in."* Auth.js
rewrites any throw from the `signIn` callback into `AccessDenied`, so an outage
arrived wearing the clothes of a decision about the person — on the one screen
where the reader cannot go and find a better error. `SignInUnavailable` now
survives that rewrite and surfaces as `Configuration`, and `/login` says which
of the two happened.

**`test:people` asserted on a row it never created (PR #12).** Its `"the CTO
can"` assertion read the digest rows in `notification_log` — the ones with a
null `user_id` — and the fixture never inserted one. It passed against
production, where real digest runs had left rows behind, and failed the first
time it met an empty database. The policy was correct throughout.

Earlier in the same stretch: multi-repo support, the admin/roles screen with a
role-change audit trail, opening a task from the platform, production hardening,
and five generated PDF handbooks.

---

## What is verified

Ten suites. Every one refuses to run without a real database and asserts it left
nothing behind.

| | | |
|---|---|---|
| `npm run test:signin` | 26 | A refusal and a failure told apart, against `@auth/core`'s own allowlist |
| `npm run test:rls` | 12 | The policies, and that `withUser` makes them apply at all |
| `npm run test:people` | 80 | Leave, `on_leave_today`, the one-nudge-a-day index, the person page under policy |
| `npm run test:webhook` | 41 | Signed deliveries over HTTP; the ladder 10 → 100; every row filed under the issue |
| `npm run test:pages` | 55 | Four screens, signed in as three people with real Auth.js cookies |
| `npm run test:analytics` | 21 | Two tasks with cycle time, review latency, rework and cost known by hand |
| `npm run test:assign` | 34 | Who may take work, across every repo |
| `npm run test:admin` | 47 | Roles, tiers, and who may change them |
| `npm run test:chat` | 41 | Talking to an agent, and a founder failing to read an engineer's thread |
| `npm run test:dispatch` | 30 | Who may turn a conversation into a run, and what the brief refuses |

All pass on `main` against a clean Postgres, `test:assign` excepted — see below.

`tsc --noEmit` and `next build` are clean.

---

## Blocking

| | |
|---|---|
| Every deployment returns `BLOCKED` | Plan-level, on Vercel's side. Nothing here fixes it |
| Production runs code from 29 Aug | Consequence of the above, not a separate problem |

---

## Known, deliberately not fixed

- **A timeout on a write reports failure for work that succeeded.** Clearing an
  assignee hit the 10-second budget while GitHub performed it anyway, and the
  platform returned 502. In the UI: press "Hand it back", see an error, and the
  task is handed back regardless. A read timeout is honest; this one invites a
  retry against a change that already landed. The fix is to verify state after a
  timeout rather than assume failure.
- **`test:assign` cannot run on a clean database.** It needs a real founder or
  CTO with a linked GitHub login, and says so. Two of the ten suites depend on
  the state of the database they meet; only this one tells you.
- **`test:assign` can leave a real issue unassigned.** On 8 Sep its restore step
  hit the 502 above and did not put the name back, leaving issue #1 with no
  owner. Restored by hand. Its own comment says this outcome is worse than no
  check, and it is right.
- **The board is flaky when GitHub is slow.** Fourteen repositories are read
  live with a 10-second budget each; some time out and are reported as failed.
  The message distinguishes a timeout from an empty repository, which is the
  design working.
- **`tsconfig.json` sets `"strict": false`,** so discriminated unions do not
  narrow. `canDispatch` returns `{ok, why}` with an empty `why` because of it.
- **No real dispatch has carried a brief end to end.** The check stops before
  calling the workflow, so `brief` has never made the trip into a live prompt
  and out into a pull request body.
- **Five Dependabot alerts on `main`** — three high, two moderate.
- **PR #2 is open and unmerged** since 25 Aug. The scribe's `ops/README.md`.
- **`/api/agents/local` is unauthenticated** and outside the middleware matcher.
  Documented as deliberate — soft evidence only — but it accepts arbitrary
  `repo`/`branch`/`session` values from anyone who finds the URL.
- **`app/page.tsx` is a 425-line client component**, against the "server
  components by default, under ~200 lines" rule in `CLAUDE.md`.
- **A dedicated login role** would be better than `authenticated`. `DB_APP_ROLE`
  is the seam.

---

## Acceptance, against docs/09

Tests 1–4, 6, 7 and 8 were proven earlier and nothing since has weakened them.
Test 5 is proven at every level the platform controls and was observed live on
27 Aug: a real agent push moved task #1 from 20% to 40% through the real
webhook, with nobody touching the platform.

That evidence lived in the database that was deleted. The suites still prove the
behaviour; the historical rows are gone.
