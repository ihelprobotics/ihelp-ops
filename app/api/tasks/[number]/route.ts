// POST /api/tasks/[number]
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
import { ghFetch, startTask, openPR, merge } from "@/app/lib/github";
import { branchIsForTask } from "@/app/lib/progress";

type Ctx = { params: Promise<{ number: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const repo = process.env.OPS_REPO;
  if (!repo) {
    return NextResponse.json(
      { error: "OPS_REPO is not set. Set it to the repository these tasks live in, as owner/name." },
      { status: 500 }
    );
  }

  const issue = Number((await params).number);
  if (!Number.isInteger(issue) || issue < 1) {
    return NextResponse.json({ error: "The task number in the URL is not a number." }, { status: 400 });
  }

  const [user] = await sql`
    select id, gh_login from app_user where email = ${session.user.email}
  `;
  if (!user) {
    return NextResponse.json({ error: "No account for this email. Ask your pod lead." }, { status: 403 });
  }
  // Everything below writes into git history under someone's name. An account
  // with no GitHub login cannot own any of it, so it is refused here rather
  // than attributed to whoever owns the platform's token.
  if (!user.gh_login) {
    return NextResponse.json(
      { error: "Link your GitHub account first. Branches, pull requests and comments are attributed by GitHub login, and an unlinked account cannot own work." },
      { status: 403 }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "The request body is not JSON." }, { status: 400 });
  }

  const action = body?.action;
  const login: string = user.gh_login;

  try {
    switch (action) {
      case "start": {
        const title = await issueTitle(repo, issue);
        const started = await startTask({ repo, issue, title, login });
        return NextResponse.json({
          ...started,
          message: `Branch ${started.branch} is ready. It carries the task number, so every commit on it attributes itself.`,
        });
      }

      case "pr": {
        const branch = await taskBranch(repo, issue, body?.branch);
        const title = await issueTitle(repo, issue);
        const pr = await openPR({ repo, branch, issue, title, login });
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
          { error: `Unknown action "${action ?? ""}". This route accepts start, pr, merge or comment.` },
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
