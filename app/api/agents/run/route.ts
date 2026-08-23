// POST /api/agents/run
//
// The platform never executes an agent itself. It records the request and
// dispatches the agent-run workflow, which checks out the repo and runs Claude
// Code headless. That keeps sandboxing, secrets and repo access inside GitHub,
// where they are already solved.

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sql } from "@/lib/db";

// Graduated access, from the operating model. A new joiner gets agents whose
// mistakes are visible and harmless; the rest unlock as they learn what good
// looks like in this codebase.
const TIERS: Record<string, string[]> = {
  week1: ["scribe", "annotator", "qa"],
  week2: ["scribe", "annotator", "qa", "frontend"],
  full: ["scribe", "annotator", "qa", "frontend", "fullstack", "ai-developer", "integrator", "architect"],
};

// Draft and advisory agents are never dispatched from the platform. Their human
// owner runs them, because their output leaves the company or changes
// production.
const HUMAN_OWNER_ONLY = ["deployer", "cloud", "social", "outreach", "leadgen"];

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.login) {
    return NextResponse.json({ error: "Sign in with GitHub first." }, { status: 401 });
  }

  const { agent, repo, issue } = await req.json();
  if (!agent || !repo || !issue) {
    return NextResponse.json({ error: "agent, repo and issue are all required." }, { status: 400 });
  }

  const [user] = await sql`
    select id, gh_login, role, agent_tier from app_user where gh_login = ${session.user.login}
  `;
  if (!user) {
    return NextResponse.json({ error: "No account for this GitHub login. Ask your pod lead." }, { status: 403 });
  }

  if (HUMAN_OWNER_ONLY.includes(agent)) {
    return NextResponse.json(
      { error: `The ${agent} agent is draft or advisory tier. Its human owner runs it directly — its output either leaves the company or changes production.` },
      { status: 403 }
    );
  }

  const allowed = user.role === "cto" || user.role === "founder"
    ? TIERS.full
    : TIERS[user.agent_tier] ?? TIERS.week1;

  if (!allowed.includes(agent)) {
    return NextResponse.json(
      { error: `Not available at your level yet. You can use: ${allowed.join(", ")}. Your pod lead moves you up when you are ready.` },
      { status: 403 }
    );
  }

  // Two concurrent runs per person. Same WIP limit as everything else here.
  const [{ count }] = await sql`
    select count(*)::int from agent_run
    where requester_id = ${user.id} and status in ('queued','running')
  `;
  if (count >= 2) {
    return NextResponse.json(
      { error: "You already have two agent runs going. Finish one first — the limit is two for people and agents alike." },
      { status: 429 }
    );
  }

  const [run] = await sql`
    insert into agent_run (requester_id, agent, repo, issue_number, status)
    values (${user.id}, ${agent}, ${repo}, ${issue}, 'queued')
    returning id
  `;

  const res = await fetch(
    `https://api.github.com/repos/${repo}/actions/workflows/agent-run.yml/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GH_DISPATCH_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        ref: "main",
        inputs: {
          agent,
          issue: String(issue),
          requester: user.gh_login,
          run_id: run.id,
        },
      }),
    }
  );

  if (!res.ok) {
    const detail = await res.text();
    await sql`update agent_run set status='failure', finished_at=now() where id=${run.id}`;
    // Say what actually failed. A generic error sends people hunting in the
    // wrong place, which is the same failure this codebase avoids elsewhere.
    return NextResponse.json(
      { error: `GitHub refused the dispatch (${res.status}). ${detail}` },
      { status: 502 }
    );
  }

  await sql`update agent_run set status='running' where id=${run.id}`;

  return NextResponse.json({
    run_id: run.id,
    status: "running",
    message: `The ${agent} agent is working on ${repo}#${issue}. It will open a PR. You own what it produces — read it, run it, be ready to explain it.`,
  });
}
