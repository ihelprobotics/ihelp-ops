// POST /api/boards/<board>/start-many — { ids, repo }: make each planned task
// on that build board a GitHub issue, in one go.
//
// Every small task on a plan is meant to become an issue, and pressing Start
// on each of 168 rows is how half of them never get pressed. But opening many
// issues at once puts work on a board other people read and plan around, so
// it is the same act as /api/plan/open and sits with the same roles — canPlan.
//
// AT MOST BATCH TASKS PER REQUEST
//
// Each one is a call to GitHub, and GitHub throttles issue creation. The board
// sends the list in slices and shows progress, so a request never approaches
// the function limit and a refusal partway stops the run with everything before
// it already linked. Each task goes through the same claim as a single start
// (app/lib/plan-start.ts), so a retry — or two leads running this at once —
// skips what is already started instead of opening it twice.
//
// Every task is reported on its own: started with its issue, or not with the
// reason. "Already started" is reported as such, not as a failure.

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { repos } from "@/app/lib/repos";
import { canPlan } from "@/app/lib/roles";
import { forgetWork } from "@/app/lib/work";
import { startPlanTask, type Started, type NotStarted } from "@/app/lib/plan-start";
import { ID_RE } from "@/app/lib/plan-store";
import { planBoard, unknownBoard } from "@/app/lib/plan-boards";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const BATCH = 10;

type Ctx = { params: Promise<{ board: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { board: key } = await params;
  const board = planBoard(key);
  if (!board) return NextResponse.json({ error: unknownBoard(key) }, { status: 404 });
  const login = session.user.login;
  if (!login) {
    return NextResponse.json(
      { error: "Connect your GitHub account (Connect GitHub, at the top of the Ops Board) first. Tasks are GitHub issues, and everything that happens to one is attributed by GitHub login." },
      { status: 403 }
    );
  }
  if (!canPlan(session.user.role ?? "member")) {
    return NextResponse.json(
      { error: `Making many ${board.name} tasks into issues at once is for leads, the CTO and the founder. You can start or assign a single task from its drawer.` },
      { status: 403 }
    );
  }

  let input: any;
  try {
    input = await req.json();
  } catch {
    return NextResponse.json({ error: "The request body is not JSON." }, { status: 400 });
  }
  const repo = String(input?.repo ?? "").trim();
  const ids: string[] = Array.isArray(input?.ids) ? input.ids.map(String) : [];
  if (!ids.length) return NextResponse.json({ error: `Send { ids: [...], repo }: the ${board.name} task ids to start.` }, { status: 400 });
  if (ids.length > BATCH) {
    return NextResponse.json({ error: `Send at most ${BATCH} tasks per request; the board sends them in slices.` }, { status: 400 });
  }
  const bad = ids.find((id) => !ID_RE.test(id));
  if (bad !== undefined) return NextResponse.json({ error: `"${bad}" is not a ${board.name} task id.` }, { status: 400 });

  try {
    if (!(await repos()).some((r) => r.full === repo)) {
      return NextResponse.json(
        { error: `${repo || "That repository"} is not one this platform reports on, so the tasks would not appear on the Ops board. Pick one from the list.` },
        { status: 404 }
      );
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 503 });
  }

  const results: (Started | NotStarted)[] = [];
  let stopped: string | null = null;
  for (const id of [...new Set(ids)]) {
    if (stopped) {
      results.push({ id, status: 0, error: `Not attempted: the run stopped at an earlier task. ${stopped}` });
      continue;
    }
    let r: Started | NotStarted;
    try {
      r = await startPlanTask({ board, id, repo, login, name: session.user.name ?? null });
    } catch (e: any) {
      r = { id, status: 503, error: e?.message ?? String(e) };
    }
    results.push(r);
    // GitHub refusing (token, throttling, issues disabled) will refuse the
    // next one too. Stop rather than burn through the list collecting the same
    // error — every task is either started or left exactly as it was.
    if ("error" in r && (r.status === 502 || r.status === 503)) stopped = r.error;
  }
  forgetWork(repo);

  return NextResponse.json({
    results,
    started: results.filter((r) => "issue" in r && !("error" in r)).length,
    stopped,
  });
}
