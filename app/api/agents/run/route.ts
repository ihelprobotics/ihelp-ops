// POST /api/agents/run
//
// The platform never executes an agent itself. It records the request and
// dispatches the agent-run workflow, which checks out the repo and runs Claude
// Code headless. That keeps sandboxing, secrets and repo access inside GitHub,
// where they are already solved.

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sql } from "@/lib/db";

// Graduated access and the draft-tier exclusion both come from the shared
// roster in app/lib/agents.ts, so the board, the chat picker and this gate
// cannot disagree about which agents exist.
import { TIERS, HUMAN_OWNER_ONLY, BRIEF_LIMIT } from "@/app/lib/agents";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.login) {
    return NextResponse.json({ error: "Sign in with GitHub first." }, { status: 401 });
  }

  const { agent, repo, issue, brief } = await req.json();
  if (!agent || !repo || !issue) {
    return NextResponse.json({ error: "agent, repo and issue are all required." }, { status: 400 });
  }

  // The brief is optional, and it is the one thing here a person typed.
  //
  // It leaves the private side of the platform: it goes into the workflow
  // inputs, the Actions log and the pull request body, where the whole
  // organisation can read it. The chat it was composed in cannot be read by
  // anyone else (db/schema-chat.sql, one policy clause, no admin escape), so
  // this crossing has to be something the person did on purpose — which is why
  // the UI makes them confirm the text rather than sending the conversation.
  if (brief !== undefined && typeof brief !== "string") {
    return NextResponse.json(
      { error: "brief must be a string. It is the sentence describing what this run should do." },
      { status: 400 }
    );
  }
  const runBrief = typeof brief === "string" ? brief.trim() : "";
  if (runBrief.length > BRIEF_LIMIT) {
    return NextResponse.json(
      { error: `The brief is ${runBrief.length} characters and the limit is ${BRIEF_LIMIT}. It narrows the issue rather than replacing it — if it needs more room than that, it belongs on the issue itself, where the whole team can see it.` },
      { status: 400 }
    );
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
          // Always sent, empty when there is none: workflow_dispatch rejects an
          // input the workflow does not declare, but an input declared with a
          // default is happy to receive "".
          brief: runBrief,
        },
      }),
    }
  );

  if (!res.ok) {
    const detail = await res.text();
    await sql`update agent_run set status='failure', finished_at=now() where id=${run.id}`;

    // Say what actually failed. A generic error sends people hunting in the
    // wrong place, which is the same failure this codebase avoids elsewhere.
    //
    // 404 here almost always means one thing, and it is not "no such
    // repository": the board only offers repositories the token can read, so it
    // got this far. The workflow file is missing. Agents run inside GitHub
    // Actions, so agent-run.yml has to exist in each repository they work on —
    // and with the board now covering a whole organisation, most repositories
    // will not have it yet. Naming that saves an afternoon.
    const hint =
      res.status === 404
        ? `${repo} has no .github/workflows/agent-run.yml, so there is no agent workflow to dispatch. Agents run inside GitHub Actions in the repository they are working on — copy that workflow (and reviewer.yml) into ${repo} to run agents there. Everything else on the board works without it.`
        : res.status === 403
        ? "GH_DISPATCH_TOKEN cannot start workflows in this repository. A classic token needs `repo`; a fine-grained one needs Actions: write."
        : "";

    return NextResponse.json(
      { error: `GitHub refused the dispatch (${res.status}). ${hint} ${detail}`.replace(/\s+/g, " ").trim() },
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
