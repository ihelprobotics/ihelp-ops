# iHelp Ops

Internal operations platform. One place where work is started, tracked and
proven, for a team that is part human and part AI agent.

**The organising idea:** status is derived from artifacts, never typed. A task
moves because a branch was created, a commit landed, a PR opened, a human
approved, a merge happened. There is no field anywhere in this product where a
person types how far along they are.

## Run it

```bash
npm install
cp .env.example .env.local     # fill in the eight values
# apply db/schema.sql, then schema-people.sql, then schema-people-growth.sql
npm run dev
```

Full instructions: `docs/08-complete-build-guide.md`.

## Read the docs in this order

| File | What |
|---|---|
| `docs/00-brief.md` | The company, the problem, who uses this |
| `docs/01-architecture.md` | How the pieces fit |
| `docs/02-data-model.md` | Tables, views, row-level security |
| `docs/03-features.md` | Page by page, with acceptance criteria |
| `docs/04-step1-build.md` | Build everything, locally |
| `docs/05-step2-golive.md` | Deploy and connect |
| `docs/06-non-negotiables.md` | Decisions not to re-litigate |
| `docs/07-operating-model.md` | How the company runs |
| `docs/08-complete-build-guide.md` | Every step, in detail |

`CLAUDE.md` is loaded automatically by Claude Code in every session.

## One external dependency

Agents do not run inside this app. `POST /api/agents/run` dispatches a GitHub
Actions workflow named `agent-run.yml`, which must live in whichever repository
the agents work on — set that repo as `OPS_REPO`. That workflow, the agent
definitions in `.claude/agents/`, and `CODEOWNERS` are the only pieces of this
system that live outside this project.
