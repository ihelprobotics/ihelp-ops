// Everything /task/[number] shows, assembled once on the server.
//
// The split is the same one the whole platform is built on. What the work *is*
// — title, body, comments, pull request, checks, approval — is read live from
// GitHub, because GitHub is the source of truth and a mirror starts disagreeing
// with it within a week. What *happened* — commits carrying the task trailer,
// agent runs and their cost — comes from the database, which is the analytics
// record and the ledger, not a second copy of GitHub.
//
// Nothing here falls back quietly. If GitHub cannot be read, ghFetch throws
// with the token or the repository named, and the page renders that instead of
// an empty task that looks finished.

import { sql } from "@/lib/db";
import { ghFetch, expectList, branchState } from "@/app/lib/github";
import { stageOf, stageLabel, branchIsForTask } from "@/app/lib/progress";

export type TaskDetail = Awaited<ReturnType<typeof loadTask>>;

export async function loadTask(repo: string, number: number) {
  const owner = repo.split("/")[0];

  const [issueRes, commentsRes, branchesRes] = await Promise.all([
    ghFetch(`/repos/${repo}/issues/${number}`, { allow: [404] }),
    ghFetch(`/repos/${repo}/issues/${number}/comments?per_page=100`, { allow: [404] }),
    ghFetch(`/repos/${repo}/branches?per_page=100`),
  ]);

  if (issueRes.status === 404) return null;
  const issue = issueRes.body;

  // An issue endpoint answers for pull requests too. A PR rendered as a task
  // would show a branch that is not its own and a progress bar that means
  // nothing, so it is refused by name rather than displayed wrongly.
  if (issue?.pull_request) {
    throw new Error(
      `${repo}#${number} is a pull request, not an issue. Tasks are issues here; the pull request appears on the task it closes.`
    );
  }

  const branches: string[] = expectList(branchesRes.body, "branches").map((b: any) => b.name);
  const taskBranches = branches.filter((b) => branchIsForTask(b, number));

  // A task can carry two branches — one a person started, one an agent opened.
  // Both are shown; the pull request is looked up against each, and the one
  // that got furthest is the one that describes where the work actually is.
  const states = await Promise.all(taskBranches.map((b) => branchState(repo, b)));
  const RANK: Record<string, number> = { merged: 3, open: 2, "no-pr": 1 };
  let pr: (typeof states)[number] | null = null;
  let prBranch: string | null = null;
  states.forEach((s, i) => {
    if (!pr || RANK[s.state] > RANK[pr.state]) { pr = s; prBranch = taskBranches[i]; }
  });

  const [commits, runs, events, repoEvents] = await Promise.all([
    sql`select sha, author, branch, message, committed_at
          from commit_event
         where repo = ${repo} and issue_number = ${number}
         order by committed_at desc limit 50`,
    sql`select r.id, r.agent, r.status, r.pr_url, r.logs_url, r.cost_usd,
               r.input_tokens, r.output_tokens, r.started_at, r.finished_at,
               u.name as requester
          from agent_run r left join app_user u on u.id = r.requester_id
         where r.repo = ${repo} and r.issue_number = ${number}
         order by r.started_at desc limit 20`,
    sql`select kind, occurred_at from gh_event
         where repo = ${repo} and number = ${number} order by occurred_at`,
    // Not a duplicate of the above. Zero events for this task and zero events
    // for the whole repository mean completely different things, and the page
    // has to be able to tell the reader which one it is looking at.
    sql`select count(*)::int as n from gh_event where repo = ${repo}`,
  ]);

  const progress = stageOf({
    kinds: events.map((e: any) => e.kind),
    hasCommit: commits.length > 0,
    hasBranch: taskBranches.length > 0,
  });

  return {
    repo,
    number,
    progress,
    stage: stageLabel(progress),
    issue: {
      title: issue.title as string,
      body: (issue.body ?? "") as string,
      state: issue.state as string,
      url: issue.html_url as string,
      author: issue.user?.login ?? null,
      assignee: issue.assignee?.login ?? null,
      labels: (issue.labels ?? []).map((l: any) => (typeof l === "string" ? l : l.name)),
      createdAt: issue.created_at as string,
    },
    branches: taskBranches,
    prBranch,
    pr: pr as (typeof states)[number] | null,
    openIn: prBranch ? openIn(repo, prBranch) : taskBranches[0] ? openIn(repo, taskBranches[0]) : null,
    comments: expectList(commentsRes.status === 404 ? [] : commentsRes.body, "comments").map((c: any) => ({
      author: c.user?.login ?? "unknown",
      body: c.body ?? "",
      url: c.html_url as string,
      createdAt: c.created_at as string,
    })),
    commits: commits.map((c: any) => ({ ...c, sha: String(c.sha).slice(0, 7) })),
    runs,
    events,
    /** Zero here and a quiet week are not the same thing. See the page. */
    repoEventsRecorded: (repoEvents[0] as any).n as number,
    owner,
  };
}

/**
 * The three ways in, from docs/03. Push and pull are deliberately absent: the
 * uncommitted files are on a laptop and this server has never seen them.
 */
function openIn(repo: string, branch: string) {
  const url = `https://github.com/${repo}`;
  return {
    branch,
    desktop: `vscode://vscode.git/clone?url=${encodeURIComponent(url)}`,
    browser: `https://vscode.dev/github/${repo}/tree/${branch}`,
    terminal: `git fetch && git switch ${branch}`,
    firstTime: [
      `git clone ${url}.git`,
      `cd ${repo.split("/")[1]}`,
      `git config core.hooksPath .githooks`,
      `git switch ${branch}`,
    ],
  };
}
