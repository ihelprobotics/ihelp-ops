# iHelp Ops — Complete Build Guide

Every step, in order, from an empty folder to a live platform.

Read once before starting. Then work top to bottom. Do not skip ahead: several
steps look optional and are not, and the ones that look tedious are the ones
that fail at 1am if you skipped them.

**Time:** 4–6 hours for Steps 1–4 (working locally). 1–2 hours for Step 5
(live). Doing both in one night is realistic only if the accounts in Step 1 are
already done.

---

# PART 0 — Your machine

## 0.1 Software

Check what you have:

```bash
node --version     # need 20 or higher
git --version
gh --version       # GitHub CLI
code --version     # VS Code
claude --version   # Claude Code
```

Install anything missing:

```bash
# Node 20+ — use nvm if your system node is older
nvm install 20 && nvm use 20

# GitHub CLI
#   macOS:    brew install gh
#   Windows:  winget install GitHub.cli
#   Linux:    see cli.github.com

# Claude Code
npm install -g @anthropic-ai/claude-code
```

## 0.2 Authenticate the CLIs

```bash
gh auth login          # HTTPS, authenticate via browser
gh auth status         # confirm

claude                 # first run walks you through sign-in, then /exit
```

**Check:** `gh repo list` prints your repos.

---

# PART 1 — Accounts and credentials

Do all of these before writing any code. Each one blocks a later step.

Keep a scratch file open and paste each value in as you get it. You will need
eight values in total.

## 1.1 Neon (database)

1. Go to `neon.tech`, sign in with GitHub.
2. **Create project.** Name `ihelp-ops`. Region: Singapore or Mumbai — nearest
   to Bengaluru.
3. On the dashboard, **Connection string** → select **Pooled connection**.
4. Copy it. It looks like
   `postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require`

→ Save as `DATABASE_URL`

**The pooled string matters.** The direct one exhausts connections on
serverless.

## 1.2 Google OAuth (login)

1. `console.cloud.google.com` → **New Project** → name `iHelp Ops` → Create.
2. Left menu → **APIs & Services** → **OAuth consent screen**.
   - If you have Google Workspace: choose **Internal**. Only your domain can
     sign in, and you skip verification entirely.
   - If not: **External**, then add each team member under **Test users**.
   - App name `iHelp Ops`, support email, developer email. Save through.
3. **Credentials** → **Create credentials** → **OAuth client ID**.
   - Application type: **Web application**
   - Name: `ihelp-ops-web`
   - **Authorised redirect URIs** — add both now:
     ```
     http://localhost:3000/api/auth/callback/google
     https://ihelp-ops.vercel.app/api/auth/callback/google
     ```
     The second does not exist yet. Add it anyway; coming back here later is
     how people lose twenty minutes at midnight.
4. Create. Copy the Client ID and Client secret.

→ Save as `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`

## 1.3 GitHub token

1. GitHub → your avatar → **Settings** → **Developer settings** →
   **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
2. Name `ihelp-ops-platform`. Expiry 90 days.
3. **Repository access** → *Only select repositories* → pick your code repo
   (for example `ihelp/ev-edge`).
4. **Permissions** → Repository permissions:

   | Permission | Access |
   |---|---|
   | Actions | Read and write |
   | Contents | Read and write |
   | Issues | Read and write |
   | Pull requests | Read and write |
   | Metadata | Read (auto) |

5. Generate. Copy immediately — it is shown once.

→ Save as `GH_DISPATCH_TOKEN`

## 1.4 Anthropic API key

1. `console.anthropic.com` → **API keys** → **Create key**. Name `ihelp-agents`.
2. **Then go to Settings → Limits and set a monthly spending limit.** Do this
   now, not later. An agent in a loop is a real thing and the cap is the only
   thing between you and it.

→ Save as `ANTHROPIC_API_KEY` (goes in the **code repo**, not the platform)

## 1.5 Webhook secret

```bash
openssl rand -hex 24
```

→ Save as `GH_WEBHOOK_SECRET`

## 1.6 Auth secret

```bash
openssl rand -base64 32
```

