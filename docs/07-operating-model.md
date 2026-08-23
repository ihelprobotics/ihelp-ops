# iHelp Operating Model

How this company runs, now that the team is part human and part agent.

Everyone reads this once. New people read it on day one. It is short on purpose.

---

## 1. The unit of work

Every piece of work in this company has three things. No exceptions.

| | |
|---|---|
| **One owner** | A named person or a named agent. Never two names. Never a team. |
| **One artifact** | A merged PR, a demo video, a published report, a signed document. If it does not exist, the work does not exist. |
| **One trust level** | How far the output can be relied on. Travels with the work all the way to whoever reads it. |

This is the same rule the perception stack already runs on: an event carries its
validation state so an unvalidated inference can never be mistaken for a fact.
The company works the same way.

---

## 2. Who is in the team

### Humans — six roles that cannot be delegated

| Role | Owns | Currently |
|---|---|---|
| Founder | Direction, fundraise, sales, what gets built | Vivek |
| CTO | Architecture, the standards, final approval | Musharaff |
| Second reviewer | Approves code and architecture when the CTO cannot | **Musharaff (interim) — this is a single point of failure. Train Samay or Midhath into it.** |
| Delivery manager | Client commitments, dates, scope, the cadence | Shiva |
| Field owner | Cameras, hardware, site installs, staged captures | Rahil |
| QA owner | Acceptance numbers, trust-level promotion, release sign-off | Midhath |

Everyone else — interns, module owners — sits under these six.

Note on the second reviewer: the role exists so that approval is not a single
queue. While the CTO holds both, the review path has no redundancy and no
overflow. Treat filling it as an open commitment with a date, not a solved
problem.

### Agents — sixteen, each with a human owner

An agent without a named human owner is not deployed. The owner is accountable
for what the agent produces, exactly as if they had written it themselves.

| Agent | Owner | Tier |
|---|---|---|
| Manager | Delivery manager | Autonomous |
| Escalator | Delivery manager | Autonomous |
| Reviewer | CTO | Autonomous |
| Scribe | Founder | Autonomous |
| QA | Midhath (QA owner) | Autonomous |
| Frontend | Second reviewer | Autonomous |
| Full-stack | Second reviewer | Autonomous |
| AI Developer | CTO | Autonomous |
| Integrator | CTO | Autonomous |
| Data Annotator | Data owner | Autonomous |
| Lead Gen | Sales owner | Autonomous |
| Deployer | CTO | Draft |
| Social Media | Founder | Draft |
| Cold Outreach | Sales owner | Draft |
| Architect | CTO | Advisory |
| Cloud Engineer | CTO | Advisory |

### The three tiers

**Autonomous** — works to a PR or a report. Output is reversible and visibly
wrong if it is wrong. Merges only through CODEOWNERS.

**Draft** — anything that leaves the company. Emails, posts, proposals,
production deploys. The agent writes it; a human sends it. Always.

**Advisory** — never acts. Proposes options, flags violations, drafts decision
records. A human decides.

The test for which tier something belongs in: **if this is wrong, who finds out
and when?** If the answer is "a customer, next month," it is not autonomous.

---

## 3. How work moves

```
  request
     │
     ▼
  Manager ──routes──► owner (agent or human)
     │                     │
     │                     ▼
     │                  artifact
     │                     │
     │                     ▼
     │                  Reviewer  (blocks or comments — never approves)
     │                     │
     │                     ▼
     │              CODEOWNER approves
     │                     │
     │                     ▼
     │                   done
     │
  Escalator watches the whole path and routes anything stuck or waiting on a human
```

Four rules govern this path:

1. **The Manager reports artifacts, not claims.** It reads merged PRs, commits,
   closed issues and CI results. Anything assigned with no artifact behind it is
   reported as *claimed, unproven* — never as progress.
2. **The Reviewer never approves.** An agent approving agent-written code is a
   closed loop. It blocks, or it comments, and a named human approves.
3. **The Escalator never resolves.** It detects and routes:
   delivery manager → CTO → founder. An escalation that ends at an agent is not
   an escalation.
4. **Nothing is done without its artifact.** Not because someone says so.

---

## 4. The rules everyone lives by

**Two items in progress. Per person, per agent.** Nothing new starts until
something finishes.

**Blocked more than 24 hours must be raised in writing.** If it was not raised,
the miss belongs to the owner. This removes the last excuse.

**Definition of done is fixed:** artifact merged or published, tests green,
60-second demo recorded, doc updated. It is not negotiated per task.

**Every commit is labelled `agent-authored` or `human-authored`.** We want to
know what share of this company no human wrote.

**Two consecutive missed commitments without an escalation is a conversation,**
not a nudge.

---

## 5. Meetings

### The rule that makes these worth attending

**The Manager digest is posted before every meeting. Nobody reads status aloud.**

Status is already visible: what merged, what is open, what is stalled, what is
assigned with nothing behind it. If a meeting is spent restating that, it is
duplicating a script that already ran. These meetings exist for three things
only: **blockers, decisions, and disagreements.**

