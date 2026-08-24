# Architecture

```
  Browser
     │  Google sign-in (NextAuth v5)
     ▼
  Next.js on Vercel ──────────► Supabase Postgres
     │      ▲                     (users, runs, events,
     │      │                      leave, goals, notes)
     │      │
     │      └───────────── GitHub webhook  ──┐
     │                                        │
     ├─ reads live state ───► GitHub REST API │
     │                                        │
     └─ dispatches ─────────► GitHub Actions ─┘
                                   │
                                   ▼
                        Fresh Ubuntu VM (~15 min life)
                          git clone
                          npm i -g @anthropic-ai/claude-code
                          claude -p "use the <agent> subagent…"
                          git commit && git push
                          gh pr create
                          VM destroyed
```

## Agent execution — the two paths

**Path A, dispatched from the platform.** `POST /api/agents/run` records a row
in `agent_run`, then calls the GitHub workflow-dispatch API. The workflow
`agent-run.yml` (in the *code* repo, not this one) does the work and reports
back with the PR URL, cost and token counts.

**Path B, in the person's own VS Code.** They invoke a subagent interactively.
The platform never sees the process; it is captured by Claude Code hooks in
`.claude/settings.json`, which POST session start and stop to
`/api/agents/local`. Soft evidence only — unauthenticated, best-effort, and
disableable. Use it for "how is the team using agents", never for
accountability. The hard record is the commit and the PR, which arrive through
the signed webhook.

Both paths read the same agent definitions from the code repo. That is the
point of keeping them in git.

## Authentication for agents

Platform-dispatched runs use **one organisation API key**, held as a repository
secret, never visible to users. Interactive work uses each person's own Claude
seat. Never per-user API keys, and never one person's subscription serving
other people's requests — that is outside Anthropic's usage policy and it would
also collapse attribution.

Cost attribution works without per-user keys: `claude -p --output-format json`
returns `total_cost_usd` and token usage, which the workflow sends back and the
platform stores against the requester.

## Identity

Google is the login. `app_user.gh_login` is the attribution key and may be null
until linked. Session carries `{ id, login, role, tier, pod }`.

Roles: `member`, `lead`, `cto`, `founder`.
Agent tiers: `week1`, `week2`, `full`.

## Data direction

| Data | Lives in | Platform does |
|---|---|---|
| Issues, PRs, reviews | GitHub | Reads live via API |
| Events (for analytics) | Postgres `gh_event` | Written by webhook |
| Agent runs, cost | Postgres | Written by platform and workflow callback |
| People, leave, goals, notes | Postgres | Owned entirely here |
| Code | GitHub | Never touched |

## Environments

Local: `npm run dev` against the same Supabase project is fine at this size.
Supabase has no database branching, so once more than two people develop, add a
second project for development rather than branching one — this is the thing
Neon did better, and it is the cost of the choice.

Production: Vercel. Migrations applied out of band through the Supabase SQL
editor; the app connects as an unprivileged role and never holds an admin
credential. That is not hygiene, it is load-bearing: row-level security does not
apply to a superuser, so connecting as one silently disables every policy in
`schema-people-growth.sql`. `npm run test:rls` refuses to run as a superuser for
the same reason.

`DATABASE_URL` is the transaction pooler on port 6543. The session pooler (5432)
and the direct connection both exhaust on serverless. The transaction pooler
cannot use prepared statements, which is why the client sets `prepare: false`.
