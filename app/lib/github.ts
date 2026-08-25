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

// ---------------------------------------------------------------------------
// One way in and out of the GitHub API
// ---------------------------------------------------------------------------
// Every call here used to build its own headers from process.env.GH_DISPATCH_TOKEN
// without checking it, and then read the response as though it had succeeded.
// With the token missing or the repository invisible, GitHub answers
// {"message": "Bad credentials"} with a 401 — and the old code walked straight
// into main.object.sha, so the person starting a task saw
// "Cannot read properties of undefined (reading 'sha')". That names a property.
// It does not name the token, which is the thing that was actually wrong.

type GhOptions = Omit<RequestInit, "headers"> & {
  headers?: Record<string, string>;
  /** Statuses that are an answer rather than a failure — 422 for "branch exists". */
  allow?: number[];
};

function explain(status: number): string {
  if (status === 401) return "GH_DISPATCH_TOKEN is invalid or expired.";
  if (status === 403) return "GH_DISPATCH_TOKEN lacks a permission this needs, or the rate limit is spent.";
  // Worth stating plainly: a fine-grained token returns 404, not 403, for a
  // repository outside its access list. The obvious reading — "it does not
  // exist" — sends people to check the name, which is usually fine.
  if (status === 404) return "Either the repository name is wrong, or GH_DISPATCH_TOKEN's repository access list does not include it — a fine-grained token answers 404, not 403, for a repo it cannot see.";
  return "";
}

/**
 * Fetch from the GitHub API. Checks the token once, checks the response, and
 * throws an error naming both. Returns the status alongside the parsed body so
 * a caller can treat an expected status as an answer.
 *
 * Exported so app/lib/task.ts reads GitHub through the same door. A second
 * fetch wrapper would be a second set of error messages, and the point of this
 * one is that every failure names the token or the repository rather than the
 * property that happened to be undefined.
 */
export async function ghFetch(path: string, opts: GhOptions = {}): Promise<{ status: number; body: any }> {
  const { allow = [], headers, ...init } = opts;

  const token = process.env.GH_DISPATCH_TOKEN;
  if (!token) {
    throw new Error(
      "GH_DISPATCH_TOKEN is not set, so GitHub cannot be reached. Nothing on this page works without it — set it in the environment rather than reading an empty board as a quiet week."
    );
  }

  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
  });

  if (!res.ok && !allow.includes(res.status)) {
    const detail = (await res.text()).slice(0, 400);
    throw new Error(`GitHub returned ${res.status} for ${path}. ${explain(res.status)} ${detail}`.replace(/\s+/g, " ").trim());
  }

  // 204 has no body; a body that is not JSON would otherwise throw something
  // about a token at position 0, which describes a parser rather than a cause.
  if (res.status === 204) return { status: res.status, body: null };
  const text = await res.text();
  try {
    return { status: res.status, body: text ? JSON.parse(text) : null };
  } catch {
    throw new Error(`GitHub returned ${res.status} for ${path} with a body that is not JSON: ${text.slice(0, 200)}`);
  }
}

/**
 * GitHub answers a list endpoint with an object when something is wrong —
 * {"message": "Not Found"} rather than []. Destructuring that gives
 * "is not iterable", so the shape is checked before it is used.
 */
export function expectList(body: any, what: string): any[] {
  if (Array.isArray(body)) return body;
  const said = body && typeof body === "object" && body.message ? ` It said: "${body.message}".` : "";
  throw new Error(`GitHub did not return a list of ${what}.${said} This is usually GH_DISPATCH_TOKEN lacking access to the repository.`);
}

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

  const { body: ref } = await ghFetch(`/repos/${repo}/git/ref/heads/main`);
  const sha = ref?.object?.sha;
  if (typeof sha !== "string") {
    throw new Error(
      `Could not read the current head of main in ${repo}. GitHub answered without an object.sha, which usually means the default branch is not called main.`
    );
  }

  // 422 means the branch already exists, which is fine — resuming a task.
  await ghFetch(`/repos/${repo}/git/refs`, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
    allow: [422],
  });

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
  const { body } = await ghFetch(`/repos/${opts.repo}/pulls`, {
    method: "POST",
    body: JSON.stringify({
      title: `${opts.title} (#${opts.issue})`,
      head: opts.branch,
      base: "main",
      body: `Closes #${opts.issue}\n\nOpened from the platform by @${opts.login}.\n\n## What\n\n## Why\n\n## Evidence\n\n## Risk\nWhat could this break? What did you not test?`,
    }),
  });
  return body;
}

