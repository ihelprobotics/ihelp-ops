# Brief

## The company

iHelp Robotics, Bengaluru. Applied computer vision and assistive intelligence.
Around eleven people: a founder, a CTO, a delivery manager, and eight interns on
three-to-six month rotations. Everyone works remotely. Some colleagues are AI
agents.

## The problem

Work is invisible until someone asks. Status arrives as claims in chat. Interns
rotate out and their knowledge leaves with them. The CTO is the only approver,
so everything queues behind one person. Nobody can answer "what actually moved
this week" without opening five tabs.

## What we are building

One place where work is started, tracked and proven.

The load-bearing decision: **status is derived from artifacts, never typed.**
Progress moves because a branch was created, a commit landed, a PR opened, a
human approved, a merge happened. There is no field anywhere in this product
where a person types how far along they are.

## The three-system split

| System | Role | Why we do not rebuild it |
|---|---|---|
| GitHub | Issues, branches, commits, PRs, reviews, merges, CI | It is the truth. A mirror would disagree with it within a week |
| Claude Code | The agents, defined by `.claude/agents/*.md` in the code repos | Already exists, already works in VS Code and Actions |
| **This platform** | Front door and ledger: start work, see everything, manage people | The only part that does not exist |

The platform was built to execute no agents itself. It dispatches a GitHub
Actions workflow which runs Claude Code headless on a throwaway VM. That single
decision is why this was a two-week build instead of a six-month one: sandboxing,
secrets and repo permissions stay inside GitHub, where they are already solved.

Since 2026-09-11 it can also run an agent itself, from the task page, through
the Claude API (Path D in `01-architecture.md`). That path is deliberately
narrower — it reads and writes files through the GitHub API, cannot run
anything, and cannot touch workflow files — and it ends the same way: a branch
and a pull request that a human reviews. Neither path can put code on a
protected branch without branch protection agreeing.

## Who uses it

| Person | Signs in with | Can do |
|---|---|---|
| Intern / engineer | Google + linked GitHub | Pick tasks, run permitted agents, open in VS Code, book leave |
| Delivery manager (Shiva) | Google only | See everything, approve leave and agent requests. Cannot dispatch agents |
| CTO (Musharaff) | Google + GitHub | Everything, plus tier changes and all 1:1 notes |
| Founder (Vivek) | Google + GitHub | Everything, plus analytics |

**Google signs you in; a linked GitHub login is required to start a task or run
an agent.** Attribution lives in git — commits, reviews and CODEOWNERS are all
GitHub logins. An account with no GitHub identity cannot own work, so it is not
permitted to create any. This lets non-technical staff use the platform fully
without a GitHub account.

## Read next

- `01-architecture.md` — how the pieces fit
- `02-data-model.md` — every table and view
- `03-features.md` — page by page, with acceptance criteria
- `04-step1-build.md` — build everything end to end
- `05-step2-golive.md` — deploy and connect
- `06-non-negotiables.md` — decisions not to re-litigate