→ Save as `AUTH_SECRET`

## 1.7 Resend (email — can wait until Phase 7)

`resend.com` → sign up → **API keys** → create. Free tier is 3,000 emails a
month, which is more than enough.

→ Save as `RESEND_API_KEY`

## 1.8 Vercel

`vercel.com` → sign in with GitHub. Nothing else yet.

**Checkpoint:** you should now have eight values written down. If any is
missing, get it before continuing.

---

# PART 2 — Project setup

## 2.1 Create the project

```bash
mkdir ~/projects/ihelp-ops && cd ~/projects/ihelp-ops
```

Copy the bundle in so the tree looks like this:

```
ihelp-ops/
├── CLAUDE.md
├── package.json
├── tsconfig.json
├── next.config.mjs
├── middleware.ts
├── auth.ts
├── .env.example
├── .githooks/prepare-commit-msg
├── .claude/settings.json
├── app/
│   ├── layout.tsx
│   ├── page.tsx
│   ├── login/page.tsx
│   ├── lib/github.ts
│   └── api/
│       ├── auth/[...nextauth]/route.ts
│       ├── tasks/route.ts
│       ├── agents/run/route.ts
│       ├── agents/local/route.ts
│       └── webhooks/github/route.ts
├── lib/db.ts
├── db/
│   ├── schema.sql
│   ├── schema-people.sql
│   └── schema-people-growth.sql
├── ops/daily-email.mjs
└── docs/
    ├── 00-brief.md … 07-operating-model.md
```

## 2.2 Install

```bash
npm install
```

Expect warnings about the next-auth beta. That is fine.

## 2.3 Environment

```bash
cp .env.example .env.local
```

Open `.env.local` and paste your eight values:

```bash
AUTH_SECRET=<from 1.6>
AUTH_GOOGLE_ID=<from 1.2>
AUTH_GOOGLE_SECRET=<from 1.2>
AUTH_URL=http://localhost:3000
DATABASE_URL=<from 1.1, the POOLED one>
GH_DISPATCH_TOKEN=<from 1.3>
GH_WEBHOOK_SECRET=<from 1.5>
OPS_REPO=your-org/your-repo
PLATFORM_URL=http://localhost:3000
```

## 2.4 Git, before anything else

```bash
git init
printf 'node_modules/\n.next/\n.env*.local\n.vercel\n.DS_Store\n' > .gitignore
git add -A && git commit -m "iHelp Ops: scaffold"
```

**Verify `.env.local` is not staged:**

```bash
git status --short | grep env || echo "clean — no env file tracked"
```

A secret in git history is a rotation, not a delete.

---

# PART 3 — Database

## 3.1 Apply the schema

Neon dashboard → **SQL Editor**. Paste and run each file **in this order**, one
at a time:

1. `db/schema.sql`
2. `db/schema-people.sql`
3. `db/schema-people-growth.sql`

Order matters — later files alter tables the earlier ones create.

## 3.2 Verify

```sql
select table_name from information_schema.tables
where table_schema = 'public' order by table_name;
```

Expect: `agent_run`, `app_user`, `commit_event`, `feedback_note`, `gh_event`,
`goal`, `goal_evidence`, `leave_balance`, `leave_request`, `local_session`,
`note_access_log`, `notification_log`, `one_on_one`.

Check RLS is on:

```sql
select relname, relrowsecurity, relforcerowsecurity
from pg_class
where relname in ('goal','one_on_one','feedback_note','goal_evidence');
```

All four must show `t` and `t`. If they show `f`, the third file did not run
fully — re-run it and read the error.

---

# PART 4 — STEP 1: Build everything, locally

Work phase by phase. Each has an exact prompt for Claude Code, a check, and the
usual failures. **Do not start a phase until the previous check passes.**

Start Claude Code in the project:

```bash
cd ~/projects/ihelp-ops
claude
```

It loads `CLAUDE.md` automatically.

---

## Phase 1 — Sign-in works

**Prompt:**

