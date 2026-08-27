# Using the platform

For everyone at iHelp — technical or not. Read once, then keep it open for the
first week.

**https://ihelp-ops-ai-decodeds-projects.vercel.app**

---

## The one thing to understand

**Nobody types how far along they are.**

There is no "80% done" box anywhere in this platform, and there never will be.
A task moves because something real happened in GitHub: a branch appeared, a
commit landed, a pull request opened, a person approved it, it merged.

That means two things for you.

**You cannot fall behind by forgetting to update a status.** If you did the
work, the platform already knows. You never have to report progress.

**You also cannot get ahead by saying you did.** Nobody can, including the
founder. That is the point — everyone is measured the same way, by what exists.

---

## Getting in

1. Go to the URL above and press **Sign in with Google**. Use your work Gmail.
2. That's it. Your account is created the first time you sign in.

### Linking GitHub

If you write code, you also need a GitHub account linked to you. Ask for it to
be set up once — it is a one-line change by whoever runs the platform.

**Why it matters:** git signs every commit with a GitHub username. Reviews,
approvals and code ownership all use it. An account with no GitHub username
attached cannot *own* work, so the platform will not let it start a task or run
an agent. This is deliberate, not a bug.

**Without GitHub linked you can still:** read everything, book leave, comment on
tasks, and see your own goals and feedback. Only starting work and dispatching
agents are closed to you.

---

## The five screens

| Screen | What it's for |
|---|---|
| **Board** | Every open task, and how far each has really got |
| **Team** | Who's on which pod, what they have open, who's away today |
| **Leave** | Book time off, see your balance, approve your team's requests |
| **Me** | Your goals, your 1:1 notes, feedback about you, what you've shipped |
| **Analytics** | How work is flowing across the whole team |

---

## How a task actually moves

Seven steps. Each one is caused by a real thing, never by clicking a button
that says "done".

| Bar reads | What made it move |
|---|---|
| **10%** | Somebody opened the issue on GitHub |
| **20%** | A branch was created for it |
| **40%** | The first commit landed on that branch |
| **60%** | A pull request was opened |
| **75%** | The automated checks passed |
| **90%** | A human approved it |
| **100%** | It was merged |

If a task is stuck at 10%, nothing has happened yet. Not "somebody forgot to
update it" — genuinely nothing. That is useful information rather than a
failure of admin.

---

## Doing a piece of work

### 1. Pick it up

Open the task from the Board and press **Start task**. The platform creates a
branch named after the issue — `task/42/fall-detection-threshold`. The number in
the branch name is how everything you do afterwards attaches itself to the task
automatically.

### 2. Open it in VS Code

The task page gives you three ways in:

- **Desktop** — opens VS Code on your machine
- **Browser** — opens the editor in a browser tab, nothing to install
- **Terminal** — the `git` command, if you already have the repo cloned

### 3. Set up the commit hook — once per clone

```bash
git config core.hooksPath .githooks
```

Do this once, the first time you clone the repository. It makes every commit
tag itself with the task number, which is what puts your work on the board
without you doing anything else.

If you skip it, your commits still land — they just don't attach to any task,
and the board won't move.

### 4. Work, commit, push

Normal git. Commit and push as often as you like. Within a minute of pushing,
the task moves to 40% on its own.

### 5. Open a pull request, get it reviewed, merge

You can do all three from the task page. The **Merge** button calls GitHub — it
does not override anything. If GitHub refuses because a review is missing, that
refusal is the protection working, not a broken button.

---

## Using an agent

Agents are AI teammates. You pick a task, press **Run** on an agent, and a few
minutes later there's a pull request waiting for you.

### What you can run depends on your tier

| Tier | Agents you can dispatch |
|---|---|
| **week1** | Scribe (docs), Data Annotator, QA |
| **week2** | the above, plus Frontend |
| **full** | the above, plus Full-stack, AI Developer, Integrator, Architect |

Locked agents stay visible and greyed out, with the reason showing. That's on
purpose — a hidden button teaches you nothing.

Some agents — Deployer, Cloud, Social, Outreach, Lead Gen — can never be
dispatched from here. Their human owner runs them.

### Two rules about agents

