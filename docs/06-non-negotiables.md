# Non-negotiables

These are decisions with reasons behind them. Do not re-litigate them while
building, and do not "helpfully" add any of them.

## Never build

**Hours tracked, time-on-platform, presence, or a session table.** The moment
time-online appears next to merged work, people optimise the easier number. It
also answers a question nobody should be asking. Measure cycle time instead. The
schema carries a comment saying this, so nobody adds it later.

**A completion percentage anyone types.** Progress is derived from events only.
Same for goals: report evidence linked and evidence landed as counts, never a
score against a person's name.

The MITRA build board (`/mitra`, added 2026-10-10) is the one place a status is
typed, and only for what has not started: it is a plan, and nothing has
happened yet that could prove where a planned task is. "Start in Ops" turns a
row into a GitHub issue, and from that moment its column is derived from
GitHub like every other task. The store refuses a typed status for a linked row
and refuses to delete it (`app/lib/plan-store.ts`), so a stale tab cannot
undo that either.

A linked card that someone tries to drag says what would move it instead
(2026-10-12): the drag is cancelled and the card, its status field and its
drawer name the next step in GitHub — a branch named `task/<n>/…` for In
progress, a pull request for review, a merge or a closed issue for Done
(`moveHow` and `moveSteps` in `plan-boards/ops.js`). They only put the ladder in
`app/lib/progress.ts` into words; they never set a column. The same rules, and
the rest of how to use a build board, open the board's Overview (`rulesHTML`),
built from the board's own settings so they can't describe a board that
behaves differently.

Assignment follows the same line (2026-10-11). A planned row carries no typed
assignee: assigning it opens its issue with that person on it, under the rules
in `app/lib/assign.ts`, and from then on the name is GitHub's. The store drops a
typed assignee for a linked row as it drops a typed status. Leads can make every
planned task in the current filter an issue at once (`/api/boards/<board>/start-many`,
`canPlan`, ten per request, stopping at the first GitHub refusal). The Ops
board shows the plan as one card that opens `/mitra`, not as rows in its
columns, because a plan row would look exactly like an issue nobody picked up.

The SENTINEL elderly-care build board (`/sentinel`, 2026-10-11) is a second
plan under exactly these rules — same store, its own keys, its own column words
(`app/lib/plan-boards.ts`). Each plan also has a standalone copy outside Ops
(mitra-build-board.vercel.app, sentinel-build-board.vercel.app) that edits the
same rows **without sign-in**: anyone with the link can read and edit the plan,
including any names typed on planning rows. They show no live GitHub status and
cannot start a task; a linked row there is marked as following its issue in Ops.

The SpatialCast Pro build board (`/spatialcast`, 2026-10-14) is a third plan
under the same rules, written on SENTINEL's template: the same columns and
stylesheet, its own keys (`spatialcast:*`), and tasks starting in
`ihelprobotics/spatial-immersion`. It has no standalone copy. The Ops layer
(`plan-boards/ops.js`) takes its column words from each board's own columns
rather than from its URL, so a board on either template needs no change there.

A card in a plan's Done column carries **View commit** and **View PR**
(2026-10-12), opened from the `pr_merged` event Ops recorded for its issue.
They were asked for as Commit and Push buttons; they link instead, because a
Done task is already merged and the web does not commit or push (below). With
nothing on record — never started in Ops, or merged before the webhook — the
buttons stay visible, disabled, and say why.

**Chat between people.** Discord does DMs, presence, threads, mobile and
notifications properly. Build task comments that mirror to GitHub issue
comments. Ingest Discord *channels and threads* for the record — **never DMs.**

This originally read "real-time chat" without the qualifier, and on
2026-08-28 a conversation with an *agent* was added to the task page, which the
old wording forbade. The reasons behind the ban are all about people talking to
each other — presence, mobile, notifications, DMs — and none of them apply to
asking the QA agent what a test is for. What does still apply, and is kept:

- Nothing said to an agent is a record of work. Status is still derived from
  artifacts. A conversation moves nothing.
- A conversation belongs to the person who had it. No lead, CTO or founder can
  read it — `db/schema-chat.sql` has one policy clause and no admin escape, and
  `npm run test:chat` signs in as a founder and proves they cannot.
- There is no presence, no unread count, no notification, and no way to send a
  message to another human. Those are the parts Discord does better.

See "Agent execution — the four paths" in `docs/01-architecture.md` for what
the conversation can and cannot do, and for how Path C hands work to Path A or
Path D without being able to do that work itself.

**A second approval system.** GitHub branch protection and CODEOWNERS decide
who approves. The platform's merge button calls the API and can be refused;
that refusal is protection working, not a bug.

**Issue browsing, diffs, blame, code search, in-browser editing.** GitHub and
vscode.dev do these better. Link out.

**Push and pull from the web.** The uncommitted files are on a laptop; this
server has never seen them. Not a limitation to engineer around.

That is still true of a person's work. On 2026-09-11 an agent run through the
Claude API (Path D) was added, which does write to GitHub from the server — and
what makes it compatible with this rule is how little it can do. It writes only
files it read from GitHub in the same run, only as one new commit on its own
`agent/<agent>/issue-<n>` branch, and only to open a pull request. It cannot push
to the default branch, cannot change a workflow file, cannot merge, and cannot
see anything on anyone's laptop.

**Per-user API keys.** Credential sprawl with no upside; attribution does not
need them.

**Payroll, hiring pipelines, expenses, contracts.** Leave is included only
because the Escalator needs to know who is away.

**Keystroke, screen or prompt capture.** Local session hooks record that a
session happened, on which branch, for how long. Never what was typed.

## Always hold

**A linked GitHub login is required to start a task or run an agent.** Reading
and leave are open to unlinked accounts.

**A person links their own GitHub login by signing in to GitHub** (Connect
GitHub, 2026-10-13; `app/api/github/`). The login saved is the one GitHub says
signed in, so it can't be mistyped or claim somebody else's. It must be a member
of `GH_ORG`, since an outsider can't be assigned issues, and it can't already
belong to another account. The OAuth request asks for no scopes, and the token
it returns is used once to read the login and never stored: Ops acts on GitHub
only with `GH_DISPATCH_TOKEN`. Each link is a `role_change` line with the person
as actor. Admins can still set or clear a login on the Admin page.

**Nothing is written about a person that the person cannot read.** No private
manager files. Enforced in row-level security, not in a guideline.

**1:1 visibility:** the subject always; the author; the CTO reads all. The
delivery manager reads only what they wrote. Reads by anyone who is neither
author nor subject are logged, and the subject can see that log.

**Agent runs are switched off for everyone for now** (2026-10-12,
`AGENT_RUNS_OPEN` in `app/lib/agents.ts`). Every Run button says it is coming
soon and both run routes refuse; talking to an agent on a task is unchanged.

**Draft and advisory agents are never run from the platform.** Deployer, Cloud,
Social, Outreach, Lead Gen. Their human owner runs them. Neither Run now nor
GitHub Actions will start one, for anyone, founder included. Since 2026-09-11
they can be *talked to* on a task: a draft in a private conversation leaves
nothing behind and changes nothing, and it is the human who decides what to do
with it.

**Agent tiers gate the grid.** week1: scribe, annotator, qa. week2: adds
frontend. full: adds fullstack, ai-developer, integrator, architect. Locked
tiles stay visible with the reason showing — a greyed tile that explains itself
teaches; a hidden one confuses. The grid is on the task page, beside the issue
the agent will read; the board shows tasks and their progress only. Tiers gate
running, by either path, and never talking.

**Two concurrent agent runs per person.** Same WIP limit as everything else.

**Merging is continuous.** The Friday demo shows what shipped; it is not a gate.

**Every error message says what failed and what to check.**
