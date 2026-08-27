# Agent notes

## Issue #1 — "Document the ops scripts"

**Status: stopped, no changes made.**

The issue asks to "Add a README to ops/ explaining what each script does."
`ops/README.md` already exists. I read it in full against every file it
describes (`ops/daily-email.mjs`, `ops/lib/daily-email.mjs`,
`ops/lib/mail.mjs`, `ops/lib/db.mjs`, `ops/lib/gh.mjs`) and it is accurate:

- It correctly describes what each script does, not just what its name
  suggests (e.g. the nudge/digest split, the once-per-Indian-day dedup logic
  against `notification_log`, the lazy env-var checks in `lib/db.mjs` and
  `lib/gh.mjs`, the swallow-and-log behaviour in `lib/mail.mjs`).
- It lists every required and optional environment variable with what
  happens if each is missing, matching CLAUDE.md's "errors reach the user /
  never silently substitute" rule.
- It states plainly that GitHub is read live and never mirrored as a copy
  of record, matching `docs/06-non-negotiables.md`.
- Tone and structure match the rest of `docs/`.

There is nothing inaccurate, missing, or stale in the existing file.

**Question for the repo owner:** was issue #1 opened before this README was
added and never closed, or is there a different `ops/` script or a planned
addition that isn't in the tree yet that the issue intends me to document?
I did not find a second `ops/` directory, a stale duplicate, or any script
missing from the current README.

I made no code or doc changes. Rewriting a README that is already correct
risks introducing a discrepancy with the code that doesn't exist today, which
is worse than leaving it alone. If the intent was instead "review the
existing README for accuracy," I've done that above and found no
corrections needed — happy to close the issue on that basis if that's the
call, but that's a decision for a human, not mine to make unilaterally by
guessing.