**You own what the agent produced.** Your name goes on the pull request. Read
every line, run it, and be ready to explain it. "The agent wrote it" is not an
answer anyone will accept, and the platform records who asked for the run.

**Two runs at a time, each.** Same work-in-progress limit as everything else.

Every run records what it cost. You can see it on the task and on Analytics.

---

## Booking leave

Go to **Leave**, pick the kind, the dates, and press Request.

| Kind | Comes off your annual balance? |
|---|---|
| Planned | Yes |
| Unpaid | Yes |
| Sick | No |
| Comp off | No |

Your lead approves it — or the CTO, if you have no lead set. You'll see who it's
waiting on. You can withdraw a request while it's still pending.

**Why leave is in an engineering tool at all:** so nobody chases you on a day
you're away. Once your leave is approved, the daily email skips you entirely.
That's the whole reason it exists.

A rejection always comes with a written reason. You'll see it on your own Leave
page.

---

## Your page

**Me** shows four things about you.

**Goals** — your 30/60/90 day goals, with the real work linked against them.
They're reported as *counts of evidence*, never as a score out of ten. You will
never see a percentage next to your name in this platform.

**1:1 notes** — what was discussed, and what was agreed.

**Feedback** — notes written about you.

**Who has read notes about you** — a log.

### Who can read what

This is enforced by the database itself, not by a policy anyone can forget.

- **You** can read *everything* written about you. There are no private manager
  files. If it exists, you can see it.
- **The person who wrote a note** can read their own note.
- **The CTO** can read all notes — and every time they read one they didn't
  write and isn't about them, it appears in your access log.
- **Nobody else** can read notes about you. Not your lead, not another lead, not
  a colleague.

If a colleague opens your page and sees nothing under 1:1s, the page tells them
*why* it's empty rather than pretending you have no record.

---

## Analytics

Team-wide, not personal. The numbers worth knowing:

**Cycle time** — how long a task took from being opened to being merged.

**Review wait** — how long a pull request sat before a human approved it. If
this climbs, reviews are the bottleneck, not the coding.

**Claimed, and proven** — open tasks with somebody's name on them and no branch,
commit or pull request behind them yet. This is not a naughty list. A task can
be assigned this morning, or be a week of reading first. It's simply the one
place where what's claimed and what exists sit side by side.

**Stalled** — nothing has happened on it for three days or more. A prompt to
ask, not a verdict.

**Cost** — what the agents spent, per agent and per person.

**There are no hours anywhere.** No time online, no time tracked, no presence.
The moment those sit next to real work, people optimise the easier number. Cycle
time measures how long the *work* waited — not how long you sat at a desk.

---

## The daily email

At 6pm IST, two things go out.

**A nudge**, only to someone with nothing recorded that day and no blocker
raised. It is a prompt, not a telling-off — plenty of days are reading,
debugging or meetings. You get at most one a day, ever. And if you're on
approved leave, you get none.

**A digest** to the CTO and delivery manager, covering everybody in one email.

### If you're stuck

Raise it in writing — label the issue `blocked`, or say so in your pod channel.

> A block that is raised belongs to the company. A block that is not raised
> belongs to you.

That's the deal. Nobody minds a blocker. Silence is the only thing that causes
problems.

---

## If something looks wrong

Every error in this platform tells you what failed and what to check. If you see
one that doesn't, that's a bug worth reporting.

A few things that look like bugs but aren't:

**"Every task says 10%"** — no GitHub events have reached the platform. The
board says so explicitly rather than showing you a quiet week.

**"The Merge button refused"** — branch protection. A required review or check
is missing. Working as intended.

**"My commits aren't showing"** — the commit hook probably isn't installed in
that clone. Run `git config core.hooksPath .githooks` and push again.

**"I can't run any agents"** — your GitHub account isn't linked yet, or the
agent is above your tier. The tile says which.

---

## If you don't write code

You can do all of this:

- Read every task and see exactly where the work stands
- Comment on tasks — your comment goes to the real GitHub issue
- Book and track leave
- See your goals, your 1:1 notes and feedback about you
- See the team and who's away

You cannot start a task or run an agent, because work has to be attributable to
a git identity. That's a limit on the tool, not a comment on you.
