// The board, assembled once on the server.
//
// Two readers want exactly this: the board page, which renders it, and
// GET /api/tasks, which /new, the checks and anything else can call. It used to
// live in the route alone, and the board fetched its own API from the browser —
// a round trip and a 400-line client component for a screen that only shows
// facts.
//
// Nothing here is a copy of GitHub. The issues are read live (app/lib/work.ts),
// and progress comes from the artifacts on record: events, commits, branches.

import { sql } from "@/lib/db";
import { stageOf, stageLabel, branchIsForTask } from "@/app/lib/progress";
import { repos, taskHref } from "@/app/lib/repos";
import { openWorkFor } from "@/app/lib/work";

export type BoardTask = {
  repo: string;
  number: number;
  title: string;
  url: string;
  href: string;
  // Exactly one name, or none. GitHub allows several; this platform does not,
  // and showing the first of many would hide that it happened.
  assignee: string | null;
  labels: string[];
  progress: number;
  /** The artifact behind the number, from stageLabel. */
  stage: string;
  /** Commits carrying this task's iHelp-Task trailer. */
  commits: number;
  updated_at: string;
};

export type BoardRepo = { repo: string; error: string | null; open: number };

export async function loadBoard() {
  // Throws with the missing setting named. "No repositories are configured"
  // must never reach the page as an empty board.
  const list = await repos();
  if (!process.env.GH_DISPATCH_TOKEN) {
    throw new Error("GH_DISPATCH_TOKEN is not set, so GitHub cannot be read.");
  }

  // One repository failing must not blank the others: each carries its own
  // error. The read is shared and short-lived — see app/lib/work.ts.
  const perRepo = await Promise.all(list.map((r) => openWorkFor(r.full)));

  // Evidence for every task on the board, in two queries rather than per repo.
  const names = perRepo.map((p) => p.repo);
  const numbers = perRepo.flatMap((p) => p.issues.map((i: any) => i.number));

  const [events, commits] = numbers.length
    ? await Promise.all([
        sql<{ kind: string; repo: string; number: number }[]>`
          select kind, repo, number from gh_event
           where repo = any(${names}) and number = any(${numbers})`,
        sql<{ repo: string; issue_number: number; n: number }[]>`
          select repo, issue_number, count(*)::int as n from commit_event
           where repo = any(${names}) and issue_number = any(${numbers})
           group by repo, issue_number`,
      ])
    : [[], []];

  const commitCount = new Map<string, number>(
    commits.map((c: any): [string, number] => [`${c.repo}#${c.issue_number}`, Number(c.n)])
  );

  const tasks: BoardTask[] = perRepo.flatMap((p) =>
    p.issues.map((i: any): BoardTask => {
      const n = commitCount.get(`${p.repo}#${i.number}`) ?? 0;
      const progress = stageOf({
        kinds: events.filter((e: any) => e.repo === p.repo && e.number === i.number).map((e: any) => e.kind),
        hasCommit: n > 0,
        hasBranch: p.branches.some((b: string) => branchIsForTask(b, i.number)),
      });
      return {
        repo: p.repo,
        number: i.number,
        title: i.title,
        url: i.html_url,
        href: taskHref(p.repo, i.number),
        assignee: i.assignee?.login ?? null,
        labels: (i.labels || []).map((l: any) => l.name),
        progress,
        stage: stageLabel(progress),
        commits: n,
        updated_at: i.updated_at,
      };
    })
  );

  return {
    repos: perRepo.map((p): BoardRepo => ({ repo: p.repo, error: p.error, open: p.issues.length })),
    // Reported so "nothing has happened yet" can be told apart from "the
    // webhook was never connected" — a board of untouched cards looks identical
    // for both.
    events_recorded: events.length,
    tasks,
  };
}

export type Board = Awaited<ReturnType<typeof loadBoard>>;

/**
 * The board's columns.
 *
 * Bands of the one ladder in app/lib/progress.ts, not states anyone sets. A
 * card is in review because a pull request is open, and it leaves the column
 * when GitHub reports something else. There is nothing to drag, on purpose.
 */
export const COLUMNS = [
  { key: "todo",   title: "Not started", hint: "Open, no branch yet",             from: 0,  to: 20 },
  { key: "doing",  title: "In progress", hint: "A branch or commits exist",       from: 20, to: 60 },
  { key: "review", title: "In review",   hint: "A pull request is open",          from: 60, to: 90 },
  { key: "done",   title: "Approved",    hint: "A human approved, or it merged",  from: 90, to: 101 },
] as const;

/** "3h ago", from a GitHub timestamp. */
export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
