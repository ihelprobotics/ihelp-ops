// Landing a run: one commit, one branch, one pull request.
//
// The same three shapes agent-run.yml produces, because the rest of the
// platform reads them and does not care which path wrote them:
//
//   * the branch is agent/<agent>/issue-<n>, which branchIsForTask matches;
//   * the commit message ends with the iHelp-Task trailer, which the push
//     webhook reads into commit_event.issue_number;
//   * the pull request body carries "Platform run: `<uuid>`", which the GitHub
//     webhook uses to close the run on merge.
//
// Change any of the three and progress stops moving with no error anywhere.
//
// Everything is written through the Git Data API with the platform's token.
// Branch protection still decides what merges: this opens a pull request and
// nothing more, and it never moves a branch that moved under it.

import { ghFetch } from "@/app/lib/github";
import type { Change } from "@/app/lib/workspace";

const WRITE_HELP =
  "A fine-grained GH_DISPATCH_TOKEN needs Contents: write and Pull requests: write on this repository; a classic one needs repo.";

const quote = (s: string) => s.trim().split("\n").map((l) => `> ${l}`).join("\n");

export type Start = { commit: string; tree: string; base: string; branch: string; resumed: boolean };

/** Where a run begins: the head of its branch if an earlier run made one, otherwise the default branch. */
export async function startingPoint(repo: string, branch: string): Promise<Start> {
  const [{ body: info }, existing] = await Promise.all([
    ghFetch(`/repos/${repo}`),
    ghFetch(`/repos/${repo}/git/ref/heads/${branch}`, { allow: [404] }),
  ]);
  const base = info?.default_branch;
  if (typeof base !== "string") {
    throw new Error(`GitHub did not say what ${repo}'s default branch is, so there is nothing to start a run from.`);
  }

  const resumed = existing.status !== 404;
  const ref = resumed ? existing : await ghFetch(`/repos/${repo}/git/ref/heads/${base}`);
  const commit = ref.body?.object?.sha;
  if (typeof commit !== "string") {
    throw new Error(`Could not read the head of ${resumed ? branch : base} in ${repo}. GitHub answered without a commit.`);
  }

  const { body: c } = await ghFetch(`/repos/${repo}/git/commits/${commit}`);
  if (typeof c?.tree?.sha !== "string") {
    throw new Error(`GitHub returned commit ${commit.slice(0, 7)} in ${repo} without a tree.`);
  }
  return { commit, tree: c.tree.sha, base, branch, resumed };
}