/**
 * Live state of a branch's PR: checks, the Reviewer agent's verdict, whether a
 * human in CODEOWNERS has approved, and whether it is mergeable. This is the
 * view worth having in the platform — it answers "where is my work" without
 * anyone opening five tabs.
 */
export async function branchState(repo: string, branch: string) {
  const owner = repo.split("/")[0];
  const { body: prBody } = await ghFetch(`/repos/${repo}/pulls?head=${owner}:${branch}&state=all`);
  const [listed] = expectList(prBody, "pull requests");

  if (!listed) return { state: "no-pr" as const, checksError: null as string | null };

  // The list endpoint does not carry mergeable_state — GitHub computes
  // mergeability lazily and only returns it from the single-pull-request
  // endpoint. Reading it off the list gives undefined every time, which the
  // page would then render as "unknown" for a pull request GitHub is perfectly
  // happy to merge.
  const [prRes, checksRes, reviewsRes] = await Promise.all([
    ghFetch(`/repos/${repo}/pulls/${listed.number}`),
    // 403 is an answer here, not a failure. A fine-grained token without
    // "Checks: read" can see the pull request and everything else on this page;
    // only the check conclusions are closed to it. Throwing would take the
    // whole task screen down over one field, so the field says it cannot be
    // read and names the permission — which is the same rule as everywhere
    // else, applied at the right size. What it must never do is report
    // "none have run", which is a claim about CI that nobody verified.
    ghFetch(`/repos/${repo}/commits/${listed.head.sha}/check-runs`, { allow: [403] }),
    ghFetch(`/repos/${repo}/pulls/${listed.number}/reviews`),
  ]);

  const pr = prRes.body ?? listed;
  const readable = checksRes.status !== 403;
  const runs: any[] = Array.isArray(checksRes.body?.check_runs) ? checksRes.body.check_runs : [];
  const reviews = expectList(reviewsRes.body, "reviews");

  const checksError = readable
    ? null
    : `GH_DISPATCH_TOKEN cannot read check runs on ${repo} (403). A fine-grained token needs the "Checks" read permission; a classic one needs repo. Until then this page cannot say whether CI passed, and does not guess.`;

  return {
    state: pr.merged_at ? ("merged" as const) : ("open" as const),
    number: pr.number as number,
    url: pr.html_url as string,
    checks: !readable ? "unreadable" : runs.length === 0 ? "none" : runs.every((c: any) => c.conclusion === "success") ? "green" : "not green",
    reviewerAgent: !readable ? "unreadable" : runs.find((c: any) => c.name === "Reviewer")?.conclusion ?? "pending",
    humanApproved: reviews.some((r: any) => r.state === "APPROVED"),
    mergeable: pr.mergeable_state ?? "unknown",
    checksError,
  };
}

/**
 * Merge, from the platform. GitHub's branch protection still decides: CODEOWNERS
 * approval and the Reviewer check must pass. This button cannot bypass them, and
 * a refusal here is branch protection doing its job, not a bug.
 */
export async function merge(repo: string, prNumber: number) {
  // 405 and 409 are how GitHub says "not mergeable" and "the head moved".
  // Allowed through so the refusal can be explained as protection working,
  // rather than surfacing as a bare API failure.
  const { status, body } = await ghFetch(`/repos/${repo}/pulls/${prNumber}/merge`, {
    method: "PUT",
    body: JSON.stringify({ merge_method: "squash" }),
    allow: [405, 409],
  });

  if (status === 405 || status === 409) {
    throw new Error(
      `Merge refused (${status}). Usually this means a required review or check is missing, which is branch protection doing its job. ${body?.message ?? ""}`.trim()
    );
  }
  return body;
}
