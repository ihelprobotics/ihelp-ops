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
  // Fail closed. This guard used to read
  //   if (process.env.AGENT_CALLBACK_SECRET && secret !== ...)
  // which skipped the check entirely whenever the variable was unset — so a
  // deploy that forgot it silently accepted anyone. This route is excluded from
  // the middleware matcher, so there is no session in front of it: an
  // unauthenticated caller could mark any run succeeded, with any pr_url and
  // any cost. A missing key is an error naming the missing key, never a
  // disabled guard.
  if (!process.env.AGENT_CALLBACK_SECRET) {
    return NextResponse.json(
      { error: "AGENT_CALLBACK_SECRET is not set, so this callback cannot be verified. Set it here and use the same value as PLATFORM_WEBHOOK_SECRET in the code repo." },
      { status: 500 }
    );
  }
  if (req.headers.get("x-ops-secret") !== process.env.AGENT_CALLBACK_SECRET) {
    return NextResponse.json(
      { error: "Bad secret. The value here and PLATFORM_WEBHOOK_SECRET in the code repo do not match." },
      { status: 401 }
    );
  }

  const { run_id, status, pr_url, logs_url, cost_usd, input_tokens, output_tokens } = await req.json();
  if (!run_id) return NextResponse.json({ error: "run_id is required." }, { status: 400 });

  // agent_run.id is a uuid column. Anything else reaches Postgres as
  // "invalid input syntax for type uuid" — a 500 that reads like the platform
  // broke, when in fact the caller simply named a run that cannot exist. The
  // workflow can legitimately be triggered by hand with run_id=manual-1, per
  // docs/08 section 3c, so this is a normal path and not an error condition:
  // answer it the same way as a UUID with no row, and say which it was.
  const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  if (!UUID.test(String(run_id))) {
    return NextResponse.json(
      {
        error: `run_id "${run_id}" is not a UUID, so it matches no row in agent_run — nothing was updated. That is expected for a workflow run triggered by hand from the Actions tab; the agent's own work is unaffected. Runs dispatched by the platform send agent_run.id and do update their row.`,
      },
      { status: 404 }
    );
  }

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