Agents do not attend meetings. Their work arrives as the digest and the
escalation list, and the Manager speaks for them. When someone says "the agent
is working on it", the correct response is "which PR".

### Daily

| Time (IST) | Meeting | Who | Length |
|---|---|---|---|
| 09:00 | Manager digest posts automatically | — | — |
| 09:15 | **Pod stand-up** × 3, in parallel | Pod lead + members | 10 min |
| 09:45 | **Delivery sync** | Shiva + the three pod leads | 15 min |
| 10:00 | **Decision sync** | Shiva → Musharaff | 15 min |

**Pod stand-up.** Three run at once, one per pod: Platform, Eldercare + EV,
Spatial + Apps. Default is a written thread in the pod's Discord channel; go to
video only when a blocker needs a conversation. Each person answers three
questions and nothing else:

1. What changed since yesterday — **with a link**
2. What is blocking me
3. What I need a decision on

If the answer to (1) has no link, it did not happen. Say so plainly and move on;
this is a data point, not a disciplinary moment.

**Delivery sync.** Pod leads only, three people plus Shiva. Cross-pod blockers,
client commitments at risk, anything that needs a decision above pod level.
Shiva leaves with a written list.

**Decision sync.** Two people, fifteen minutes. Shiva brings only what he could
not resolve: decisions needing the CTO, escalations, architecture questions,
approval queue depth. **Musharaff does not attend pod stand-ups.** If he does,
three pods become one bottleneck again and the delivery manager becomes
decorative.

### Weekly

| When | What | Who | Length |
|---|---|---|---|
| Mon 09:30 | **Commitments.** Three each, posted publicly. | Everyone | 30 min |
| Fri 17:00 | **Demo. Cameras on. Working software only.** | Everyone | 45 min |
| Fri 17:45 | Weekly digest — hit, missed, why | Automatic | — |
| Fri 18:00 | Founder + CTO + Delivery: the week, the next week | Vivek, Musharaff, Shiva | 30 min |

The Friday demo is the whole accountability model. Nobody shows an empty screen
twice in front of their peers. Every ritual above can be skipped in a bad week
except this one.

### Meeting rules

- **Hard stop at the stated length.** Anything unfinished becomes a separate
  call with only the people who need to be in it.
- **No digest, no meeting.** If the automation failed, fixing it is the first
  item — a meeting improvising around missing data is how typed status creeps
  back in.
- **Written by default.** Any stand-up that can be a thread should be a thread.
  Remote teams pay for synchronous time twice: the meeting, and the focus lost
  around it.
- **One escalation ladder, with clocks.** Pod lead → Shiva, same day.
  Shiva → Musharaff, within 24 hours. Musharaff → Vivek, when it affects money,
  a client, or a safety claim. An item that skips a rung goes back down it.
- **Decisions are written where the work is** — in the issue or the PR, not in
  the meeting. A decision only spoken aloud did not happen either.

---

## 6. Onboarding, in five days

Interns rotate every three to six months. Onboarding speed is the real
throughput constraint, so it is a designed process, not a welcome chat.

- **Day 1** — Read this document. Read the module doc for your area. Get the
  environment running from the runbook. If the runbook fails, fixing it is your
  first task and your first PR.
- **Day 2** — Annotate or verify data in your domain. You learn the problem by
  looking at it.
- **Day 3** — Ship one small PR through the full path: Reviewer, CODEOWNER,
  merge.
- **Day 4** — You are assigned a **module**, not a task queue. You own it.
- **Day 5** — Start your own handover doc. Update it weekly from now on.

Nobody leaves this company without a current handover doc. That rule is what
stops knowledge walking out the door every four months.

---

## 7. Adding a new agent

Do not add one until a human owner has volunteered. Then write a brief that
answers, in order:

1. What it owns.
2. What it must never do.
3. Which tier, and why — using the "who finds out and when" test.
4. Which human owns its output.
5. What artifact proves its work.
6. What it should escalate rather than decide.

If you cannot answer 2 and 6, the agent is not ready.

---

## 8. Never delegated to an agent

- Architecture decisions
- Promoting anything to a validated trust level
- Client commitments and dates
- Any safety or accuracy claim made to a customer
- Hiring, firing, performance conversations
- Sending anything outside the company
- Production deploys

---

## 9. How we know this is working

Reviewed monthly. If these are not moving, the system is theatre.

| Signal | What good looks like |
|---|---|
| Items assigned with no artifact | Falling |
| PRs open more than 48 hours | Near zero |
| Escalations reaching the founder | Falling — they should stop at delivery or CTO |
| Time from intern start to first merged PR | Under 3 days |
| Modules with exactly one owner | 100% |
| Agent-authored share of merged work | Rising, with review depth holding |
| Things only one person knows | Falling |

---

*Owned by the CTO. Changes go through a PR like anything else.*
