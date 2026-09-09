// POST /api/plan/open — open the tasks a human just approved.
//
// Separate from /api/plan on purpose. Generating a breakdown costs a few cents
// and can be thrown away; opening it puts work on a board other people read and
// plan around. One is a draft, the other is a commitment, and they should not
// be the same button.
//
// What arrives here is what the person edited and kept, not what the model
// said. The route does not re-read the plan from anywhere — there is nowhere to
// re-read it from, because a plan is not stored — so the titles and bodies in
// this request are the ones that become issues.
//
// PARTIAL FAILURE IS THE NORMAL CASE
//
// Eight issues is eight calls to GitHub, and the fifth can fail on its own. So
// every task is reported individually: what was created, with its number and
// URL, and what was not, with the reason. Returning a single ok/failed for the
// batch would leave somebody unable to tell which four of eight exist without
// going to GitHub and counting — and the ones that did get created are real
// work that must not be silently opened twice on a retry.

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { repos } from "@/app/lib/repos";
import { canPlan } from "@/app/lib/roles";
import { openTask } from "@/app/lib/github";
import { noteNewTask, forgetWork } from "@/app/lib/work";
import { MAX_STEPS, MAX_PROMPT } from "../route";

export const maxDuration = 120;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  if (!session.user.login) {
    return NextResponse.json(
      { error: "Link your GitHub account first. Tasks are GitHub issues, and everything that happens to one is attributed by GitHub login." },
      { status: 403 }
    );
  }
  if (!canPlan(session.user.role ?? "member")) {
    return NextResponse.json(
      { error: "Opening a set of issues from a prompt is for leads, the CTO and the founder. You can open a single task from New task." },
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
  const prompt = String(input?.prompt ?? "").trim();
  const incoming = Array.isArray(input?.tasks) ? input.tasks : null;

  if (!incoming) {
    return NextResponse.json({ error: "tasks must be an array of { title, body }." }, { status: 400 });
  }

  const tasks = incoming.map((t: any) => ({
    title: String(t?.title ?? "").trim(),
    body: String(t?.body ?? ""),
  }));

  if (tasks.length === 0) {
    return NextResponse.json({ error: "Nothing was selected, so nothing was opened." }, { status: 400 });
  }
  if (tasks.length > MAX_STEPS) {
    return NextResponse.json(
      { error: `That is ${tasks.length} tasks and the limit is ${MAX_STEPS}. More than that in one go is a plan nobody will read before it is on the board.` },
      { status: 400 }
    );
  }
  const untitled = tasks.findIndex((t: { title: string }) => !t.title);
  if (untitled !== -1) {
    return NextResponse.json(
      { error: `Task ${untitled + 1} has no title. Every issue needs a line that says what the outcome is.` },
      { status: 400 }
    );
  }
  const tooLong = tasks.findIndex((t: { title: string }) => t.title.length > 256);
  if (tooLong !== -1) {
    return NextResponse.json(
      { error: `Task ${tooLong + 1} has a title longer than 256 characters. Put the detail in the description — the title is what people scan on the board.` },
      { status: 400 }
    );
  }
  if (prompt.length > MAX_PROMPT) {
    return NextResponse.json({ error: `The prompt is longer than ${MAX_PROMPT} characters.` }, { status: 400 });
  }

  let list;
  try {
    list = await repos();
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
  if (!list.some((r) => r.full === repo)) {
    return NextResponse.json(
      { error: `${repo || "That repository"} is not one this platform reports on, so tasks opened there would not appear on the board.` },
      { status: 404 }
    );
  }

  // The prompt travels into every issue body. There is no parent record and no
  // plan table, so this line is the only thing tying these issues to the
  // request that produced them — and it is in GitHub, readable by search, where
  // somebody looking at one issue in six months can see why it exists.
  const provenance = prompt
    ? `\n\n---\n_Broken out of this request:_\n\n> ${prompt.replace(/\n/g, "\n> ")}`
    : "";

  const results: {
    title: string;
    ok: boolean;
    number?: number;
    url?: string;
    error?: string;
  }[] = [];

  for (const t of tasks) {
    try {
      const made = await openTask({
        repo,
        title: t.title,
        body: (t.body ? t.body : "_No description._") + provenance,
        login: session.user.login,
        name: session.user.name ?? null,
      });
      // The board reads GitHub's issue list, which is not read-your-writes —
      // without this the person who just opened these sees a board missing
      // them and opens them again.
      noteNewTask(repo, made.issue);
      results.push({ title: t.title, ok: true, number: made.number, url: made.url });
    } catch (e: any) {
      results.push({ title: t.title, ok: false, error: e?.message ?? String(e) });
    }
  }

  const opened = results.filter((r) => r.ok);
  if (opened.length > 0) forgetWork(repo);

  const failed = results.length - opened.length;
  const message =
    failed === 0
      ? `${opened.length} task${opened.length === 1 ? "" : "s"} opened in ${repo}.`
      : opened.length === 0
        ? `None of the ${results.length} tasks could be opened. Each reason is below; nothing was created.`
        : `${opened.length} of ${results.length} opened. The other ${failed} did not — each reason is below. Do not send the whole set again, or the ones that worked will be opened twice.`;

  return NextResponse.json(
    { repo, message, opened: opened.length, failed, results },
    // Partial success is not an error status: some of it worked, and a 4xx/5xx
    // makes a client discard a body that names real issue numbers.
    { status: opened.length === 0 ? 502 : 200 }
  );
}
