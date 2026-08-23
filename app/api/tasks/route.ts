// GET /api/tasks
//
// Reads open issues live from GitHub. They are not copied into the database on
// purpose: GitHub stays the single source of truth for what the work is, and a
// mirror would start disagreeing with it within a week.
//
// Progress is derived from what actually happened — never typed by anyone. All
// seven stages from docs/02-data-model.md are computed here:
//
//   opened 10 · branched 20 · first commit 40 · PR open 60
//   · checks green 75 · approved 90 · merged 100

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sql } from "@/lib/db";

const STAGE = {
  opened: 10, branched: 20, committed: 40,
  pr_open: 60, checks_green: 75, approved: 90, merged: 100,
};

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const repo = process.env.OPS_REPO;
  if (!repo) {
    return NextResponse.json({ error: "OPS_REPO is not set. Set it to the repository whose issues should appear here, as owner/name." }, { status: 500 });
  }
  if (!process.env.GH_DISPATCH_TOKEN) {
    return NextResponse.json({ error: "GH_DISPATCH_TOKEN is not set, so GitHub cannot be read." }, { status: 500 });
  }

  const headers = {
    Authorization: `Bearer ${process.env.GH_DISPATCH_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  // Issues and branches in parallel. Branch existence is what proves stage 20,
  // and it is not something GitHub sends as a webhook event we store.
  const [issueRes, branchRes] = await Promise.all([
    fetch(`https://api.github.com/repos/${repo}/issues?state=open&per_page=50`, { headers, cache: "no-store" }),
    fetch(`https://api.github.com/repos/${repo}/branches?per_page=100`, { headers, cache: "no-store" }),
  ]);

  if (!issueRes.ok) {
    const detail = await issueRes.text();
    const hint = issueRes.status === 404
      ? `Either OPS_REPO ("${repo}") is wrong, or the token's repository access list does not include it.`
      : issueRes.status === 401
      ? "GH_DISPATCH_TOKEN is invalid or expired."
      : "";
    return NextResponse.json({ error: `GitHub returned ${issueRes.status} for issues. ${hint} ${detail}` }, { status: 502 });
  }

  const issues = (await issueRes.json()).filter((i: any) => !i.pull_request);
  const branches: string[] = branchRes.ok
    ? (await branchRes.json()).map((b: any) => b.name)
    : [];                                    // branch listing failing degrades stage 20, it does not break the page

  const numbers = issues.map((i: any) => i.number);

  // Events, commits and workflow conclusions — the three derived sources.
  const [events, commits] = numbers.length
    ? await Promise.all([
        sql`select kind, number, occurred_at, payload from gh_event
             where repo = ${repo} and number = any(${numbers})`,
        sql`select distinct issue_number from commit_event
             where repo = ${repo} and issue_number = any(${numbers})`,
      ])
    : [[], []];

  const committed = new Set(commits.map((c: any) => c.issue_number));
  const hasBranch = (n: number) => branches.some((b) => b.startsWith(`task/${n}/`) || b.startsWith(`agent/`) && b.includes(`issue-${n}`));

  function stageOf(n: number) {
    const mine = events.filter((e: any) => e.number === n);
    const kinds = mine.map((e: any) => e.kind);

    if (kinds.includes("pr_merged")) return STAGE.merged;
    if (kinds.includes("review_submitted")) return STAGE.approved;

    if (kinds.includes("pr_opened")) {
      // Checks green is recorded as a workflow_run conclusion against this repo.
      // Only promote past 60 when a success is actually on record.
      const green = kinds.includes("workflow_success");
      return green ? STAGE.checks_green : STAGE.pr_open;
    }

    if (committed.has(n)) return STAGE.committed;
    if (hasBranch(n)) return STAGE.branched;
    return STAGE.opened;
  }

  return NextResponse.json({
    repo,
    // Reported so an operator can tell "nothing has happened yet" apart from
    // "the webhook was never connected" — two very different situations that a
    // bare set of 10% bars would look identical for.
    events_recorded: events.length,
    tasks: issues.map((i: any) => ({
      number: i.number,
      title: i.title,
      url: i.html_url,
      assignee: i.assignee?.login ?? null,
      labels: (i.labels || []).map((l: any) => l.name),
      progress: stageOf(i.number),
      updated_at: i.updated_at,
    })),
  });
}
