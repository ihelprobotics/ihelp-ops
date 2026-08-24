// GET /api/cron/daily-email
//
// Triggered by Vercel Cron at 12:30 UTC (18:00 IST). Runs the same logic as
// ops/daily-email.mjs: nudges to anyone with no artifact and no raised block,
// one digest to the CTO and delivery manager.

import { NextResponse } from "next/server";

export const maxDuration = 60;

export async function GET(req: Request) {
  // Vercel Cron sends this header. Without the guard, anyone who finds the URL
  // can make the whole team receive a nudge email.
  //
  // Checked before the comparison, not inside it. Interpolating an unset
  // variable produces the literal string "Bearer undefined", which does not
  // disable the guard so much as replace the secret with a constant anyone can
  // guess — the worse failure of the two, because it still looks guarded.
  if (!process.env.CRON_SECRET) {
    return NextResponse.json(
      { error: "CRON_SECRET is not set, so this request cannot be verified. Set it in the environment; Vercel Cron sends it as a Bearer token." },
      { status: 500 }
    );
  }
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json(
      { error: "The Authorization header does not match CRON_SECRET. Vercel Cron sends it automatically; a manual call needs it set by hand." },
      { status: 401 }
    );
  }

  try {
    const { runDailyEmail } = await import("@/ops/lib/daily-email.mjs");
    const result = await runDailyEmail();
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    // Say what broke. A cron that fails silently is worse than one that never ran.
    console.error("[cron] daily-email failed:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
