# Step 1 — Build everything end to end

Goal: the whole platform working on `localhost:3000` against real Supabase, real
GitHub, real agent runs. Nothing deployed yet.

Work through the phases in order. **Stop at the end of each and verify the
acceptance line before moving on.** If a phase cannot be verified, say what is
missing rather than continuing — a broken foundation costs more than a pause.

---

## Phase 0 — Accounts and secrets (human, ~15 min)

Vivek does these; the agent cannot.

| Need | Where |
|---|---|
| Supabase project, transaction pooler string (port 6543) | supabase.com |
| Google OAuth client (Web), redirect `http://localhost:3000/api/auth/callback/google` | Google Cloud → Credentials |
| GitHub fine-grained PAT: Actions RW, Contents RW, Pull requests RW, Issues RW, Metadata R | GitHub → Developer settings |
| Anthropic API key **with a spending limit set** | Claude Console |

Fill `.env.local` from `.env.example`. `AUTH_SECRET` is `openssl rand -base64 32`.

**Acceptance:** `.env.local` complete, no placeholder values left.

---

## Phase 1 — Schema and auth

- Apply `db/schema.sql`, then `schema-people.sql`, then
  `schema-people-growth.sql`, then `schema-constraints.sql` in the Supabase SQL
  editor.
- `npm install && npm run dev`.
- Sign in with Google. Confirm a row appears in `app_user`.
- Link yourself: set `gh_login`, `role='cto'`, `agent_tier='full'` for your row.

**Acceptance:** signing in creates a user; the session carries `login`, `role`
and `tier`.

---

## Phase 2 — Tasks

- `/api/tasks` reads open issues live from `OPS_REPO`.
- Board renders them with derived progress from `gh_event` (all at 10% until
  the webhook exists — that is correct, not a bug).
- Empty and error states say which of the token or the repo name is the
  problem. Never a blank screen.

**Acceptance:** real issues from the repo appear on the board.

---

## Phase 3 — The agent loop

The part to get right. Everything after is UI.

- Confirm the code repo has `CLAUDE.md`, `.claude/agents/*.md`,
  `.github/workflows/agent-run.yml`, `.github/CODEOWNERS`, and the
  `ANTHROPIC_API_KEY` secret.
- **Trigger `agent-run.yml` by hand from the Actions tab first**, with agent
  `scribe` and a harmless issue such as "add a README to the ops folder".
  Watch the log. Read the PR it opens.
- Only then press Run in the platform on the same agent and issue.
- Verify `agent_run` has status, `pr_url`, `cost_usd` and token counts.

**Acceptance:** pressing Run in the platform produces a pull request in the code
repo and a completed `agent_run` row with a non-zero cost.

---

## Phase 4 — Task detail and VS Code

- `/task/[number]`: live branch, commits, PR, checks, Reviewer verdict, approval.
- Start task creates `task/<issue>/<slug>`.
- Three launch options: desktop, browser, terminal.
- Comments mirrored to the GitHub issue.

**Acceptance:** starting a task creates the branch and the desktop link opens
VS Code on it.

---

## Phase 5 — Events and progress

- `/api/webhooks/github` handles issues, pull requests, reviews, pushes and
  workflow runs. Signature verified; reject unsigned.
- Push a commit and confirm `gh_event` and `commit_event` fill.
- Progress bars now move without anyone touching them.

**Acceptance:** opening a PR against a task moves it to 60% with no manual step.
Locally, use a tunnel (`ngrok` or similar) or defer this to Step 2.

---

## Phase 6 — People

- `/team`: pods, who has what open, who is on leave.
- `/leave`: request, balance, history; lead approval queue.
- `/me` and `/person/[id]`: goals with evidence, merged work, 1:1 history,
  feedback notes, note access log.

**RLS must be verified against real Postgres, not assumed:**
- the delivery manager cannot read a 1:1 written by the CTO
- every subject can read every note about themselves
- unset session context returns zero rows

**Acceptance:** `npm run test:rls` passes against Supabase.

---

## Phase 7 — Analytics and email

- `/analytics`: cycle time, review latency, stalled, claimed-versus-proven,
  agent-authored share, rework rate, cost per person and agent. No hours.
- `lib/mail.mjs` wrapping Resend; wire `ops/daily-email.mjs`.
- Run the digest once by hand and read it.

**Acceptance:** the digest arrives, names the right people, and skips anyone on
approved leave.

---

## Definition of done for Step 1

A person can sign in, see real tasks, run an agent, get a PR, open the branch in
VS Code, push, watch progress move on its own, book leave, and read their own
goals and notes — all on localhost, against real services.
