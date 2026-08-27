// POST /api/tasks/<owner>/<name>/<number>
//
// The four things a person does to a task from the platform: start it, open a
// pull request, merge, and say something. Each one calls GitHub and changes
// nothing in the database, because the artifact is the record — the branch, the
// PR, the comment. Progress moves when the webhook reports back, not when this
// route returns.
//
// Merging is here on purpose and is not a second approval system. Branch
// protection and CODEOWNERS decide; this button calls the API and can be
// refused, and that refusal is protection working.

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sql } from "@/lib/db";
import { ghFetch, startTask, openPR, merge, assign } from "@/app/lib/github";
import { branchIsForTask } from "@/app/lib/progress";
import { repoFromPath, taskRef } from "@/app/lib/repos";
import { canAssign, assignmentMessage, assignsOthers } from "@/app/lib/assign";

type Ctx = { params: Promise<{ owner: string; name: string; number: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const p = await params;

  // Checked against the configured list, not merely parsed. A repository this
  // platform does not report on is refused, so the URL cannot be used to reach
  // anything else the token happens to be able to see.
  let found;
  try {
    found = await repoFromPath(p.owner, p.name);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
  if (!found) {
    return NextResponse.json(
      { error: `"${p.owner}/${p.name}" is not one of the repositories this platform reports on. Add it to REPOS if it should be.` },
      { status: 404 }
    );
  }
  const repo = found.full;

  const issue = Number(p.number);
  if (!Number.isInteger(issue) || issue < 1) {
    return NextResponse.json({ error: "The task number in the URL is not a number." }, { status: 400 });
  }

  const [user] = await sql`
    select id, gh_login, role from app_user where email = ${session.user.email}
  `;
  if (!user) {
    return NextResponse.json({ error: "No account for this email. Ask your pod lead." }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "The request body is not JSON." }, { status: 400 });
  }

  const action = body?.action;
  const login: string | null = user.gh_login;

  // Starting a task, opening a pull request, merging and commenting all write
  // into git history under somebody's name, so they need a git identity. An
  // account with no GitHub login is refused rather than attributed to whoever
  // owns the platform's token.
  //
  // Assigning is deliberately not in that list. The platform assigns with its
  // own token, so a delivery manager with no GitHub account can still hand work
  // out — which is most of what a delivery manager does. The rules in
  // app/lib/assign.ts decide whether this particular person may.
  if (action !== "assign" && !login) {
    return NextResponse.json(
      { error: "Link your GitHub account first. Branches, pull requests and comments are attributed by GitHub login, and an unlinked account cannot own work." },
      { status: 403 }
    );
  }

  try {
    switch (action) {
      case "assign": {
        // null clears it. Anything else has to be a GitHub username.
        const to = body?.to === null || body?.to === undefined ? null : String(body.to).trim();
        if (to !== null && !/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(to)) {
          return NextResponse.json(
            { error: `"${to}" is not a GitHub username. Assignment matches on the login, not on a display name or an email.` },
            { status: 400 }
          );
        }

        const { body: current } = await ghFetch(`/repos/${repo}/issues/${issue}`);
        if (current?.pull_request) {
          return NextResponse.json(
            { error: `${taskRef(repo, issue)} is a pull request, not a task. Assign the issue it closes.` },
            { status: 400 }
          );
        }
        const held: string | null = current?.assignee?.login ?? null;

        const actor = { login, role: user.role as string };
        const refusal = canAssign(actor, held, to);
        if (refusal) return NextResponse.json({ error: refusal }, { status: 403 });

        const now = await assign(repo, issue, to);
        const self = !!login && to?.toLowerCase() === login.toLowerCase();
        return NextResponse.json({
          assignee: now,
          message: assignmentMessage(taskRef(repo, issue), now, assignsOthers(actor) && !self, self),
        });
      }

      case "start": {
        const title = await issueTitle(repo, issue);
        const started = await startTask({ repo, issue, title, login: login as string });
        return NextResponse.json({
          ...started,
          message: `Branch ${started.branch} is ready. It carries the task number, so every commit on it attributes itself.`,
        });
      }

      case "pr": {
        const branch = await taskBranch(repo, issue, body?.branch);
        const title = await issueTitle(repo, issue);
        const pr = await openPR({ repo, branch, issue, title, login: login as string });
        return NextResponse.json({ url: pr?.html_url, number: pr?.number, message: `Pull request #${pr?.number} opened from ${branch}.` });
      }

      case "merge": {
        const number = Number(body?.pr_number);
        if (!Number.isInteger(number) || number < 1) {
          return NextResponse.json(
            { error: "No pull request number was sent, so there is nothing to merge. Reload the task — the pull request may have closed." },
            { status: 400 }
          );
        }
        await merge(repo, number);
        return NextResponse.json({ message: `Pull request #${number} merged.` });
      }

      case "comment": {
        const text = String(body?.body ?? "").trim();
        if (!text) {
          return NextResponse.json({ error: "An empty comment says nothing. Write something first." }, { status: 400 });
        }
        // The platform posts with its own token, so GitHub will attribute the
        // comment to whoever owns that token. Signing it is not decoration —
        // without the line, a comment written by one person appears on the
        // issue under another person's name.
        const signed = `${text}\n\n<sub>Posted from iHelp Ops by @${login}.</sub>`;
        const { body: created } = await ghFetch(`/repos/${repo}/issues/${issue}/comments`, {
          method: "POST",
          body: JSON.stringify({ body: signed }),
        });
        return NextResponse.json({ url: created?.html_url, message: "Comment posted to the GitHub issue." });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action "${action ?? ""}". This route accepts assign, start, pr, merge or comment.` },
          { status: 400 }
        );
    }
  } catch (e: any) {
    // ghFetch, startTask, openPR and merge all throw messages that name the
    // token, the repository or the protection rule that refused. Passing the
    // message straight through is the whole point of writing them that way.
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 502 });
  }
}

async function issueTitle(repo: string, issue: number): Promise<string> {
  const { body } = await ghFetch(`/repos/${repo}/issues/${issue}`);
  const title = body?.title;
  if (typeof title !== "string") {
    throw new Error(`GitHub answered for ${repo}#${issue} without a title, so there is nothing to name the branch after.`);
  }
  return title;
}

/**
 * The branch a pull request should come from. A named one is used as sent, once
 * it is confirmed to belong to this task — otherwise a mistyped name would open
 * a pull request against somebody else's work.
 */
async function taskBranch(repo: string, issue: number, requested?: string): Promise<string> {
  if (requested) {
    if (!branchIsForTask(requested, issue)) {
      throw new Error(`Branch "${requested}" does not belong to task #${issue}. Task branches are task/${issue}/<slug> or agent/<agent>/issue-${issue}.`);
    }
    return requested;
  }
  const { body } = await ghFetch(`/repos/${repo}/branches?per_page=100`);
  const found = (Array.isArray(body) ? body : [])
    .map((b: any) => b.name as string)
    .filter((b) => branchIsForTask(b, issue));
  if (found.length === 0) {
    throw new Error(`There is no branch for task #${issue} yet, so there is nothing to open a pull request from. Start the task first.`);
  }
  return found[0];
}
