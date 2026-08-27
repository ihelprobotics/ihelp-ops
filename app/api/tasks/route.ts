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
// seven stages from docs/02-data-model.md are computed here:
//
//   opened 10 · branched 20 · first commit 40 · PR open 60
//   · checks green 75 · approved 90 · merged 100

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sql } from "@/lib/db";
import { stageOf, branchIsForTask } from "@/app/lib/progress";
import { repos, taskHref, type Repo } from "@/app/lib/repos";

type Row = {
  repo: string;
  number: number;
  title: string;
  url: string;
  href: string;
  assignee: string | null;
  labels: string[];
  progress: number;
  updated_at: string;
};

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  let list: Repo[];
  try {
    list = await repos();
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }

  if (!process.env.GH_DISPATCH_TOKEN) {
    return NextResponse.json({ error: "GH_DISPATCH_TOKEN is not set, so GitHub cannot be read." }, { status: 500 });
  }

  const headers = {
    Authorization: `Bearer ${process.env.GH_DISPATCH_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  // One repository failing must not blank the others. Each is read
  // independently and reports its own problem, so a token that lost access to
  // one repo shows an error beside that repo rather than an empty board.
  const perRepo = await Promise.all(
    list.map(async (r) => {
      const [issueRes, branchRes] = await Promise.all([
        fetch(`https://api.github.com/repos/${r.full}/issues?state=open&per_page=50`, { headers, cache: "no-store" }),
        fetch(`https://api.github.com/repos/${r.full}/branches?per_page=100`, { headers, cache: "no-store" }),
      ]);

      if (!issueRes.ok) {
        const detail = (await issueRes.text()).slice(0, 200);
        const hint =
          issueRes.status === 404
            ? `Either "${r.full}" is wrong, or the token's repository access list does not include it — a fine-grained token answers 404, not 403, for a repo it cannot see.`
            : issueRes.status === 401
            ? "GH_DISPATCH_TOKEN is invalid or expired."
            : "";
        return { repo: r.full, error: `GitHub returned ${issueRes.status} for ${r.full}. ${hint} ${detail}`.trim(), issues: [], branches: [] };
      }

      const issues = (await issueRes.json()).filter((i: any) => !i.pull_request);
      // A failed branch listing degrades stage 20; it does not break the repo.
      const branches: string[] = branchRes.ok ? (await branchRes.json()).map((b: any) => b.name) : [];
      return { repo: r.full, error: null as string | null, issues, branches };
    })
  );

  // Evidence for every task on the board, in two queries rather than per repo.
  const names = perRepo.map((p) => p.repo);
  const numbers = perRepo.flatMap((p) => p.issues.map((i: any) => i.number));

  const [events, commits] = numbers.length
    ? await Promise.all([
        sql<{ kind: string; repo: string; number: number }[]>`
          select kind, repo, number from gh_event
           where repo = any(${names}) and number = any(${numbers})`,
        sql<{ repo: string; issue_number: number }[]>`
          select distinct repo, issue_number from commit_event
           where repo = any(${names}) and issue_number = any(${numbers})`,
      ])
    : [[], []];

  const committed = new Set(commits.map((c) => `${c.repo}#${c.issue_number}`));

  const tasks: Row[] = perRepo.flatMap((p) =>
    p.issues.map((i: any): Row => ({
      repo: p.repo,
      number: i.number,
      title: i.title,
      url: i.html_url,
      href: taskHref(p.repo, i.number),
      // Exactly one name, or none. GitHub allows several; this platform does
      // not, and showing the first of many would hide that it happened.
      assignee: i.assignee?.login ?? null,
      labels: (i.labels || []).map((l: any) => l.name),
      progress: stageOf({
        kinds: events.filter((e) => e.repo === p.repo && e.number === i.number).map((e) => e.kind),
        hasCommit: committed.has(`${p.repo}#${i.number}`),
        hasBranch: p.branches.some((b: string) => branchIsForTask(b, i.number)),
      }),
      updated_at: i.updated_at,
    }))
  );

  return NextResponse.json({
    repos: perRepo.map((p) => ({ repo: p.repo, error: p.error, open: p.issues.length })),
    // Reported so an operator can tell "nothing has happened yet" apart from
    // "the webhook was never connected" — two very different situations that a
    // bare set of 10% bars would look identical for.
    events_recorded: events.length,
    tasks,
  });
}
