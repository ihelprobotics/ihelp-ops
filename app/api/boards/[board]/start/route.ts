// GET  /api/boards/<board>/start — who may start and assign, into which
//                                  repositories, and the people a task can be given to.
// POST /api/boards/<board>/start — { id, repo, to? }: open a GitHub issue for a
//                                  task on that build board, link the task to
//                                  it, and — with `to` — assign it.
//
// This is the seam between the plan and the work. Before it, a plan row is a
// line in a plan and its status is typed. After it, the row is a GitHub issue
// like any other task in Ops: it appears on the Ops board, an agent can be put
// on it, and its column and assignee on the build board are derived from
// GitHub. The row's text is copied into the issue once, at this moment; after
// that the issue is the task and the row is a pointer to it.
//
// ASSIGNING A PLANNED TASK OPENS ITS ISSUE
//
// A name on a planning row would be a second, typed answer to "who has this",
// next to the one GitHub gives once the issue exists — and two answers means
// neither is true. So giving a planned task to somebody is the moment it
// becomes work: the issue opens with them on it. Who may give it to whom is
// app/lib/assign.ts, the same rules as the Ops board.
//
// One issue per task, even under a double press: see app/lib/plan-start.ts.

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sql, dbErrorMessage } from "@/lib/db";
import { repos } from "@/app/lib/repos";
import { canPlan } from "@/app/lib/roles";
import { canAssign, assignsOthers } from "@/app/lib/assign";
import { startPlanTask } from "@/app/lib/plan-start";
import { ID_RE } from "@/app/lib/plan-store";
import { planBoard, unknownBoard } from "@/app/lib/plan-boards";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const NO_LOGIN =
  "Link your GitHub account to start a task. Tasks are GitHub issues, and everything that happens to one is attributed by GitHub login.";

type Ctx = { params: Promise<{ board: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { board: key } = await params;
  const board = planBoard(key);
  if (!board) return NextResponse.json({ error: unknownBoard(key) }, { status: 404 });
  const role = session.user.role ?? "member";
  try {
    const [list, people] = await Promise.all([
      repos().then((r) => r.map((x) => x.full)),
      // Only people who can hold an issue. An account with no GitHub login has
      // no identity GitHub could put on one, so it is not offered.
      sql<{ login: string; name: string | null }[]>`
        select gh_login as login, name from app_user
         where active and gh_login is not null
         order by name nulls last, gh_login`,
    ]);
    // The plan's own repository comes first. If GitHub doesn't list it, say so
    // rather than quietly suggesting a different one.
    const home = board.repo ? list.find((r) => r.toLowerCase() === board.repo!.toLowerCase()) ?? null : null;
    return NextResponse.json({
      repos: home ? [home, ...list.filter((r) => r !== home)] : list,
      suggested: home ?? list.find((r) => r.toLowerCase().includes(key)) ?? process.env.OPS_REPO ?? list[0] ?? null,
      home: board.repo ?? null,
      homeMissing: board.repo && !home
        ? `${board.name}'s repository, ${board.repo}, isn't in the list GitHub returns for this token. It is archived, renamed, or the token can't see it. Pick the right one below, or check the token's repository access.`
        : null,
      canStart: !!session.user.login,
      why: session.user.login ? "" : NO_LOGIN,
      login: session.user.login ?? null,
      assignsOthers: assignsOthers({ login: session.user.login ?? null, role }),
      canPlan: canPlan(role),
      people,
    });
  } catch (e: any) {
    return NextResponse.json({ error: dbErrorMessage(e) }, { status: 503 });
  }
}

export async function POST(req: Request, { params }: Ctx) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { board: key } = await params;
  const board = planBoard(key);
  if (!board) return NextResponse.json({ error: unknownBoard(key) }, { status: 404 });
  const login = session.user.login;
  if (!login) return NextResponse.json({ error: NO_LOGIN }, { status: 403 });

  let input: any;
  try {
    input = await req.json();
  } catch {
    return NextResponse.json({ error: "The request body is not JSON." }, { status: 400 });
  }
  const id = String(input?.id ?? "");
  const repo = String(input?.repo ?? "").trim();
  const to = input?.to == null || input.to === "" ? null : String(input.to).trim();
  if (!ID_RE.test(id)) return NextResponse.json({ error: `"${id}" is not a ${board.name} task id.` }, { status: 400 });
  if (to !== null && !LOGIN_RE.test(to)) {
    return NextResponse.json(
      { error: `"${to}" is not a GitHub username. Assignment matches on the login, not on a display name or an email.` },
      { status: 400 }
    );
  }
  // Nobody holds a task that has no issue yet, so `current` is null.
  const refusal = to ? canAssign({ login, role: session.user.role ?? "member" }, null, to) : null;
  if (refusal) return NextResponse.json({ error: refusal }, { status: 403 });

  try {
    if (!(await repos()).some((r) => r.full === repo)) {
      return NextResponse.json(
        { error: `${repo || "That repository"} is not one this platform reports on, so the task would not appear on the Ops board. Pick one from the list.` },
        { status: 404 }
      );
    }
    const r = await startPlanTask({ board, id, repo, login, name: session.user.name ?? null, to });
    if ("error" in r) {
      const { status, ...rest } = r;
      return NextResponse.json(rest, { status });
    }
    return NextResponse.json(r, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 503 });
  }
}
