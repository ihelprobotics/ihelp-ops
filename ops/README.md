# ops/

Background jobs that run outside the request/response cycle of the app.
Currently there is one job: the daily digest and nudge email. Its logic lives
in `ops/lib/` so that the CLI entry point and the Vercel cron route run the
exact same code — see "Why the CLI just wraps a lib" below.

## Scripts

### `daily-email.mjs`

CLI wrapper around `ops/lib/daily-email.mjs`. Running it sends the same
nudge and digest emails that the production cron job sends, using whatever
`DATABASE_URL`, `GH_DISPATCH_TOKEN`, `RESEND_API_KEY`, etc. are set in your
shell.

Run it with:

```
RESEND_API_KEY=... DIGEST_TO=you@example.com node ops/daily-email.mjs
```

It prints the digest text to stdout and, on completion, logs a summary object
(`{ moved, quiet, onLeave, nudged, unsent }`).

This is also the script the Vercel cron route
(`app/api/cron/daily-email/route.ts`, scheduled in `vercel.json` for
`30 12 * * *` = 12:30 UTC / 18:00 IST) imports and runs on a schedule. The
route does not duplicate the logic — it calls `runDailyEmail()` from
`ops/lib/daily-email.mjs` directly. There is no separate "production version"
of this job; running the CLI locally runs the identical code path.

**Caveat:** because it sends real email through Resend and writes rows to
`notification_log`, running it against a real `DATABASE_URL` will nudge real
people and will consume one Resend send per recipient. There is no dry-run
flag. If you want to see the digest text without emailing anyone, unset
`RESEND_API_KEY` — sends are then logged and skipped (see `lib/mail.mjs`
below) rather than sent, and nothing is written to `notification_log` for the
skipped sends.

### `lib/daily-email.mjs`

The actual logic, exported as `runDailyEmail()`. Not a script you run
directly. Two things happen each time it runs:

1. **Nudges.** For every active user with an email, who is not on approved
   leave today (`on_leave_today` view), the script totals their GitHub
   activity in the last 24 hours across the repos listed in `REPOS` (or
   `OPS_REPO`): commits authored, PRs updated in the last 24h, and open
   issues labelled `blocked` or `needs-human` and updated in the last 24h
   where they're an assignee. Anyone with zero commits/PRs/reviews **and**
   zero raised blocks is "quiet" and gets a nudge email, once per Indian
   calendar day — enforced by checking `notification_log` against the same
   `(sent_at at time zone 'Asia/Kolkata')::date` expression that backs the
   `nudge_once_per_day` unique index in the database, so the code and the
   index agree on what "today" means even though the server runs in UTC.
   A nudge is written to `notification_log` only if the send actually
   succeeded — a failed send is not recorded, so tomorrow's real nudge is not
   suppressed by a row that claims one already went out.

2. **One digest.** A single summary email — MOVED (commits/PRs/blocks per
   person), QUIET (nobody who shipped nothing was contacted, but the list is
   named), and ON LEAVE — goes to every address in `DIGEST_TO`, once per run
   (not once per person).

Reads `app_user`, `on_leave_today` and `notification_log` from the database
and calls the GitHub REST API for commits/PRs/issues on each repo in scope.
Writes only to `notification_log` (one row per email actually sent). Never
mirrors GitHub issues, PRs or commits into the database as a copy of record —
it reads them live on every run, consistent with "GitHub is the source of
truth" in `CLAUDE.md`.

**Environment needed:**

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Supabase transaction pooler connection (see `lib/db.mjs`) |
| `GH_DISPATCH_TOKEN` | yes | GitHub token used for all API reads (see `lib/gh.mjs`) |
| `REPOS` or `OPS_REPO` | yes | comma-separated `org/repo` list to scan for activity |
| `RESEND_API_KEY` | no | without it, sends are logged to the console and skipped, not sent |
| `MAIL_FROM` | no | defaults to `iHelp Ops <ops@ihelprobotics.com>` |
| `DIGEST_TO` | no | comma-separated recipients for the digest; empty means no digest is sent |
| `PLATFORM_URL` | no | included in the emails as a link back to the platform |

Missing `DATABASE_URL` or `GH_DISPATCH_TOKEN` raises immediately with a
message naming the missing variable, rather than running with an empty
result that would read as "everyone is quiet" or "nothing moved."

### `lib/mail.mjs`

Thin wrapper over the Resend HTTP API. Exports `sendMail({ to, subject,
body })`.

- If `RESEND_API_KEY` is not set, it logs what *would* have been sent and
  returns `{ skipped: true }` without making a network call. It does not
  raise, and the caller in `lib/daily-email.mjs` treats a skipped send the
  same as a failed one for logging purposes (no `notification_log` row is
  written).
- If Resend returns a non-2xx response, it logs the status and body and
  returns `{ ok: false }`.
- On success it returns `{ ok: true }`.

A failed or skipped send is deliberately swallowed here rather than thrown —
the comment in the file is explicit that a broken mail provider must not stop
the rest of the digest job from finishing and recording what it found.

### `lib/db.mjs`

Exports `sql`, a lazily-constructed `postgres` client (the Supabase variant:
transaction pooler, `prepare: false`, `max: 3`). Lazy because this module is
imported both by the CLI and by the Vercel cron route, and a hard failure at
import time (e.g. `DATABASE_URL` missing) would otherwise crash the whole
route before its own error handler could run. The check for `DATABASE_URL`
happens on first use of `sql`, not on import, and the error names the missing
variable explicitly.

### `lib/gh.mjs`

GitHub API helpers for the background jobs:

- `gh(path)` — single authenticated GET, JSON response.
- `ghAll(path, maxPages)` — same, but follows the `Link: rel="next"` header
  up to `maxPages` pages (default 5) and concatenates results.
- `repos()` — reads `REPOS` (falling back to `OPS_REPO`) and returns the
  parsed, trimmed list of `org/repo` strings. Throws if the list is empty,
  naming which environment variables to set.
- `hoursSince(iso)` / `fmtAge(h)` — small time helpers used for "updated in
  the last 24h" checks and for formatting an age for display.

Authentication uses `GH_DISPATCH_TOKEN`, read lazily inside `token()` so
that, as with `lib/db.mjs`, a missing token raises a named error at call
time rather than crashing the module at import time. Nothing in this file
calls `process.exit` — it is imported by the Vercel route, where a hard exit
would kill the serverless function instead of letting the route's own
`catch` return a proper error response.

## How this fits together

`ops/daily-email.mjs` (CLI) and `app/api/cron/daily-email/route.ts` (Vercel
Cron, scheduled in `vercel.json`) are the only two callers of
`runDailyEmail()`. Both run the identical function from
`ops/lib/daily-email.mjs`; there is no logic duplicated between a "local"
and a "production" version of this job. If you need to change what the daily
email does, change `ops/lib/daily-email.mjs` — both callers pick it up.
