// A build plan (MITRA, SENTINEL), as one card at the top of the Ops board.
//
// A plan is not work — most of its rows have not been started — so its tasks
// are not spread through the four columns, where a plan row would sit in Not
// started looking exactly like an issue nobody has picked up. It is one card
// that says how much of the plan has become real work, and opens the full board.
//
// Counts only what the store can prove: how many rows are linked to an issue.
// A linked row's stored status is stale by design (its column comes from
// GitHub), so it is not counted by status here.

import { readBoard, ISSUE_RE } from "@/app/lib/plan-store";
import type { PlanBoard } from "@/app/lib/plan-boards";

export default async function PlanCard({ board }: { board: PlanBoard }) {
  let tasks: Record<string, string>[] = [];
  let error = "";
  try {
    tasks = (await readBoard(board.key)).tasks;
  } catch (e: any) {
    error = e?.message ?? String(e);
  }

  const linked = tasks.filter((t) => ISSUE_RE.test(t.issue || "")).length;
  const planned = tasks.filter((t) => !ISSUE_RE.test(t.issue || ""));
  const blocked = planned.filter((t) => t.status === "Blocked").length;
  const epics = new Set(tasks.map((t) => t.epic).filter(Boolean)).size;
  const pct = tasks.length ? Math.round((linked / tasks.length) * 100) : 0;

  return (
    // A plain <a>: the board is a static page, not a route the client router has.
    <a className="plan-card" href={`/${board.key}`}>
      <div className="plan-head">
        <b>{board.title}</b>
        <span className="plan-open">Open the full board →</span>
      </div>
      {error ? (
        <p className="plan-err">{`The ${board.name} plan could not be read, so its numbers are missing — not zero. ${error}`}</p>
      ) : tasks.length === 0 ? (
        <p className="muted small">
          {`The ${board.name} plan has no tasks in its store yet. Opening the board loads it the first time.`}
        </p>
      ) : (
        <>
          <p className="plan-sub">
            {`${tasks.length} tasks across ${epics} ${epics === 1 ? "area" : "areas"} · `}
            <b>{`${linked} ${linked === 1 ? "is a GitHub issue" : "are GitHub issues"}`}</b>
            {` · ${planned.length} still planned`}
            {blocked ? ` · ${blocked} blocked` : ""}
          </p>
          <div className="bar" title={`${pct}% of the plan is GitHub issues`}>
            <i style={{ width: `${pct}%` }} />
          </div>
          <p className="muted small">
            Assigning a planned task opens its issue with that person on it. From then on it is on this
            board, and its column there follows GitHub.
          </p>
        </>
      )}
    </a>
  );
}

export const PLAN_CARD_CSS = `
  .plans { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 14px; margin: 0 0 18px; }
  .plan-card {
    display: block; padding: 14px 16px;
    background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius);
    box-shadow: var(--shadow); color: var(--ink); text-decoration: none;
  }
  .plan-card:hover { border-color: var(--accent); text-decoration: none; }
  .plan-head { display: flex; gap: 12px; align-items: baseline; justify-content: space-between; flex-wrap: wrap; }
  .plan-head b { font-size: 17px; }
  .plan-open { color: var(--accent); font-weight: 600; font-size: 14px; }
  .plan-sub { margin: 6px 0 10px; color: var(--ink-2); font-size: 14px; }
  .plan-sub b { color: var(--ink); }
  .plan-card .bar { margin-bottom: 8px; }
  .plan-card p.small { margin: 0; }
  .plan-err { margin: 8px 0 0; color: var(--danger); font-size: 14px; }
`;
