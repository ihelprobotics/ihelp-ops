// Turning one build-board plan row into a GitHub issue, and linking the row to it.
//
// Shared by POST /api/boards/<board>/start (one task, optionally assigned as it
// opens) and POST /api/boards/<board>/start-many (a lead making every planned
// task an issue). Both must open at most one issue per task, so both go
// through the claim in app/lib/plan-store.ts — a double press, a colleague pressing at the same
// moment, or a bulk run overlapping a single start all end in one issue.

import { taskHref } from "@/app/lib/repos";
import { openTask, assign } from "@/app/lib/github";
import { noteNewTask } from "@/app/lib/work";
import { readTask, claimTask, settleClaim, ISSUE_RE } from "@/app/lib/plan-store";
import type { PlanBoard } from "@/app/lib/plan-boards";

export type Started = {
  id: string;
  issue: string;
  url: string;
  href: string;
  /** Who GitHub has on it now, when an assignee was asked for. */
  assignee?: string | null;
  /** The issue exists and is linked, but GitHub refused the assignee. */
  assignError?: string;
};

export type NotStarted = {
  id: string;
  error: string;
  status: number;
  /** Set when the task was already started: where it went. */
  issue?: string;
  href?: string;
};

/** The plan's text, laid out as an issue someone can pick up without the board. */
function issueBody(board: PlanBoard, t: Record<string, string>): string {
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
    `_Started from the ${board.name} build board, task ${t.id}. Its column there now follows this issue._`
  );
}

/**
 * Open the issue for `board` task `id` in `repo` and link the row to it.
 *
 * The caller has already checked who may do this, that `repo` is one the
 * platform reports on, and — when `to` is set — that the actor may assign to
 * `to`. An assignment GitHub refuses does not undo the issue: the issue is real
 * work by then, and is reported as started with `assignError` saying why it has
 * nobody on it.
 */
export async function startPlanTask(opts: {
  board: PlanBoard;
  id: string;
  repo: string;
  login: string;
  name: string | null;
  to?: string | null;
}): Promise<Started | NotStarted> {
  const { board, id, repo, login, name, to = null } = opts;
  const gone = { id, status: 404, error: `${id} is no longer on the ${board.name} board. Somebody deleted it.` };

  const task = await readTask(board.key, id);
  if (!task) return gone;
  if (!task.title?.trim()) return { id, status: 400, error: `${id} has no title. Give it one first; the title becomes the issue's.` };

  const claim = await claimTask(board.key, id);
  if ("gone" in claim) return gone;
  if ("existing" in claim) {
    const m = ISSUE_RE.exec(claim.existing);
    return m
      ? { id, status: 409, error: `${id} was already started as ${claim.existing}.`, issue: claim.existing, href: taskHref(m[1], Number(m[2])) }
      : { id, status: 409, error: `${id} is being started by somebody else right now. Wait a moment and it will show the issue.` };
  }

  let made;
  try {
    made = await openTask({ repo, title: `${id}: ${task.title.trim()}`.slice(0, 256), body: issueBody(board, task), login, name });
  } catch (e: any) {
    await settleClaim(board.key, id, claim.token, "").catch(() => {});
    return { id, status: 502, error: e?.message ?? String(e) };
  }

  const ref = `${repo}#${made.number}`;
  const started: Started = { id, issue: ref, url: made.url, href: taskHref(repo, made.number) };
  if (to) {
    try {
      started.assignee = await assign(repo, made.number, to);
    } catch (e: any) {
      started.assignee = null;
      started.assignError = e?.message ?? String(e);
    }
  }
  // Held with the assignee GitHub now reports, so the Ops board does not show
  // the new issue as unassigned while GitHub's list catches up.
  const who = started.assignee ? [{ login: started.assignee }] : made.issue.assignees ?? [];
  noteNewTask(repo, { ...made.issue, assignee: who[0] ?? null, assignees: who });

  if (!(await settleClaim(board.key, id, claim.token, ref))) {
    // Only possible if this request outlived the claim's two minutes and
    // somebody else took it over. The issue exists; say so, so nobody opens a third.
    return {
      id,
      status: 409,
      error: `${ref} was opened, but the claim on ${id} expired first, so the board may not point at it. Check ${made.url} before starting ${id} again.`,
    };
  }
  return started;
}
