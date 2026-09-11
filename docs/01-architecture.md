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

## Agent execution — the four paths

Agents are chosen on the task page, never on the board. The board shows tasks
and their progress; the grid of agents sits beside the issue the agent will read.

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

**Path C, a conversation on the task page.** `POST /api/chat` calls Claude
directly and streams the answer back as Server-Sent Events. It is narrow on
purpose: the
conversation can read the task, its comments and the agent's own brief, and it
has **no tool that writes**. It cannot edit a file, commit, push or open a pull
request, and the system prompt says so in those words — an agent that believes
it can write code describes edits as though it has made them, and the reader
believes it.

So the fast thing stays cheap and the consequential thing stays evidenced.
Asking the architect whether an approach is sound costs a cent and takes
seconds; changing the code still goes through a run — Path A or Path D — ending
in a pull request a human reviews.

**Path D, a run through the Claude API, from the task page.** Added 2026-09-11.
`POST /api/agents/direct` applies exactly the gates Path A does — linked GitHub
login, `canDispatch`, the draft-agent exclusion, the two-run limit — checks the
issue is open, writes an `agent_run` row, and then runs the agent in the
platform itself (`app/lib/direct-run.ts`) with Claude Opus 5, streaming each
step back as Server-Sent Events.

The agent gets four tools and nothing else: `list_files`, `read_file`,
`write_file`, `delete_file` (`app/lib/workspace.ts`). They act on the repository
at one commit, read through the GitHub API, and writes are staged in memory.
When the agent stops, `app/lib/land.ts` turns what it wrote into one commit on
`agent/<agent>/issue-<n>` — carrying the `iHelp-Task` trailer — and opens a pull
request whose body carries `Platform run: \`<uuid>\``, the same three shapes
`agent-run.yml` produces, so the webhook, progress and analytics cannot tell the
paths apart. A branch an earlier run made is continued, and a branch that moved
underneath the run is never overwritten.

What it deliberately cannot do, and why each matters:

- **Run anything.** No shell, no install, no tests. The pull request says so, and
  CI on the pull request is the first time the code executes. Use Path A when
  the work needs to be built or tested to be done well.
- **Write a workflow file.** `.github/workflows/*` is refused. A workflow decides
  what runs with the repository's secrets; changing one is a person's decision.
- **Write back a file it only saw part of.** A read over 100,000 characters is cut
  and says so, and that file is then refused on write — an agent that edits the
  half it saw and writes it back deletes the other half.
- **Outlive the function.** Vercel stops it at 300 seconds. The loop stops
  starting turns at 200, aborts at 250, and lands what exists as a pull request
  titled `[Unfinished]`, recorded as `failure`, rather than being killed with its
  row stuck on `running`.

A run that changes nothing comments on the issue and records `no_changes`, as
the workflow does. A refusal from the model is retried server-side on the
fallback Anthropic recommends for that category (`fallbacks: "default"`); if
that also refuses, nothing is committed.

**Path C can start Path A or Path D.** Having worked out what should change —
or without talking at all — you press "Have it do this", optionally write a
**brief**, and choose **Run now** (Path D) or **Run in GitHub Actions** (Path A).
The brief is one editable box, at most `BRIEF_LIMIT` characters: on Path A it
arrives as a `brief` input on `agent-run.yml` and is appended to the agent's
prompt; on Path D it goes into the prompt directly. Either way it is quoted in
the pull request body so a reviewer can see what was asked for.

The box exists rather than the transcript being sent, and it matters why. The
conversation is private and the run is public: the brief lands in the Actions
log and the pull request, where the whole organisation reads it. Sending the
thread automatically would undo the trade that lets the platform store what
somebody typed at all. So the person writes the sentence that gets published,
is told it will be published, and confirms it. The conversation never leaves.

Two rules the bridge does not bend. **Tiers gate the button, not the talking** —
a week1 joiner can still ask the architect anything and still cannot dispatch
it, and `canDispatch` in `app/lib/agents.ts` is the one rule the button and the
route both read. **The issue is still the task** — the brief narrows it and the
prompt says so; an agent told to do something the issue does not cover is
instructed to stop and write the conflict into `AGENT-NOTES.md` rather than
guess between them.

Three consequences worth stating, because they are the ones people assume the
other way round:

- **A conversation is not a record of work.** Nothing said in one moves a task.
  Progress is still derived from artifacts. If something from a conversation
  matters, it goes on the issue as a comment, which is public and is the record.
- **A conversation is private to the person who had it.** Not their lead's, not
  the CTO's, not the founder's. `db/schema-chat.sql` has one policy clause and
  no admin escape; `npm run test:chat` signs in as a founder and proves it.
  This is the one place the platform stores what somebody typed, and the reason
  it is allowed to is that nobody else can read it — the same trade
  `local_session` refuses to make, for the same reason.
- **Tiers do not gate it.** `week1`, `week2` and `full` gate *running*, by
  either path, because a run changes code. Talking changes nothing, so gating it
  would only stop a new joiner learning what the architect thinks. The draft and
  advisory agents can be talked to for the same reason, and are never run.

Paths C and D need `ANTHROPIC_API_KEY` in the platform's own environment. The
workflow has its own copy as a GitHub Actions secret; that copy is write-only
and cannot be read back, so this is a second copy of the same key rather than a
way to share one. Path D also needs `GH_DISPATCH_TOKEN` to hold Contents: write
and Pull requests: write (and Issues: write for its label and its no-change
comment) on every repository it runs in.

All four paths read the same agent definitions from the code repo — Path A and
B by checking it out, Paths C and D by fetching `.claude/agents/<name>.md` through
the API. The qa agent you talk to has the standards of the qa agent that opens the
pull request, rather than being a second personality with the same name. That is
the point of keeping them in git.

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
| Code | GitHub | Written only by a Path D run: one commit on its own `agent/*` branch, and a pull request. Never pushed to the default branch, never merged by the platform without branch protection agreeing |

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