```
Read CLAUDE.md and docs/00-brief.md, docs/01-architecture.md, docs/02-data-model.md.

Then verify Phase 1 of docs/04-step1-build.md: Google sign-in creates a row in
app_user and the session carries login, role and tier.

Do not build any other page. Report what you changed and stop.
```

**Then, by hand:**

```bash
npm run dev
```

Open `http://localhost:3000`. You should be redirected to `/login`. Sign in.

Check the row exists — Neon SQL editor:

```sql
select email, name, gh_login, role, agent_tier from app_user;
```

Link yourself:

```sql
update app_user
   set gh_login = 'your-github-username',
       role = 'cto',
       agent_tier = 'full',
       gh_linked_at = now()
 where email = 'you@ihelprobotics.com';
```

Sign out and back in so the token refreshes.

**Check:** the header shows your name and `@your-github-username`.

| Failure | Cause |
|---|---|
| Redirect loop | `AUTH_URL` does not match the address bar exactly |
| `Configuration` error | `AUTH_SECRET` missing from `.env.local` |
| `redirect_uri_mismatch` | The URI in Google Cloud differs — check for a trailing slash |
| No row in `app_user` | `DATABASE_URL` wrong, or schema not applied |

---

## Phase 2 — Tasks from GitHub

**Prompt:**

```
Phase 2 of docs/04-step1-build.md.

/api/tasks reads open issues live from OPS_REPO. The board renders them with
progress derived from gh_event. Empty and error states must say which of the
token or the repo name is the problem — never a blank screen.

Do not mirror issues into the database.
```

Open an issue in your code repo to test against:

```bash
gh issue create --repo your-org/your-repo \
  --title "Document the ops scripts" \
  --body "Add a README to the ops/ folder explaining what each script does and when it runs. Do not change any code."
```

**Check:** that issue appears on the board at 10%.

| Failure | Cause |
|---|---|
| 401 from GitHub | Token expired or wrong |
| 404 from GitHub | `OPS_REPO` wrong, or the token's repository list does not include it |
| Empty, no error | Genuinely no open issues — create one |

---

## Phase 3 — The agent loop

**The phase that matters. Get this right before touching UI.**

### 3a — Prepare the code repo

In your **code** repo (not the platform), commit these from the agent-ops
bundle:

```
CLAUDE.md
.claude/agents/*.md          (13 files)
.github/workflows/agent-run.yml
.github/workflows/reviewer.yml
.github/CODEOWNERS
```

```bash
cd ~/projects/your-code-repo
git add CLAUDE.md .claude .github
git commit -m "ops: agent definitions and workflows"
git push
```

**`agent-run.yml` must be on the default branch or workflow dispatch returns
404.**

### 3b — Repo settings

- Settings → **Actions** → **General** → Workflow permissions →
  **Read and write permissions**. Save.
- Settings → **Secrets and variables** → **Actions** → New repository secret:
  `ANTHROPIC_API_KEY`.

### 3c — Run the workflow by hand, and watch it

This is the step that answers "where does the agent actually run".

GitHub → **Actions** → **Agent run** → **Run workflow**:

- agent: `scribe`
- issue: the number from Phase 2
- requester: your GitHub username
- run_id: `test-1`

Open the running job and watch. You will see it check out the repo, install
Claude Code, read the issue, edit files, commit, push a branch and open a PR.

**Check:** a pull request exists in the repo, opened by the agent.

| Failure | Cause |
|---|---|
| 404 on dispatch | Workflow not on the default branch |
| `ANTHROPIC_API_KEY` not found | Secret added to the wrong repo or misnamed |
| Permission denied on push | Workflow permissions still read-only |
| Runs, no changes | The issue was too vague. Rewrite it — that is the correct lesson |

### 3d — Now the platform button

**Prompt:**

```
Phase 3 of docs/04-step1-build.md.

Wire the agent grid on the board to /api/agents/run. Respect agent_tier gating
and the two-concurrent-run limit already in the route. Show run status until the
PR URL arrives. Locked agents stay visible and greyed with the reason.
```

Press Run on `scribe` against the same issue.

**Check:**

```sql
select agent, status, pr_url, cost_usd, input_tokens
from agent_run order by started_at desc limit 5;
```

