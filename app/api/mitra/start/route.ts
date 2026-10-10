// GET  /api/mitra/start — who may start, and into which repositories.
// POST /api/mitra/start — { id, repo }: open a GitHub issue for a MITRA task
//                         and link the task to it.
//
// This is the seam between the plan and the work. Before it, a MITRA row is a
// line in a plan and its status is typed. After it, the row is a GitHub issue
// like any other task in Ops: it appears on the Ops board, an agent can be put
// on it, and its column on the MITRA board is derived from what happens in
// GitHub. The row's text is copied into the issue once, at this moment; after
// that the issue is the task and the row is a pointer to it.
//
// ONE ISSUE PER TASK, EVEN UNDER A DOUBLE PRESS
//
// The task is claimed in the store before GitHub is called, so a second press
// — or a colleague pressing at the same moment — gets "already being started"
// rather than a second issue. A claim whose request died is reclaimable after
// two minutes. If GitHub refuses, the claim is released and nothing is linked.

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { repos, taskHref } from "@/app/lib/repos";
import { openTask } from "@/app/lib/github";
import { noteNewTask } from "@/app/lib/work";
import { readTask, claimTask, settleClaim, ID_RE, ISSUE_RE } from "@/app/lib/mitra-store";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  try {
    const list = (await repos()).map((r) => r.full);
    return NextResponse.json({
      repos: list,
      suggested: list.find((r) => /mitra/i.test(r)) ?? process.env.OPS_REPO ?? list[0] ?? null,
      canStart: !!session.user.login,
      why: session.user.login
        ? ""
        : "Link your GitHub account to start a task. Tasks are GitHub issues, and everything that happens to one is attributed by GitHub login.",
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}

/** The plan's text, laid out as an issue someone can pick up without the board. */
function issueBody(t: Record<string, string>): string {
  const real = (v?: string) => (v && v.trim() && v.trim() !== "—" ? v.trim() : "");
  const section = (h: string, v?: string) => (real(v) ? `### ${h}\n${real(v)}\n\n` : "");
  const facts = [
    ["Epic", t.epic],
    ["Size", t.size],
    ["Skills", t.skills],
    ["Depends on", t.deps],
    ["Decision gate", t.gate],
  ]
    .filter(([, v]) => real(v))
    .map(([k, v]) => `- **${k}:** ${real(v)}`)
    .join("\n");
  return (
    section("What to do", t.what) +
    section("Deliverables", t.deliv) +
    section("Done when", t.done) +
    (facts ? `### From the plan\n${facts}\n\n` : "") +
    section("Notes", t.notes) +
    `_Started from the MITRA build board, task ${t.id}. Its column there now follows this issue._`
  );
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!session.user.login) {
    return NextResponse.json(
      { error: "Link your GitHub account to start a task. Tasks are GitHub issues, and everything that happens to one is attributed by GitHub login." },
      { status: 403 }
    );
  }

  let input: any;
  try {
    input = await req.json();
  } catch {
    return NextResponse.json({ error: "The request body is not JSON." }, { status: 400 });
  }
  const id = String(input?.id ?? "");
  const repo = String(input?.repo ?? "").trim();
  if (!ID_RE.test(id)) return NextResponse.json({ error: `"${id}" is not a MITRA task id.` }, { status: 400 });

  try {
    if (!(await repos()).some((r) => r.full === repo)) {
      return NextResponse.json(
        { error: `${repo || "That repository"} is not one this platform reports on, so the task would not appear on the Ops board. Pick one from the list.` },
        { status: 404 }
      );
    }

    const task = await readTask(id);
    if (!task) return NextResponse.json({ error: `${id} is no longer on the MITRA board. Somebody deleted it.` }, { status: 404 });
    if (!task.title?.trim()) return NextResponse.json({ error: `${id} has no title. Give it one first; the title becomes the issue's.` }, { status: 400 });

    const claim = await claimTask(id);
    if ("gone" in claim) return NextResponse.json({ error: `${id} is no longer on the MITRA board. Somebody deleted it.` }, { status: 404 });
    if ("existing" in claim) {
      const m = ISSUE_RE.exec(claim.existing);
      return NextResponse.json(
        m
          ? { error: `${id} was already started as ${claim.existing}.`, issue: claim.existing, href: taskHref(m[1], Number(m[2])) }
          : { error: `${id} is being started by somebody else right now. Wait a moment and it will show the issue.` },
        { status: 409 }
      );
    }

    let made;
    try {
      made = await openTask({
        repo,
        title: `${id}: ${task.title.trim()}`.slice(0, 256),
        body: issueBody(task),
        login: session.user.login,
        name: session.user.name ?? null,
      });
    } catch (e: any) {
      await settleClaim(id, claim.token, "").catch(() => {});
      return NextResponse.json({ error: e?.message ?? String(e) }, { status: 502 });
    }

    const ref = `${repo}#${made.number}`;
    noteNewTask(repo, made.issue);
    const linked = await settleClaim(id, claim.token, ref);
    if (!linked) {
      // Only possible if this request took longer than the claim's two
      // minutes and somebody else took it over. The issue exists; say so, so
      // nobody opens a third.
      return NextResponse.json(
        { error: `${ref} was opened, but the claim on ${id} expired first, so the board may not point at it. Check ${made.url} before starting ${id} again.` },
        { status: 409 }
      );
    }
    return NextResponse.json({ issue: ref, url: made.url, href: taskHref(repo, made.number) }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 503 });
  }
}
