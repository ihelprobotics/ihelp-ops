// GET  /api/mitra/board[?rev=n]  — the whole board, or { unchanged } when rev is current.
// POST /api/mitra/board          — { ops: [...] } field-level edits, or { seed } once.
//
// Any signed-in person may edit the plan. What they cannot do is type a status
// for a task that has been started in Ops, or write its link — the store drops
// both (app/lib/mitra-store.ts), so a stale tab cannot do it either.

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { readBoard, revision, seed, applyOps } from "@/app/lib/mitra-store";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in first." }, { status: 401, headers: noStore });
  try {
    const want = new URL(req.url).searchParams.get("rev");
    if (want != null) {
      const { rev } = await revision();
      if (Number(want) === rev) return NextResponse.json({ rev, unchanged: true }, { headers: noStore });
    }
    return NextResponse.json(await readBoard(), { headers: noStore });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 503, headers: noStore });
  }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in first." }, { status: 401, headers: noStore });
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "The request body is not JSON." }, { status: 400, headers: noStore });
  }
  try {
    if (body?.seed) {
      await seed(body.seed);
      return NextResponse.json({ ok: true }, { headers: noStore });
    }
    if (!Array.isArray(body?.ops)) {
      return NextResponse.json({ error: "Send { ops: [...] }: a list of patch or del operations." }, { status: 400, headers: noStore });
    }
    const results = await applyOps(body.ops);
    const { rev } = await revision();
    return NextResponse.json({ rev, results }, { headers: noStore });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 503, headers: noStore });
  }
}