async function create(repo: string, path: string, body: unknown, what: string) {
  const res = await ghFetch(`/repos/${repo}${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    allow: [403, 404, 409, 422],
  });
  if (res.status >= 400) {
    const said = res.body?.message ? ` GitHub said: "${res.body.message}".` : "";
    throw new Error(`GitHub refused to ${what} in ${repo} (${res.status}).${said} ${res.status === 403 || res.status === 404 ? WRITE_HELP : ""}`.trim());
  }
  return res.body;
}

export type Landing = { url: string; number: number; commit: string; opened: boolean; labelError: string };

export async function land(o: {
  repo: string;
  start: Start;
  changes: Change[];
  agent: string;
  issue: number;
  title: string;
  requester: string;
  runId: string;
  brief: string;
  /** The agent's own account of what it did. Published as its words, not ours. */
  summary: string;
  /** Empty when the agent finished; otherwise why it did not. */
  unfinished: string;
  cost: number;
}): Promise<Landing> {
  const { repo, start } = o;

  const tree = await create(repo, "/git/trees", {
    base_tree: start.tree,
    tree: o.changes.map((c) =>
      c.content === null
        ? { path: c.path, mode: c.mode, type: "blob", sha: null }
        : { path: c.path, mode: c.mode, type: "blob", content: c.content }
    ),
  }, "build the commit's file tree");

  const commit = await create(repo, "/git/commits", {
    // Separate paragraphs; the last is the trailer commit_event is parsed from.
    message: `${o.agent}: ${o.title}\n\nOpened by the ${o.agent} agent for @${o.requester}, run through the Claude API from the platform.\n\niHelp-Task: #${o.issue}`,
    tree: tree.sha,
    parents: [start.commit],
    author: { name: `iHelp ${o.agent} agent`, email: "agents@ihelprobotics.com" },
  }, "create the commit");

  // Moving the branch is where a race shows. If anything pushed to it while the
  // agent worked, a fast-forward is impossible and nothing is overwritten.
  const ref = start.resumed
    ? await ghFetch(`/repos/${repo}/git/refs/heads/${start.branch}`, {
        method: "PATCH", body: JSON.stringify({ sha: commit.sha, force: false }), allow: [403, 404, 422],
      })
    : await ghFetch(`/repos/${repo}/git/refs`, {
        method: "POST", body: JSON.stringify({ ref: `refs/heads/${start.branch}`, sha: commit.sha }), allow: [403, 404, 422],
      });
  if (ref.status === 422) {
    throw new Error(
      `${start.branch} could not be ${start.resumed ? "moved" : "created"} in ${repo}, so commit ${commit.sha.slice(0, 7)} is not on any branch and nothing anyone pushed was overwritten. GitHub said: "${ref.body?.message ?? "unprocessable"}". Usually the branch changed while the agent worked — run it again to start from the new head.`
    );
  }
  if (ref.status >= 400) {
    throw new Error(`GitHub refused to ${start.resumed ? "move" : "create"} ${start.branch} in ${repo} (${ref.status}). ${WRITE_HELP}`);
  }

  // A branch an earlier run opened may already have its pull request. A second
  // one against the same head is an error, so the existing one hears about it.
  const owner = repo.split("/")[0];
  const { body: open } = await ghFetch(`/repos/${repo}/pulls?head=${owner}:${start.branch}&state=open`);
  const existing = Array.isArray(open) ? open[0] : null;

  if (existing) {
    await ghFetch(`/repos/${repo}/issues/${existing.number}/comments`, {
      method: "POST",
      body: JSON.stringify({
        body: [
          `Another **${o.agent}** run for @${o.requester} added ${commit.sha.slice(0, 7)} to this branch, through the Claude API.`,
          o.unfinished && `**Unfinished.** ${o.unfinished}`,
          o.brief && `Run with this brief:\n\n${quote(o.brief)}`,
          o.summary && `What the agent says it did:\n\n${quote(o.summary)}`,
          `Platform run: \`${o.runId}\`\nCost: $${o.cost.toFixed(4)}`,
        ].filter(Boolean).join("\n\n"),
      }),
      allow: [403, 404],
    });
    return { url: existing.html_url, number: existing.number, commit: commit.sha, opened: false, labelError: "" };
  }

  const body = [
    `Closes #${o.issue}`,
    o.unfinished && `> **Unfinished.** ${o.unfinished} This is partial work — read all of it before building on it.`,
    `Written by the **${o.agent}** agent, run through the Claude API from the platform.`,
    `**Owner: @${o.requester}.** You asked for this run, so you own what it produced. Read it, run it, and be ready to explain any line of it. The Reviewer comments but never approves; a human in CODEOWNERS merges.`,
    "Nothing here has been built or tested. A run on the platform has no shell, so the checks on this pull request are the first time this code runs anywhere.",
    o.brief && `Run with this brief:\n\n${quote(o.brief)}`,
    o.summary ? `## What the agent says it did\n\n${o.summary}` : "## What\n\n## Why",
    "## Evidence\n\n## Risk\n\nWhat could this break? What was not tested?",
    `Files: ${o.changes.map((c) => `\`${c.path}\`${c.content === null ? " (deleted)" : ""}`).join(", ")}`,
    `---\n\nPlatform run: \`${o.runId}\`\n\nCost: $${o.cost.toFixed(4)}`,
  ].filter(Boolean).join("\n\n");

  const pr = await ghFetch(`/repos/${repo}/pulls`, {
    method: "POST",
    body: JSON.stringify({
      title: `${o.unfinished ? "[Unfinished] " : ""}${o.agent}: ${o.title} (#${o.issue})`,
      head: start.branch,
      base: start.base,
      body,
    }),
    allow: [403, 404, 422],
  });
  if (pr.status >= 400) {
    const why = pr.status === 422
      ? `GitHub said: "${pr.body?.errors?.map((e: any) => e.message).filter(Boolean).join("; ") || pr.body?.message}".`
      : WRITE_HELP;
    throw new Error(`The commit is on ${start.branch}, but GitHub refused to open the pull request (${pr.status}). ${why}`);
  }

  // The label is how agent-authored work is told apart on GitHub. Failing to
  // add it is reported rather than fatal: the pull request is real either way.
  let labelError = "";
  try {
    await ghFetch(`/repos/${repo}/labels`, {
      method: "POST",
      body: JSON.stringify({ name: "agent-authored", color: "5319e7", description: "Written by an agent. A human still owns it." }),
      allow: [403, 404, 422],
    });
    const lab = await ghFetch(`/repos/${repo}/issues/${pr.body.number}/labels`, {
      method: "POST", body: JSON.stringify({ labels: ["agent-authored"] }), allow: [403, 404, 410, 422],
    });
    if (lab.status >= 400) labelError = `The pull request opened without its agent-authored label (${lab.status}). A fine-grained token needs Issues: write to label it.`;
  } catch (e: any) {
    labelError = `The pull request opened without its agent-authored label: ${e?.message ?? String(e)}`;
  }

  return { url: pr.body.html_url, number: pr.body.number, commit: commit.sha, opened: true, labelError };
}

/**
 * A run that changed nothing is a finding, not a failure. It almost always
 * means the issue does not yet say what finished looks like, and the useful
 * place to say so is the issue, where whoever wrote it will see it.
 */
export async function reportNoChange(o: { repo: string; issue: number; agent: string; requester: string; summary: string }) {
  const body = [
    `The **${o.agent}** agent ran against this issue from the platform and changed nothing.`,
    "That usually means the issue does not yet say what a finished version looks like, rather than that the agent failed. Rewriting it with a concrete outcome is the fix.",
    o.summary && `What the agent said:\n\n${quote(o.summary)}`,
    `Requested by @${o.requester}.`,
  ].filter(Boolean).join("\n\n");

  const res = await ghFetch(`/repos/${o.repo}/issues/${o.issue}/comments`, {
    method: "POST", body: JSON.stringify({ body }), allow: [403, 404, 410],
  });
  if (res.status >= 400) {
    throw new Error(`The agent changed nothing, and GitHub refused the comment saying so on ${o.repo}#${o.issue} (${res.status}). A fine-grained token needs Issues: write.`);
  }
}
