# Features, page by page

Each section lists what the page does and how you know it works. Build in this
order.

---

## `/login`
Google sign-in only. On first sign-in, upsert into `app_user` by email.

**Done when:** signing in creates a row and lands on `/`.

---

## `/` — Task board
- Open issues read live from GitHub (`OPS_REPO`), never mirrored.
- Each task shows number, title, assignee, labels, and derived progress.
- Selecting a task arms the agent grid.
- Agent grid: tiles gated by the signed-in user's `agent_tier`. Locked tiles
  visible, greyed, with the reason. Draft/advisory agents shown as
  "human owner only".
- Run dispatches and shows status until the PR URL arrives.
- Unlinked GitHub account: banner explaining why, run buttons disabled.

**Done when:** a real issue appears, pressing Run on `scribe` produces a PR in
the repo, and `agent_run` has a row with cost.

---

## `/task/[number]`
- Live state: branch, commits, PR, checks, Reviewer verdict, human approval.
- **Open in VS Code**: desktop (`vscode://vscode.git/clone?url=…`), browser
  (`vscode.dev/github/<repo>/tree/<branch>`), and the terminal command.
- Start task creates `task/<issue>/<slug>` if absent.
- Comments, mirrored to the GitHub issue.
- Agent runs against this task, with cost.

**Done when:** starting a task creates the branch, the VS Code link opens it,
and a commit pushed from VS Code appears here within a minute of the webhook.

---

## `/team`
Pod membership, who is on your pod, what each person has open, who is on leave
today. Read-only.

---

## `/leave`
Request (kind, dates, half-day, reason), see balance and history. Leads see a
pending queue and approve or reject with a note.

**Done when:** an approved leave makes the person appear in `on_leave_today`,
and the nudge email skips them.

---

## `/me` and `/person/[id]`
- Goals for the current 30/60/90 cycle with linked evidence and landed counts.
- Merged work, cycle time, agent-authored share.
- 1:1 history: dates and agreed actions. Notes only if you are the subject, the
  author, or the CTO.
- Feedback notes about you — always visible to you.
- Who has read notes about you.

**Done when:** RLS is verified against real Postgres: the delivery manager
cannot read a 1:1 written by the CTO, and every subject can read every note
about themselves.

---

## `/analytics`
Cycle time, review latency, stalled items, claimed-versus-proven,
agent-authored share per person, rework rate, cost per person and per agent.

**No hours anywhere.**

---

## Background jobs
- `ops/daily-email.mjs` — nudges on missing work (not a missing form), one
  digest to CTO and delivery manager. Skips anyone on leave. One nudge per
  person per day.
- Webhook `/api/webhooks/github` — issues, PRs, reviews, pushes, workflow runs.
- `/api/agents/local` — Claude Code session hooks.
