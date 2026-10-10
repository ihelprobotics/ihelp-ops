// GET /api/mitra/live — derived status for every MITRA task started in Ops.
//
// Keyed by MITRA task id. Which issues to read comes from the store, not the
// caller; see app/lib/mitra-live.ts.

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { dbErrorMessage } from "@/lib/db";
import { readBoard } from "@/app/lib/mitra-store";
import { liveStatus } from "@/app/lib/mitra-live";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  try {
    const { tasks } = await readBoard();
    return NextResponse.json({ live: await liveStatus(tasks) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ error: dbErrorMessage(e) }, { status: 503 });
  }
}
