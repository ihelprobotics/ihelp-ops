#!/usr/bin/env node
// CLI wrapper. The logic lives in ops/lib/daily-email.mjs so that this command
// and the Vercel cron route run identical code — a second implementation would
// drift within a week and then nobody knows which digest is true.
//
//   RESEND_API_KEY=... DIGEST_TO=you@example.com node ops/daily-email.mjs

import { runDailyEmail } from "./lib/daily-email.mjs";

runDailyEmail()
  .then((r) => console.log("\ndone:", r))
  .catch((e) => { console.error("daily-email failed:", e); process.exit(1); });
