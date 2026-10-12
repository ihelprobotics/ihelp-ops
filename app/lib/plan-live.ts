// Where each started build-board task actually is, derived the same way as the
// Ops board.
//
// A plan row that has been started in Ops points at owner/name#n. From then on
// its column is not typed by anyone: it is the stage ladder in
// app/lib/progress.ts, read from the same artifacts the Ops board reads —
// events, commits carrying the task trailer, branches — and mapped onto that
// board's own column names (columnFor in app/lib/plan-boards.ts).
//
// The list of issues comes from the store, never from the request. Otherwise
// this route would read any repository the token can see for anybody who asked.

import { sql } from "@/lib/db";
import { ghFetch } from "@/app/lib/github";
import { cached } from "@/app/lib/cache";
import { repos, taskHref } from "@/app/lib/repos";
import { openWorkFor } from "@/app/lib/work";
import { stageOf, stageLabel, branchIsForTask, STAGE } from "@/app/lib/progress";
import { ISSUE_RE } from "@/app/lib/plan-store";
import type { PlanBoard } from "@/app/lib/plan-boards";

export type LiveTask = {
  /** owner/name#n */
  ref: string;
  href: string;
  url: string;
  /** null when GitHub could not be read for this one; `error` says why. */
  progress: number | null;
  stage: string | null;
  /** The board column this belongs in, or null when it cannot be known or the board has none for it. */
  column: string | null;
  /** GitHub login on the issue, null for nobody. Undefined when unread. */
  assignee?: string | null;
  /**
   * The pull request that merged this task and its merge commit, from the
   * webhook's pr_merged record. null when none is on record — the issue was
   * closed without one, or merged before the webhook was connected.
   */
  merged?: { pr: string; commit: string | null } | null;
  error: string | null;
};

/** A closed issue is not in the open list, so it is read on its own. */
const closedIssue = (repo: string, n: number) =>
  cached(`plan-issue:${repo}#${n}`, async () => {
    const { status, body } = await ghFetch(`/repos/${repo}/issues/${n}`, { allow: [404, 410] });
    if (status !== 200) return null;
    return body;
  }, 60_000);

export async function liveStatus(board: PlanBoard, tasks: { id: string; issue?: string }[]): Promise<Record<string, LiveTask>> {
  const linked = tasks
    .map((t) => ({ id: t.id, m: ISSUE_RE.exec(t.issue || "") }))
    .filter((x): x is { id: string; m: RegExpExecArray } => !!x.m)
    .map((x) => ({ id: x.id, repo: x.m[1], number: Number(x.m[2]) }));

  const out: Record<string, LiveTask> = {};
  if (!linked.length) return out;

  const allowed = new Set((await repos()).map((r) => r.full.toLowerCase()));
  const names = [...new Set(linked.map((l) => l.repo))];
  const work = new Map(await Promise.all(names.map(async (r) => [r, await openWorkFor(r)] as const)));

  const [events, commits, merges] = await Promise.all([
    sql<{ kind: string; repo: string; number: number }[]>`
      select kind, repo, number from gh_event
       where repo = any(${names}) and number = any(${linked.map((l) => l.number)})`,
    sql<{ repo: string; issue_number: number; n: number }[]>`
      select repo, issue_number, count(*)::int as n from commit_event
       where repo = any(${names}) and issue_number = any(${linked.map((l) => l.number)})
       group by repo, issue_number`,
    sql<{ repo: string; number: number; pr: string | null; sha: string | null }[]>`
      select repo, number,
             payload->'pull_request'->>'html_url'         as pr,
             payload->'pull_request'->>'merge_commit_sha' as sha
        from gh_event
       where kind = 'pr_merged' and repo = any(${names}) and number = any(${linked.map((l) => l.number)})
       order by occurred_at desc`,
  ]);

  await Promise.all(
    linked.map(async ({ id, repo, number }) => {
      const ref = `${repo}#${number}`;
      const base = { ref, href: taskHref(repo, number), url: `https://github.com/${repo}/issues/${number}` };
      const fail = (error: string) => (out[id] = { ...base, progress: null, stage: null, column: null, error });

      if (!allowed.has(repo.toLowerCase())) {
        return fail(`${repo} is not a repository this platform reports on, so its status cannot be shown.`);
      }
      const w = work.get(repo)!;
      if (w.error) return fail(w.error);

      let closed: null | "completed" | "not_planned" = null;
      let issue: any = w.issues.find((i: any) => i.number === number);
      if (!issue) {
        try {
          issue = await closedIssue(repo, number);
          if (!issue) return fail(`${ref} no longer exists on GitHub, or the token cannot see it.`);
          if (issue.state === "closed") closed = issue.state_reason === "not_planned" ? "not_planned" : "completed";
        } catch (e: any) {
          return fail(e?.message ?? String(e));
        }
      }

      const n = commits.find((c) => c.repo === repo && c.issue_number === number)?.n ?? 0;
      const progress = stageOf({
        kinds: events.filter((e) => e.repo === repo && e.number === number).map((e) => e.kind),
        hasCommit: Number(n) > 0,
        hasBranch: w.branches.some((b) => branchIsForTask(b, number)),
      });
      out[id] = {
        ...base,
        progress,
        stage: closed === "not_planned" ? "Closed as not planned" : closed && progress < STAGE.merged ? "Closed" : stageLabel(progress),
        column: board.columnFor(progress, closed),
        assignee: issue.assignees?.[0]?.login ?? issue.assignee?.login ?? null,
        merged: (() => {
          const m = merges.find((x) => x.repo === repo && x.number === number && x.pr);
          return m ? { pr: m.pr!, commit: m.sha } : null;
        })(),
        error: null,
      };
    })
  );
  return out;
}
