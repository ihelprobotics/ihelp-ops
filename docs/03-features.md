# Features, page by page

Each section lists what the page does and how you know it works. Build in this
order.

---

## `/login`
Google sign-in only. On first sign-in, upsert into `app_user` by email.

**Done when:** signing in creates a row and lands on `/`.

---

## `/` — Task board

Tasks and their progress, and nothing else. No agents — those are on the task
page, beside the issue they will read.

- Open issues read live from every configured repository, never mirrored.
- Four columns — **Not started**, **In progress**, **In review**, **Approved** —
  each a band of the progress ladder (below 20, 20–59, 60–89, 90 and up). A card
  is in a column because of what GitHub reports; nobody moves a card, and there
  is nothing to drag.
- Each card: repository (when there is more than one) and number, title, a
  progress bar with the stage that produced it and the commit count, up to three
  labels, the assignee or "Nobody has this", and when it last changed.
- Your own cards are marked at the edge. An unassigned card has **Take it**.
- Filters in the URL: Everything / Mine / Unassigned, and a repository. A filter
  naming a repository that is not on the board says so rather than being ignored.
- A repository that could not be read is named with its error; an empty board
  says which repositories were read; zero recorded events explains why every
  card is in Not started.
- Unlinked GitHub account: banner explaining why they can read but not take.

**Done when:** a real issue appears in Not started, taking it puts your name on
the card without a reload, and pushing a branch for it moves it to In progress
with nobody touching the platform.

---

## `/new` — Open a task

A repository, a title, a description, and a checkbox to put your own name on it.
It creates a GitHub issue and sends you to its task page.

The only screen here that writes something a person typed into GitHub. That is
the boundary, not a contradiction: a task is the *request* for work, and
somebody has to say what the work is. What nobody types is how far along it is.

Deliberately thin. No templates, no custom fields, no workflow states — docs/06
says not to rebuild issue tooling here because GitHub does it better, and that
reasoning holds. The issue it produces is an ordinary issue, readable and
editable by anyone on GitHub who has never heard of this platform.

**Acceptance**

- A repository not on the board is refused by name, not silently accepted.
- An account with no `gh_login` is refused, and the page says so before
  anything is typed rather than after.
- The title and description reach GitHub exactly as typed. Nothing is prefixed,
  templated or tidied — an agent reads that body as its whole brief.
- The requester is named in the issue body. The platform holds one token, so
  GitHub records that account as the author; the artifact has to stay true when
  it is read somewhere else.
- Taking it is reported separately. A task that was created but could not be
  assigned is still a task, and must not be reported as a failure.
- It is on the board immediately. GitHub's issue *list* lags roughly seven
  seconds behind a create, so the new issue is carried in memory until that
  list agrees — see `app/lib/work.ts`.

## `/task/[number]`
- Live state: branch, commits, PR, checks, Reviewer verdict, human approval.
- **Open in VS Code**: desktop (`vscode://vscode.git/clone?url=…`), browser
  (`vscode.dev/github/<repo>/tree/<branch>`), and the terminal command.
- Start task creates `task/<issue>/<slug>` if absent.
- Comments, mirrored to the GitHub issue.
- **Agents.** A grid of every agent: the eight code agents, then the five draft
  agents. Any tile can be talked to. Its last line says whether you can also run
  it — gated by `agent_tier`, with the reason on a locked tile; draft agents say
  their human owner runs them.
- **Have it do this**, with an optional published brief and two ways to run:
  **Run now** (through the Claude API, streamed step by step, ending in a pull
  request) and **Run in GitHub Actions**. Unlinked account: the reason instead of
  the button.
- Agent runs against this task, with status, pull request and cost.

**Done when:** starting a task creates the branch, the VS Code link opens it,
and a commit pushed from VS Code appears here within a minute of the webhook;
and Run now on `scribe` opens a pull request labelled `agent-authored`, with an
`agent_run` row carrying its cost.

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
