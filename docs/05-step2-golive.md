# Step 2 — Make it live

Only after Step 1's definition of done is met.

---

## 1. Repository

```bash
git init && git add -A && git commit -m "iHelp Ops v0"
gh repo create ihelp-ops --private --source=. --push
```

`.env.local` must not be committed. Confirm `.gitignore` covers it before the
first push — a secret in git history is a rotation, not a delete.

---

## 2. Vercel

Import the repo. Add every variable from `.env.local`, with two changed:

```
AUTH_URL=https://<vercel-domain>
PLATFORM_URL=https://<vercel-domain>
```

Deploy.

---

## 3. Google OAuth

Add the production redirect URI, exactly:

```
https://<vercel-domain>/api/auth/callback/google
```

A mismatch here is the single most common reason sign-in works locally and
fails in production.

Custom domain (`ops.ihelprobotics.com`): set it in Vercel, then update
`AUTH_URL`, `PLATFORM_URL` and the Google redirect URI again.

---

## 4. Webhook

In the **code** repo → Settings → Webhooks:

- Payload URL `https://<domain>/api/webhooks/github`
- Content type `application/json`
- Secret: the same value as `GH_WEBHOOK_SECRET`
- Events: Issues, Pull requests, Pull request reviews, Pushes, Workflow runs

Push a commit and confirm `gh_event` fills. Check the webhook's Recent
Deliveries tab for the response code — a 401 means the secrets differ.

---

## 5. Agent callback

Set `PLATFORM_WEBHOOK` in the code repo secrets to
`https://<domain>/api/webhooks/agent` so runs report cost and PR URL back.

---

## 6. Cron

Vercel cron for the daily digest, `vercel.json`:

```json
{ "crons": [{ "path": "/api/cron/daily-email", "schedule": "30 12 * * *" }] }
```

That is 18:00 IST. Guard the route with a `CRON_SECRET` header.

---

## 7. People

Insert the team into `app_user`. Shiva gets no `gh_login` — deliberate: he can
read everything and book leave, but cannot dispatch an agent, because work he
dispatched could not be attributed to a git identity.

Each engineer, once per clone:

```bash
git config core.hooksPath .githooks
chmod +x .githooks/prepare-commit-msg
```

---

## 8. Verify in production

- [ ] Google sign-in works on the real domain
- [ ] Tasks load from GitHub
- [ ] An agent run from the platform opens a PR
- [ ] `agent_run` records cost
- [ ] A push moves a progress bar without anyone touching it
- [ ] Leave request and approval work
- [ ] RLS holds: the delivery manager cannot read a CTO 1:1
- [ ] The digest email arrives
- [ ] Spending limit is set on the Anthropic key

---

## 9. First week live

Watch one intern use it before changing anything. Fix what confuses them, not
what looks unfinished to you.

UI and UX come after. The loop working end to end is the thing that matters
first.
