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

See "Where agents run" in `docs/01-architecture.md` for what the conversation
can and cannot do.

**A second approval system.** GitHub branch protection and CODEOWNERS decide
who approves. The platform's merge button calls the API and can be refused;
that refusal is protection working, not a bug.

**Issue browsing, diffs, blame, code search, in-browser editing.** GitHub and
vscode.dev do these better. Link out.

**Push and pull from the web.** The uncommitted files are on a laptop; this
server has never seen them. Not a limitation to engineer around.

**Per-user API keys.** Credential sprawl with no upside; attribution does not
need them.

**Payroll, hiring pipelines, expenses, contracts.** Leave is included only
because the Escalator needs to know who is away.

**Keystroke, screen or prompt capture.** Local session hooks record that a
session happened, on which branch, for how long. Never what was typed.

## Always hold

**A linked GitHub login is required to start a task or run an agent.** Reading
and leave are open to unlinked accounts.

**Nothing is written about a person that the person cannot read.** No private
manager files. Enforced in row-level security, not in a guideline.

**1:1 visibility:** the subject always; the author; the CTO reads all. The
delivery manager reads only what they wrote. Reads by anyone who is neither
author nor subject are logged, and the subject can see that log.

**Draft and advisory agents are never dispatchable from the platform.**
Deployer, Cloud, Social, Outreach, Lead Gen. Their human owner runs them.

**Agent tiers gate the grid.** week1: scribe, annotator, qa. week2: adds
frontend. full: adds fullstack, ai-developer, integrator, architect. Locked
tiles stay visible with the reason showing — a greyed tile that explains itself
teaches; a hidden one confuses.

**Two concurrent agent runs per person.** Same WIP limit as everything else.

**Merging is continuous.** The Friday demo shows what shipped; it is not a gate.

**Every error message says what failed and what to check.**