A row with `status='running'`, then a PR in the repo. Cost fills once you add
the callback in Step 5 — null here is expected.

---

## Phase 4 — Task detail and VS Code

**Prompt:**

```
Phase 4 of docs/04-step1-build.md, using the helpers in app/lib/github.ts.

/task/[number]: live branch, commits, PR, checks, Reviewer verdict, human
approval. A "Start task" action that creates task/<issue>/<slug>. The three
launch options: desktop vscode:// link, vscode.dev browser link, terminal
command. Comments mirrored to the GitHub issue.
```

**Check:** Start task creates the branch (`git fetch && git branch -r` shows
it), and the desktop link opens VS Code on it.

---

## Phase 5 — Events and live progress

**Prompt:**

```
Phase 5 of docs/04-step1-build.md.

Confirm /api/webhooks/github handles issues, pull_request, pull_request_review,
push and workflow_run, verifies the signature, and rejects unsigned requests.
Progress on the board must come from gh_event with no manual step anywhere.
```

To test locally you need a tunnel:

```bash
npx localtunnel --port 3000
# or: ngrok http 3000
```

Add the webhook in the code repo → Settings → Webhooks:

- Payload URL: `https://<tunnel>/api/webhooks/github`
- Content type: `application/json`
- Secret: your `GH_WEBHOOK_SECRET`
- Events: Issues, Pull requests, Pull request reviews, Pushes, Workflow runs

Push a commit.

**Check:**

```sql
select kind, number, actor, occurred_at from gh_event order by occurred_at desc limit 10;
```

Then reload the board — the task with an open PR should read 60%.

If tunnelling is fiddly, skip to Phase 6 and do this in Step 5 on the real
domain. Everything else works without it.

---

## Phase 6 — People, leave, goals, notes

**Prompt:**

```
Phase 6 of docs/04-step1-build.md.

Build /team, /leave, /me and /person/[id] per docs/03-features.md.

Every query touching goal, one_on_one, feedback_note or goal_evidence must set
session context first:
  select set_config('app.user_id', $1, true);
  select set_config('app.user_role', $2, true);

Then write tests against real Postgres proving:
  1. a 'lead' cannot read a one_on_one authored by a 'cto'
  2. every subject can read every note about themselves
  3. unset session context returns zero rows

Skip loudly if DATABASE_URL is absent — a green run without these tests must not
imply isolation holds.
```

**Check:** those three tests pass against Neon. Not asserted, not assumed —
run.

Seed some data to look at:

```sql
insert into leave_request (user_id, kind, starts_on, ends_on, reason, status)
select id, 'planned', current_date + 3, current_date + 5, 'test', 'approved'
from app_user limit 1;

select * from on_leave_today;
```

---

## Phase 7 — Analytics and email

**Prompt:**

```
Phase 7 of docs/04-step1-build.md.

/analytics from the cycle_time and review_latency views plus gh_event: cycle
time, review latency, stalled items, claimed-versus-proven, agent-authored share
per person, rework rate, cost per person and per agent.

No hours-online metric anywhere — see docs/06-non-negotiables.md.

Then create lib/mail.mjs wrapping Resend and wire ops/daily-email.mjs to it.
```

Test the digest:

```bash
RESEND_API_KEY=... DIGEST_TO=you@ihelprobotics.com node ops/daily-email.mjs
```

**Check:** the email arrives, names the right people, and skips whoever you put
on leave in Phase 6.

---

## Step 1 is done when

A person can sign in, see real tasks, run an agent, get a PR, open the branch in
VS Code, push, watch progress move on its own, book leave, and read their own
goals and notes — all on localhost, against real services.

Commit:

```bash
git add -A && git commit -m "iHelp Ops: step 1 complete"
```

---

# PART 5 — STEP 2: Make it live

## 5.1 Push the repo

```bash
gh repo create ihelp-ops --private --source=. --push
```

## 5.2 Vercel

