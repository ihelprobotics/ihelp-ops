// GET /api/tasks
//
// Open issues, read live from every repository the platform reports on — every
// repo in GH_ORG, or the explicit REPOS list. They are not copied
// into the database on purpose: GitHub stays the single source of truth for
// what the work is, and a mirror would start disagreeing with it within a week.
//
// A task is identified by a repository *and* a number. Issue #1 exists in every
// repository there has ever been, so every task here carries its repo and every
// link is built from both.
//
// Progress is derived from what actually happened — never typed by anyone. All
// seven stages from docs/02-data-model.md are computed, in app/lib/board.ts,
// which the board page reads directly:
//
//   opened 10 · branched 20 · first commit 40 · PR open 60
//   · checks green 75 · approved 90 · merged 100

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { dbErrorMessage } from "@/lib/db";
import { loadBoard } from "@/app/lib/board";
import { repos, taskHref, type Repo } from "@/app/lib/repos";
import { noteNewTask } from "@/app/lib/work";
import { openTask, assign } from "@/app/lib/github";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  // A configuration, GitHub or database failure is reported by name, never as
  // an empty task list.
  try {
    return NextResponse.json(await loadBoard());
  } catch (e: any) {
    return NextResponse.json({ error: dbErrorMessage(e) }, { status: 500 });
  }
}

/**
 * POST /api/tasks — open a task.
 *
 * It becomes a GitHub issue and nothing else. No row is written here: the
 * platform reads tasks live, and a copy in the database would be a second
 * answer to "what is the work" that starts disagreeing within a week.
 *
 * A GitHub login is required, for the same reason taking a task requires one.
 * Everything downstream — assignment, branch attribution, CODEOWNERS, the
 * provenance line in the body — is keyed on a real username, and creating work
 * on behalf of somebody the rest of the system cannot identify puts a task on
 * the board that nobody can be given.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  if (!session.user.login) {
    return NextResponse.json(
      { error: "Link your GitHub account before opening a task. Tasks are GitHub issues, and everything that happens to one is attributed by GitHub login." },
      { status: 403 }
    );
  }

  let input: any;
  try {
    input = await req.json();
  } catch {
    return NextResponse.json({ error: "The request body is not JSON." }, { status: 400 });
  }

  const repo = String(input?.repo ?? "").trim();
  const title = String(input?.title ?? "").trim();
  const body = String(input?.body ?? "");
  const mine = input?.assignToMe === true;

  if (!title) {
    return NextResponse.json({ error: "A task needs a title. Write what the outcome is." }, { status: 400 });
  }
  if (title.length > 256) {
    return NextResponse.json({ error: "That title is too long. Put the detail in the description — the title is what people scan on the board." }, { status: 400 });
  }
  if (body.length > 60_000) {
    return NextResponse.json({ error: "That description is too long for an issue body." }, { status: 400 });
  }

  // Fail closed: only repositories this platform already reports on. Anything
  // else and a typo silently opens a task somewhere nobody is looking.
  let list: Repo[];
  try {
    list = await repos();
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
  if (!list.some((r) => r.full === repo)) {
    return NextResponse.json(
      { error: `${repo || "That repository"} is not one this platform reports on, so a task opened there would not appear on the board.` },
      { status: 404 }
    );
  }

  let made;
  try {
    made = await openTask({
      repo,
      title,
      body,
      login: session.user.login,
      name: session.user.name ?? null,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 502 });
  }

  // Taking it is optional and separately reported. A task that was created but
  // could not be assigned is still a task, and saying "it failed" would send
  // somebody looking for an issue that is sitting there perfectly fine.
  let assigned: string | null = null;
  let assignError = "";
  if (mine) {
    try {
      await assign(repo, made.number, session.user.login);
      assigned = session.user.login;
    } catch (e: any) {
      assignError = e?.message ?? String(e);
    }
  }

  // Not just a cache drop: GitHub's own issue list takes several seconds to
  // include a new issue, so a fresh read would be equally empty. See the note
  // in app/lib/work.ts.
  noteNewTask(repo, made.issue);

  return NextResponse.json({
    repo,
    number: made.number,
    url: made.url,
    href: taskHref(repo, made.number),
    assigned,
    assignError,
  }, { status: 201 });
}
