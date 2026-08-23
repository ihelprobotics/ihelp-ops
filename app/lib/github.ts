// Starting work, and the GitHub operations worth having in the platform.
//
// Division of labour, and it is not arbitrary:
//
//   Platform  — the front door and the ledger. Start a task, see everything.
//   VS Code   — the workbench. Where code is actually written.
//   GitHub    — the store. Branches, PRs, reviews, merges.
//
// Push and pull are NOT here, and cannot be. Your uncommitted code lives on
// your laptop; this app runs on a server and has never seen those bytes. A web
// page cannot push files it does not have. That is not a design decision to
// work around — it is where the files are. Push and pull happen in VS Code,
// one click in the source control panel, and arrive here through the webhook
// the moment they land.

import { sql } from "@/lib/db";

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

/**
 * Start a task: create the branch, then hand the person a set of ways in.
 * The branch name carries the issue number, which is what the commit hook
 * reads back out — so every commit is attributed without anyone typing an id.
 */
export async function startTask(opts: {
  repo: string; issue: number; title: string; login: string;
}) {
  const { repo, issue, title, login } = opts;
  const branch = `task/${issue}/${slug(title)}`;

  const headers = {
    Authorization: `Bearer ${process.env.GH_DISPATCH_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };

  const main = await fetch(`https://api.github.com/repos/${repo}/git/ref/heads/main`, { headers }).then((r) => r.json());

  const res = await fetch(`https://api.github.com/repos/${repo}/git/refs`, {
    method: "POST", headers,
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: main.object.sha }),
  });
  // 422 means the branch already exists, which is fine — resuming a task.
  if (!res.ok && res.status !== 422) {
    throw new Error(`Could not create the branch: ${res.status} ${await res.text()}`);
  }

  await sql`update app_user set last_seen_at = now() where gh_login = ${login}`;

  const url = `https://github.com/${repo}`;
  return {
    branch,
    open: {
      // Opens the desktop editor, cloning if this is their first time.
      desktop: `vscode://vscode.git/clone?url=${encodeURIComponent(url)}`,
      // Opens the repo in the browser editor at this branch. Nothing to install
      // — useful for a first-day intern or a quick review from a borrowed machine.
      browser: `https://vscode.dev/github/${repo}/tree/${branch}`,
      // For someone who already has the clone.
      terminal: `git fetch && git switch ${branch}`,
    },
    firstTime: [
      `git clone ${url}.git`,
      `cd ${repo.split("/")[1]}`,
      `git config core.hooksPath .githooks`,   // makes commits self-attributing
      `git switch ${branch}`,
    ],
  };
}

/** Open a pull request from the platform. */
export async function openPR(opts: {
  repo: string; branch: string; issue: number; title: string; login: string;
}) {
  const r = await fetch(`https://api.github.com/repos/${opts.repo}/pulls`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GH_DISPATCH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: `${opts.title} (#${opts.issue})`,
      head: opts.branch,
      base: "main",
      body: `Closes #${opts.issue}\n\nOpened from the platform by @${opts.login}.\n\n## What\n\n## Why\n\n## Evidence\n\n## Risk\nWhat could this break? What did you not test?`,
    }),
  });
  if (!r.ok) throw new Error(`Could not open the PR: ${r.status} ${await r.text()}`);
  return r.json();
}

/**
 * Live state of a branch's PR: checks, the Reviewer agent's verdict, whether a
 * human in CODEOWNERS has approved, and whether it is mergeable. This is the
 * view worth having in the platform — it answers "where is my work" without
 * anyone opening five tabs.
 */
export async function branchState(repo: string, branch: string) {
  const headers = {
    Authorization: `Bearer ${process.env.GH_DISPATCH_TOKEN}`,
    Accept: "application/vnd.github+json",
  };
  const [pr] = await fetch(
    `https://api.github.com/repos/${repo}/pulls?head=${repo.split("/")[0]}:${branch}&state=all`,
    { headers }
  ).then((r) => r.json());

  if (!pr) return { state: "no-pr" as const };

  const [checks, reviews] = await Promise.all([
    fetch(`https://api.github.com/repos/${repo}/commits/${pr.head.sha}/check-runs`, { headers }).then((r) => r.json()),
    fetch(`https://api.github.com/repos/${repo}/pulls/${pr.number}/reviews`, { headers }).then((r) => r.json()),
  ]);

  const runs = checks.check_runs || [];
  return {
    state: pr.merged_at ? ("merged" as const) : ("open" as const),
    number: pr.number,
    url: pr.html_url,
    checks: runs.length === 0 ? "none" : runs.every((c: any) => c.conclusion === "success") ? "green" : "not green",
    reviewerAgent: runs.find((c: any) => c.name === "Reviewer")?.conclusion ?? "pending",
    humanApproved: reviews.some((r: any) => r.state === "APPROVED"),
    mergeable: pr.mergeable_state,
  };
}

/**
 * Merge, from the platform. GitHub's branch protection still decides: CODEOWNERS
 * approval and the Reviewer check must pass. This button cannot bypass them, and
 * a refusal here is branch protection doing its job, not a bug.
 */
export async function merge(repo: string, prNumber: number) {
  const r = await fetch(`https://api.github.com/repos/${repo}/pulls/${prNumber}/merge`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${process.env.GH_DISPATCH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ merge_method: "squash" }),
  });
  if (!r.ok) {
    const detail = await r.text();
    throw new Error(`Merge refused (${r.status}). Usually this means a required review or check is missing. ${detail}`);
  }
  return r.json();
}
