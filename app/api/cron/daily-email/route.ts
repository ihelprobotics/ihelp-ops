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
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
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
