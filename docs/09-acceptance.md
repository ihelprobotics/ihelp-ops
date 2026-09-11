# Acceptance — how you know this is finished

Not "does it look built". A single run-through, in order, where each step is
either observably true or it is not.

Run it end to end once locally, then again on the live URL. Anything that does
not tick is not done, regardless of how much code exists.

---

## The end goal, in one sentence

**A person signs in, picks up a task, gets work done on it by an agent or by
themselves in VS Code, and the platform shows what happened — with evidence,
without anyone typing a status.**

Everything else in this product is in service of that sentence.

---

## Test 1 — Identity

1. Sign in with Google on a clean browser profile.
2. A row appears in `app_user` with your email.
3. Link a GitHub login for yourself in SQL, sign out, sign back in.
4. Header shows your name and `@login`.
5. Sign in as someone with **no** `gh_login`. The banner explains why they
   cannot run an agent; the run buttons are disabled.

**Fails if:** an unlinked account can dispatch anything.

---

## Test 2 — Tasks are real

1. `gh issue create` a new issue in `OPS_REPO`.
2. Reload the board. It is there, at 10%.
3. Break `OPS_REPO` deliberately (change a character) and reload. The error
   names which of the repo or the token is wrong. It is not a blank screen.
4. Put it back.

**Fails if:** an error renders as an empty list.

---

## Test 3 — The agent loop

1. Open the task. Pick **Scribe** in the agent grid, press **Have Scribe do
   this**, then **Run in GitHub Actions**.
2. `agent_run` gets a row: `status='running'`, your `requester_id`.
3. Within a few minutes a pull request exists in the repo, labelled
   `agent-authored`, tagging you as owner.
4. `agent_run` reaches `status='success'` with `pr_url` and a non-zero
   `cost_usd`.
5. As a `week1` user, Full-stack is greyed out and states why. Pressing it via
   the API directly returns 403 with a message naming your tier.
6. Start a third concurrent run. Refused, with the two-run limit explained.

**Fails if:** cost stays null (the callback is not wired), or tier gating is
only visual.

---

## Test 3b — The agent loop, through the Claude API

1. On the same kind of small, concrete task, pick **Scribe**, press **Have Scribe
   do this**, then **Run now**.
2. The run streams: the files it lists and reads, then what it writes, then the
   commit. `agent_run` has a row at `status='running'` from the first second.
3. A pull request opens on `agent/scribe/issue-<n>`, labelled `agent-authored`,
   naming you as owner, saying nothing was tested, with `Platform run: \`<uuid>\``.
4. The commit ends with `iHelp-Task: #<n>`, `commit_event` records it, and the
   board moves the card to **In review** with nobody touching it.
5. `agent_run` reaches `success` with `pr_url` and a non-zero `cost_usd`.
6. `npm run test:direct` passes: unlinked, draft agent, locked tier, unconfigured
   repository, bad brief and a third concurrent run are all refused before
   anything reaches the model or GitHub.

**Fails if:** the card does not move (the trailer or the branch name is wrong),
the pull request claims anything was tested, or a refused request left an
`agent_run` row.

---

## Test 4 — VS Code round trip

1. On `/task/<n>`, press **Start task**. Branch `task/<n>/<slug>` exists on
   GitHub.
2. Open in VS Code via the desktop link. It opens on that branch.
3. `git config core.hooksPath .githooks` once, then commit and push anything.
4. `git log -1 --format=%B` ends with `iHelp-Task: #<n>`.
5. `commit_event` has the commit, with `issue_number = <n>`.
6. The board moves that task to **40%** with nobody touching the platform.

**Fails if:** the commit lands but `issue_number` is null — the hook is not
installed in that clone.

---

## Test 5 — Progress reaches 100

This is the test that catches numbering mistakes. Run it on one task, all the
way through.

| Do | Board should read |
|---|---|
| Issue created | 10% |
| Start task | 20% |
| Push a commit | 40% |
| Open a PR (`Closes #n` in the body) | 60% |
| Checks pass | 75% |
| A human approves | 90% |
| Merge | 100% |

**Every one of these must be observed, not assumed.** A board that stops moving
at 40 or 60 means events are being stored under the pull request's number rather
than the task's — the two are drawn from one shared sequence in GitHub, so they
never match.

Cross-check in SQL:

```sql
select kind, number from gh_event
 where repo = 'owner/name' order by occurred_at desc limit 10;
```

Every row for that task must carry the **issue** number, whatever kind it is.

```sql
select * from cycle_time where issue_number = <n>;
```

One row, with `hours`. If this view is empty after a merge, the join is broken
and `/analytics` will be empty on the day you show it to someone.

---

## Test 6 — Local agent work is captured

1. `claude` in the repo clone, on a task branch. Ask it to do something small.
2. `local_session` gets a row with your user, the branch and the issue number.
3. On stop, `ended_at`, `files_changed` and `duration_minutes` fill.
4. Confirm nothing in that row contains a prompt or any code.

**Fails if:** any content is stored. Session metadata only.

---

## Test 7 — People and privacy

1. Book leave, approve it. The person appears in `on_leave_today`.
2. Run the digest. They are listed under ON LEAVE and receive no nudge.
3. Someone with no artifact and no raised block receives exactly one nudge.
4. Run it twice in a day. The second sends nothing.

Then the three assertions that must run against real Postgres:

```
a. a 'lead' cannot read a one_on_one authored by a 'cto'
b. every subject can read every note written about them
c. unset session context returns zero rows
```

**Fails if:** these pass without `DATABASE_URL` set. A green run with no
database must not imply isolation holds.

---

## Test 8 — Nothing is typed

Search the codebase:

```bash
grep -rniE "progress|percent|complete" app/ --include=*.tsx | grep -i "input\|onChange\|setState"
```

There must be no writable progress field anywhere. Same for hours:

```bash
grep -rniE "hours_online|time_spent|session_minutes|presence" app/ db/ ops/
```

Only the comments explaining why these do not exist.

---

## Done means

All eight pass locally, then all eight pass on the production URL with a second
person signed in.

At that point stop building and use it for a week. The next thing to build is
whatever the first intern gets stuck on — not whatever looks unfinished to you.
