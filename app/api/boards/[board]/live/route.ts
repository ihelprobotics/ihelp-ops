// GET /api/boards/<board>/live — derived status for every task on that build
// board started in Ops.
//
// Keyed by task id. Which issues to read comes from the store, not the
// caller; see app/lib/plan-live.ts.

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { dbErrorMessage } from "@/lib/db";
import { readBoard } from "@/app/lib/plan-store";
import { liveStatus } from "@/app/lib/plan-live";
import { planBoard, unknownBoard } from "@/app/lib/plan-boards";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Ctx = { params: Promise<{ board: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { board: key } = await params;
  const board = planBoard(key);
  if (!board) return NextResponse.json({ error: unknownBoard(key) }, { status: 404 });
  try {
    const { tasks } = await readBoard(board.key);
    return NextResponse.json({ live: await liveStatus(board, tasks) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ error: dbErrorMessage(e) }, { status: 503 });
  }
}