1. `vercel.com` → **Add New** → **Project** → import `ihelp-ops`.
2. Framework: Next.js (detected). Do not change build settings.
3. **Environment Variables** — add every line from `.env.local`, with two
   changed:
   ```
   AUTH_URL=https://ihelp-ops.vercel.app
   PLATFORM_URL=https://ihelp-ops.vercel.app
   ```
4. Add `RESEND_API_KEY`, `DIGEST_TO`, and `CRON_SECRET` (another
   `openssl rand -hex 24`).
5. **Deploy.**

## 5.3 Fix the Google redirect

Vercel gives you the real domain. Go back to Google Cloud → Credentials → your
client → confirm the authorised redirect URI matches it **exactly**:

```
https://ihelp-ops.vercel.app/api/auth/callback/google
```

**Check:** sign in on the live URL.

This is the single most common production failure. If sign-in works locally and
not live, it is this, ninety percent of the time.

## 5.4 Custom domain (optional)

Vercel → Settings → Domains → add `ops.ihelprobotics.com`. Add the CNAME at
your registrar. Then update `AUTH_URL`, `PLATFORM_URL` **and the Google redirect
URI** again, and redeploy.

## 5.5 Webhook, for real

Code repo → Settings → Webhooks → Add (or edit the tunnel one):

- Payload URL: `https://<your-domain>/api/webhooks/github`
- Secret: `GH_WEBHOOK_SECRET`
- Events: Issues, Pull requests, Pull request reviews, Pushes, Workflow runs

Push a commit, then check **Recent Deliveries** on the webhook page. Expect
`200`. A `401` means the secrets differ.

## 5.6 Agent callback

Code repo → Secrets → add `PLATFORM_WEBHOOK` =
`https://<your-domain>/api/webhooks/agent`

Run an agent from the platform. `agent_run.cost_usd` should now fill.

## 5.7 Cron

Add `vercel.json`:

```json
{
  "crons": [
    { "path": "/api/cron/daily-email", "schedule": "30 12 * * *" }
  ]
}
```

That is 18:00 IST. Have the route reject anything without the `CRON_SECRET`
header. Commit and push; Vercel picks it up.

## 5.8 Add the team

```sql
insert into app_user (email, name, gh_login, role, agent_tier, pod) values
 ('musharaff@ihelprobotics.com','Musharaff','<gh>','cto',   'full', 'platform'),
 ('shiva@ihelprobotics.com',    'Shiva',     null,  'lead',  'week1', null),
 ('midhath@ihelprobotics.com',  'Midhath',  '<gh>','member','week2','platform'),
 ('tushar@ihelprobotics.com',   'Tushar',   '<gh>','member','week2','eldercare-ev'),
 ('manasa@ihelprobotics.com',   'Manasa',   '<gh>','member','week1','eldercare-ev'),
 ('rahil@ihelprobotics.com',    'Rahil',    '<gh>','member','week1','platform'),
 ('samay@ihelprobotics.com',    'Samay',    '<gh>','member','week2','platform'),
 ('shaistha@ihelprobotics.com', 'Shaistha', '<gh>','member','week1','spatial-apps'),
 ('danish@ihelprobotics.com',   'Danish',   '<gh>','member','week2','spatial-apps'),
 ('hashithosh@ihelprobotics.com','Hashithosh','<gh>','member','week1','spatial-apps');

insert into leave_balance (user_id, year, entitled)
select id, extract(year from current_date)::int, 12 from app_user;
```

Shiva has no `gh_login` on purpose: he can read everything and manage leave, but
cannot dispatch an agent, because work he dispatched could not be attributed to
a git identity.

## 5.9 Engineers, once per clone

```bash
cd your-code-repo
git config core.hooksPath .githooks
chmod +x .githooks/prepare-commit-msg
```

Verify: make a commit on a `task/142/...` branch and check
`git log -1 --format=%B` ends with `iHelp-Task: #142`.

---

# PART 6 — Final verification

Run through this on the live URL. Tick every line.

