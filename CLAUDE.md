# iHelp Ops — working in this repository

You are building the internal operations platform for iHelp Robotics. Read
`docs/00-brief.md` before writing anything, and `docs/06-non-negotiables.md`
before proposing any design change.

## What this is

One place where work is started, tracked and proven, for a team that is part
human and part AI agent, working remotely. The organising idea:

**Status is derived from artifacts, never typed by anyone.**

A task moves because a branch was created, a commit landed, a pull request
opened, a human approved, a merge happened. Nobody reports progress and nobody
can inflate it. Every feature decision in this repo follows from that.

## Stack

Next.js 15 App Router · TypeScript · Postgres on Supabase (`postgres`, the
postgres.js driver) · NextAuth v5 with Google · deployed on Vercel. Agents
run in GitHub Actions or, from the task page, through the Claude API — both end
in a branch and a pull request a human reviews (docs/01, Paths A and D).

`DATABASE_URL` is the Supabase **transaction pooler** on port 6543, never the
session pooler on 5432 and never the direct connection. The client sets
`prepare: false`, which the transaction pooler requires — without it you get
intermittent `prepared statement does not exist` under load, and it passes in
development.

## Engineering rules

**Never silently substitute.** A missing key, a missing table, a failed fetch is
an error with the missing thing named. Never a quiet fallback, a mock, or an
empty array that looks like "no results".

**A null result explains itself.** "No tasks" and "the GitHub token cannot see
this repo" are different situations. Reporting them identically sends people
hunting in the wrong place. This applies to every empty state in the UI.

**Fail closed on anything scoped to a person.** Row-level security with unset
context returns no rows. A bug that forgets to set the user must read nothing,
never everything.

**GitHub is the source of truth.** Do not mirror issues, PRs or comments into
the database as authoritative copies. Store events for analytics; read live
state from the API. Two copies means neither is true.

**No new dependency without saying why in the PR.** Prefer the platform
primitives already here.

**Errors reach the user.** Every API route returns a message that says what
failed and what to check. `{ error: "Something went wrong" }` is not acceptable
in this codebase.

## Style

Server components by default; `"use client"` only where interaction requires it.
Route handlers under `app/api/`. Database access only through `lib/db.ts`. Keep
components under ~200 lines. No CSS framework — plain CSS in the component,
matching what is already in `app/page.tsx`.

## Scope discipline

Build what the current step asks for. If you notice something else worth fixing,
say so in your summary — do not fix it in the same change.

Do not build anything listed in `docs/06-non-negotiables.md` under "not built".
Those are decisions with reasons, not omissions.

## When to stop

- The task needs a credential, an account or a decision that does not exist
- Two requirements in the docs genuinely conflict
- You would have to guess what a screen should do
- The change would widen who can read data about a person

Stop and write down what you need. That is a correct outcome, not a failure.
