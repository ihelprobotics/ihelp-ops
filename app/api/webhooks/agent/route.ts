// POST /api/webhooks/agent
//
// The callback from agent-run.yml. This is where a dispatched run stops being
// "running" and becomes a fact: a PR URL, a cost, a token count.
//
// Guarded by a shared secret rather than a signature — the payload originates
// from our own workflow, and the workflow already holds repository secrets.

import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export async function POST(req: Request) {
  const secret = req.headers.get("x-ops-secret");
  if (process.env.AGENT_CALLBACK_SECRET && secret !== process.env.AGENT_CALLBACK_SECRET) {
    return NextResponse.json({ error: "Bad secret." }, { status: 401 });
  }

  const { run_id, status, pr_url, logs_url, cost_usd, input_tokens, output_tokens } = await req.json();
  if (!run_id) return NextResponse.json({ error: "run_id is required." }, { status: 400 });

  // A workflow that succeeded but produced no pull request is not a failure —
  // it usually means the issue was too vague for the agent to act on. That is a
  // finding worth surfacing distinctly rather than filing under "failed".
  const finalStatus =
    status === "success" ? (pr_url ? "success" : "no_changes") : "failure";

  const rows = await sql`
    update agent_run
       set status = ${finalStatus},
           pr_url = ${pr_url || null},
           logs_url = ${logs_url || null},
           cost_usd = ${cost_usd ?? null},
           input_tokens = ${input_tokens ?? null},
           output_tokens = ${output_tokens ?? null},
           finished_at = now()
     where id = ${run_id}
     returning id
  `;

  if (rows.length === 0) {
    return NextResponse.json({ error: `No run with id ${run_id}.` }, { status: 404 });
  }
  return NextResponse.json({ ok: true, status: finalStatus });
}