- [ ] Google sign-in works on the production domain
- [ ] A second person can sign in and sees their own view
- [ ] Tasks load from GitHub
- [ ] An agent run from the platform opens a PR in the code repo
- [ ] `agent_run` records status, `pr_url` and `cost_usd`
- [ ] Tier gating: a `week1` user cannot run `fullstack`
- [ ] Two-run limit refuses a third
- [ ] Start task creates the branch; the VS Code link opens it
- [ ] A push moves a progress bar with nobody touching it
- [ ] Commit trailers attribute commits to tasks
- [ ] Leave request and approval work; `on_leave_today` fills
- [ ] RLS: a lead cannot read a CTO 1:1
- [ ] RLS: every subject reads every note about themselves
- [ ] The daily digest arrives and skips people on leave
- [ ] A spending limit is set on the Anthropic key
- [ ] `.env.local` is not in git history

---

# PART 7 — First week

**Day 1.** You use it alone. Fix whatever breaks.

**Day 2.** Musharaff and one intern. Watch them, silently, for ten minutes
each. Fix what confuses them — not what looks unfinished to you.

**Day 3.** The whole team. Send the operating model and the onboarding PDF the
same morning, so the platform arrives with its rules rather than after them.

**Day 5.** First Friday demo with the board on screen.

**Week 2.** Read `/analytics`. If review latency is high, that is the
second-reviewer gap showing up as a number — which is what it was built to do.

UI and UX come after. The loop working end to end is what matters first.

---

# Appendix A — Failure table

| Symptom | Cause | Fix |
|---|---|---|
| Sign-in loops | `AUTH_URL` mismatch | Match the address bar exactly, redeploy |
| `redirect_uri_mismatch` | Google URI differs | Copy it character for character |
| `Configuration` error | `AUTH_SECRET` missing | Set it, restart |
| Tasks 401 | Token expired | Regenerate the PAT |
| Tasks 404 | `OPS_REPO` wrong or token cannot see it | Check the token's repository list |
| Dispatch 404 | Workflow not on default branch | Push `agent-run.yml` to `main` |
| Dispatch 403 | Token lacks Actions write | Regenerate with Actions RW |
| Agent runs, no changes | Issue too vague | Rewrite the issue with a concrete outcome |
| Workflow push denied | Read-only workflow permissions | Settings → Actions → General |
| Webhook 401 | Secret mismatch | Same value both sides |
| RLS returns nothing | Session context not set | `set_config` in the same transaction |
| Neon connection exhausted | Direct instead of pooled string | Use the `-pooler` host |
| Cron never fires | `vercel.json` not committed | Commit and redeploy |

# Appendix B — Useful commands

```bash
npm run dev                                   # local
npx tsc --noEmit                              # typecheck
gh workflow run agent-run.yml -f agent=scribe -f issue=1 -f requester=you -f run_id=manual-1
gh run watch                                  # follow the latest run
gh pr list --repo your-org/your-repo
vercel logs <deployment-url>
```

# Appendix C — SQL you will want

```sql
-- who is on the platform
select name, email, gh_login, role, agent_tier, pod from app_user order by role;

-- recent agent runs with cost
select u.name, r.agent, r.status, r.cost_usd, r.pr_url, r.started_at
from agent_run r join app_user u on u.id = r.requester_id
order by r.started_at desc limit 20;

-- spend this month, per person
select u.name, round(sum(r.cost_usd), 2) as usd, count(*) as runs
from agent_run r join app_user u on u.id = r.requester_id
where r.started_at > date_trunc('month', current_date)
group by u.name order by usd desc nulls last;

-- cycle time, last 30 days
select opened_by, round(avg(hours)::numeric, 1) as avg_hours, count(*)
from cycle_time where merged_at > now() - interval '30 days'
group by opened_by order by avg_hours;

-- assigned but unproven: the ownership signal
select actor, count(*) from gh_event
where kind = 'issue_opened' and occurred_at < now() - interval '24 hours'
group by actor;

-- move someone up a tier
update app_user set agent_tier = 'week2' where email = 'tushar@ihelprobotics.com';
```

---

**One last thing.** This platform makes work visible and attributable, which is
worth having. It does not make the team faster — merging daily, a second
reviewer who is not the CTO, and a camera on a site do that. Build it because it
is useful. Do not let it absorb the week eldercare needs.
