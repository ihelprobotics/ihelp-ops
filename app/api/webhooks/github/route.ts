// POST /api/webhooks/github
//
// This is the accounting layer. Everything a person does in VS Code arrives
// here the moment they push: which branch, which commits, whose, against which
// task, how long it sat, who reviewed it, when it merged.
//
// What it deliberately does not capture: keystrokes, files opened, time with
// the editor focused, or anything else that happens before a commit.
// Uncommitted local work is not accountable work — it is not shared, not
// reviewed and not reversible. Measuring it would tell you who types, not who
// ships, and would make the platform something people resent.
//
// gh_event.number is the TASK number — the issue everything hangs off — for
// every kind of event, not the number of whatever object GitHub happened to
// send. Issues and pull requests are drawn from one shared sequence per repo,
// so a PR's number never equals its issue's. Storing the PR number here would
// mean nothing downstream could join a review or a green check back to the task
// it belongs to: the board would stall at 40% and cycle_time would be empty
// forever. The pull request's own number stays available in `payload`.

import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { sql } from "@/lib/db";

function verify(body: string, sig: string | null) {
  // Name the missing thing rather than throwing an unexplained 500 — the same
  // rule every other route in this codebase follows.
  if (!process.env.GH_WEBHOOK_SECRET) {
    throw new Error("GH_WEBHOOK_SECRET is not set, so no webhook can be verified. Set it here and use the identical value in the repository webhook settings.");
  }
  if (!sig) return false;
  const mac = "sha256=" + createHmac("sha256", process.env.GH_WEBHOOK_SECRET).update(body).digest("hex");
  const a = Buffer.from(mac), b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

const taskFrom = (text: string | null | undefined) => {
  const m = /iHelp-Task:\s*#(\d+)/i.exec(text || "");
  return m ? Number(m[1]) : null;
};

/**
 * The task number, read out of the branch name. Same convention that
 * .githooks/prepare-commit-msg and /api/agents/local already parse, and the
 * same one app/lib/github.ts writes when it starts a task:
 *
 *   task/142/fall-detection-threshold  ->  142
 *   agent/qa/issue-142                 ->  142
 */
const taskFromBranch = (ref: string | null | undefined) => {
  const m = /^(?:task|agent)\/(?:[a-z-]+\/)?(?:issue-)?(\d+)/i.exec(ref || "");
  return m ? Number(m[1]) : null;
};

/**
 * Fallback for a pull request opened by hand, off a branch that does not follow
 * the convention. GitHub's own closing keywords are what link a PR to an issue,
 * and openPR() in app/lib/github.ts writes "Closes #n" for exactly this reason.
 */
const taskFromBody = (body: string | null | undefined) => {
  const m = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/i.exec(body || "");
  return m ? Number(m[1]) : null;
};

/**
 * A pull request with neither a task branch nor a closing keyword has no task
 * behind it. That is recorded as null rather than guessed at: unowned work is a
 * real thing that happens here, and it should show up as a gap in the ledger
 * instead of being quietly attached to whichever number was nearest.
 */
const taskOfPR = (pr: any) => taskFromBranch(pr?.head?.ref) ?? taskFromBody(pr?.body);

export async function POST(req: Request) {
  const raw = await req.text();
  try {
    if (!verify(raw, req.headers.get("x-hub-signature-256"))) {
      return NextResponse.json({ error: "Bad signature. The webhook secret here and in the repository settings do not match." }, { status: 401 });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }

  const event = req.headers.get("x-github-event");
  const p = JSON.parse(raw);
  const repo = p.repository?.full_name;

  // sql.json(p), not JSON.stringify(p)::jsonb. postgres.js sends a JS string as
  // an already-json-typed parameter, so the cast would store the string itself
  // as a JSON scalar — payload becomes "{\"action\":\"opened\"}" rather than an
  // object, and every payload->>'...' read afterwards returns null. The insert
  // succeeds either way, which is what makes it worth naming here.
  const record = (kind: string, number: number | null, actor: string | null, at: string, agent = false) =>
    sql`insert into gh_event (kind, repo, number, actor, agent_authored, occurred_at, payload)
        values (${kind}, ${repo}, ${number}, ${actor}, ${agent}, ${at}, ${sql.json(p)})`;

  switch (event) {
    // Every push from VS Code lands here, commit by commit.
    case "push": {
      const branch = (p.ref || "").replace("refs/heads/", "");
      for (const c of p.commits || []) {
        const issue = taskFrom(c.message);
        await sql`
          insert into commit_event (repo, sha, author, branch, message, issue_number, committed_at)
          values (${repo}, ${c.id}, ${c.author?.username || c.author?.name},
                  ${branch}, ${c.message}, ${issue}, ${c.timestamp})
          on conflict (sha) do nothing
        `;
      }
      break;
    }

    case "issues":
      // Already the task number.
      if (p.action === "opened") {
        await record("issue_opened", p.issue.number, p.issue.user.login, p.issue.created_at);
      }
      break;

    case "pull_request": {
      const agent = (p.pull_request.labels || []).some((l: any) => l.name === "agent-authored");
      const task = taskOfPR(p.pull_request);

      if (p.action === "opened") {
        await record("pr_opened", task, p.pull_request.user.login, p.pull_request.created_at, agent);
      }
      if (p.action === "closed" && p.pull_request.merged) {
        await record("pr_merged", task, p.pull_request.merged_by?.login, p.pull_request.merged_at, agent);

        // Close the loop on the agent run that produced this PR, if any.
        const runId = /Platform run: `([0-9a-f-]{36})`/i.exec(p.pull_request.body || "")?.[1];
        if (runId) {
          await sql`update agent_run set status='success', pr_url=${p.pull_request.html_url},
                    finished_at=${p.pull_request.merged_at} where id=${runId}`;
        }
      }
      break;
    }

    case "pull_request_review":
      if (p.review.state === "approved") {
        await record("review_submitted", taskOfPR(p.pull_request), p.review.user.login, p.review.submitted_at);
      }
      break;

    case "workflow_run":
      // Reviewer, Manager, Escalator and agent runs all report through here.
      // A run triggered on a task branch carries the task in head_branch; one
      // triggered by a pull_request event carries it on the PR's head ref.
      if (p.workflow_run.conclusion) {
        const task =
          taskFromBranch(p.workflow_run.head_branch) ??
          taskFromBranch(p.workflow_run.pull_requests?.[0]?.head?.ref);
        await record(
          `workflow_${p.workflow_run.conclusion}`,
          task,
          p.workflow_run.actor?.login,
          p.workflow_run.updated_at
        );
      }
      break;
  }

  return NextResponse.json({ ok: true });
}
