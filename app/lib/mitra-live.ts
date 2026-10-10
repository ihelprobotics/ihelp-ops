// Where each started MITRA task actually is, derived the same way as the board.
//
// A MITRA row that has been started in Ops points at owner/name#n. From then on
// its column is not typed by anyone: it is the stage ladder in
// app/lib/progress.ts, read from the same artifacts the Ops board reads —
// events, commits carrying the task trailer, branches — and mapped onto the
// MITRA board's own column names.
//
// The list of issues comes from the store, never from the request. Otherwise
// this route would read any repository the token can see for anybody who asked.

import { sql } from "@/lib/db";
import { ghFetch } from "@/app/lib/github";
import { cached } from "@/app/lib/cache";
import { repos, taskHref } from "@/app/lib/repos";
import { openWorkFor } from "@/app/lib/work";
import { stageOf, stageLabel, branchIsForTask, STAGE } from "@/app/lib/progress";
import { ISSUE_RE } from "@/app/lib/mitra-store";

export type LiveTask = {
  /** owner/name#n */
  ref: string;
  href: string;
  url: string;
  /** null when GitHub could not be read for this one; `error` says why. */
  progress: number | null;
  stage: string | null;
  /** The MITRA column this belongs in, or null when it cannot be known. */
  column: string | null;
  error: string | null;
};

/** The ladder, in the MITRA board's words. One place, so the bands cannot drift. */
function columnFor(progress: number, closed: null | "completed" | "not_planned"): string {
  if (closed === "not_planned") return "Deferred (v1.1)";
  if (closed || progress >= STAGE.merged) return "Done";
  if (progress >= STAGE.pr_open) return "In review";
  if (progress >= STAGE.branched) return "In progress";
  return "To do";
}

/** A closed issue is not in the open list, so it is read on its own. */
const closedIssue = (repo: string, n: number) =>
  cached(`mitra-issue:${repo}#${n}`, async () => {
    const { status, body } = await ghFetch(`/repos/${repo}/issues/${n}`, { allow: [404, 410] });
    if (status !== 200) return null;
    return body;
  }, 60_000);

export async function liveStatus(tasks: { id: string; issue?: string }[]): Promise<Record<string, LiveTask>> {
  const linked = tasks
    .map((t) => ({ id: t.id, m: ISSUE_RE.exec(t.issue || "") }))
    .filter((x): x is { id: string; m: RegExpExecArray } => !!x.m)
    .map((x) => ({ id: x.id, repo: x.m[1], number: Number(x.m[2]) }));

  const out: Record<string, LiveTask> = {};
  if (!linked.length) return out;

  const allowed = new Set((await repos()).map((r) => r.full.toLowerCase()));
  const names = [...new Set(linked.map((l) => l.repo))];
  const work = new Map(await Promise.all(names.map(async (r) => [r, await openWorkFor(r)] as const)));

  const [events, commits] = await Promise.all([
    sql<{ kind: string; repo: string; number: number }[]>`
      select kind, repo, number from gh_event
       where repo = any(${names}) and number = any(${linked.map((l) => l.number)})`,
    sql<{ repo: string; issue_number: number; n: number }[]>`
      select repo, issue_number, count(*)::int as n from commit_event
       where repo = any(${names}) and issue_number = any(${linked.map((l) => l.number)})
       group by repo, issue_number`,
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
      if (!w.issues.some((i: any) => i.number === number)) {
        try {
          const issue = await closedIssue(repo, number);
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
        column: columnFor(progress, closed),
        error: null,
      };
    })
  );
  return out;
}
