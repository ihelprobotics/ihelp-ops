// POST /api/agents/direct — run an agent on a task through the Claude API.
//
// Path D in docs/01. The platform used to execute no agents itself; since
// 2026-09-11 it can run one, and the rules that made dispatching safe hold here
// unchanged:
//
//   * A linked GitHub login, the tier gate and the draft-agent exclusion come
//     from canDispatch in app/lib/agents.ts — the rule the button reads too —
//     and the two-run limit is the same query POST /api/agents/run makes.
//   * The work ends in a branch and a pull request. Nothing is pushed to the
//     default branch, and branch protection still decides what merges.
//   * The run has an agent_run row from the moment it starts, and the row ends
//     with its status, pull request and cost whatever happened in between.
//
// Streamed as Server-Sent Events: a run takes minutes, and a page that says
// nothing for minutes gets reloaded — which here would start a second run.

import { auth } from "@/auth";
import { sql, dbErrorMessage } from "@/lib/db";
import { ghFetch } from "@/app/lib/github";
import { repoFromPath } from "@/app/lib/repos";
import { forgetWork } from "@/app/lib/work";
import { AGENTS, HUMAN_OWNER_ONLY, BRIEF_LIMIT, canDispatch } from "@/app/lib/agents";
import { runDirect } from "@/app/lib/direct-run";

export const dynamic = "force-dynamic";
// The ceiling Vercel allows this project. The run budgets itself inside it —
// see the clock in app/lib/direct-run.ts.
export const maxDuration = 300;

const enc = new TextEncoder();
const sse = (event: string, data: unknown) => enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
const refuse = (status: number, error: string) => Response.json({ error }, { status });

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return refuse(401, "Sign in first.");
  if (!session.user.login) {
    return refuse(403, "Link your GitHub account before running an agent. Its commit and pull request are attributed by GitHub login, and an account without one cannot own work.");
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return refuse(400, "The request body is not JSON.");
  }

  const agent = String(body?.agent ?? "");
  const issue = Number(body?.issue);
  if (!AGENTS.some((a) => a.id === agent) && !HUMAN_OWNER_ONLY.includes(agent)) {
    return refuse(400, `"${agent}" is not an agent this platform knows.`);
  }
  if (!Number.isInteger(issue) || issue < 1) return refuse(400, "That is not a task number.");

  // The brief is the one thing here a person typed, and it is published: it is
  // quoted in the pull request. The UI says so before it is sent.
  if (body?.brief !== undefined && typeof body.brief !== "string") {
    return refuse(400, "brief must be a string. It is the sentence describing what this run should do.");
  }
  const brief = typeof body?.brief === "string" ? body.brief.trim() : "";
  if (brief.length > BRIEF_LIMIT) {
    return refuse(400, `The brief is ${brief.length} characters and the limit is ${BRIEF_LIMIT}. It narrows the issue rather than replacing it — if it needs more room than that, it belongs on the issue itself, where the whole team can see it.`);
  }

  // Fail closed: only repositories the platform reports on. The token can see
  // more than the board does, and the URL must not widen that.
  let repo: string;
  try {
    const found = await repoFromPath(String(body?.owner ?? ""), String(body?.name ?? ""));
    if (!found) return refuse(404, `"${body?.owner}/${body?.name}" is not one of the repositories this platform reports on, so an agent cannot be run there.`);
    repo = found.full;
  } catch (e: any) {
    return refuse(500, e?.message ?? String(e));
  }

  let user: any;
  try {
    [user] = await sql`
      select id, gh_login, role, agent_tier from app_user
       where gh_login = ${session.user.login} and active`;
  } catch (e) {
    return refuse(503, dbErrorMessage(e));
  }
  if (!user) return refuse(403, `No active account is linked to @${session.user.login}. Ask your pod lead.`);

  // Read from the database row rather than the session, as the dispatch route
  // does: a tier changed this morning applies now, not at the next sign-in.
  const allowed = canDispatch(agent, { role: user.role, tier: user.agent_tier });
  if (!allowed.ok) return refuse(403, allowed.why);

  if (!process.env.ANTHROPIC_API_KEY) {
    return refuse(500, "ANTHROPIC_API_KEY is not set in the platform's environment, so it cannot run an agent itself. The copy in GitHub Actions secrets cannot be read back — set one here, or use Run in GitHub Actions instead.");
  }

  try {
    const [{ count }] = await sql`
      select count(*)::int from agent_run
       where requester_id = ${user.id} and status in ('queued','running')`;
    if (count >= 2) {
      return refuse(429, "You already have two agent runs going. Finish one first — the limit is two for people and agents alike.");
    }
  } catch (e) {
    return refuse(503, dbErrorMessage(e));
  }

  // The issue is the task, read live. A closed issue or a pull request number is
  // refused by name rather than worked on.
  let task: any;
  try {
    const res = await ghFetch(`/repos/${repo}/issues/${issue}`, { allow: [404, 410] });
    if (res.status !== 200) return refuse(404, `${repo}#${issue} does not exist, so there is no task to run an agent on.`);
    if (res.body?.pull_request) return refuse(400, `${repo}#${issue} is a pull request, not an issue. Run the agent on the task it closes.`);
    if (res.body?.state !== "open") return refuse(409, `${repo}#${issue} is closed. Reopen it on GitHub first if there is still work to do.`);
    task = res.body;
  } catch (e: any) {
    return refuse(502, e?.message ?? String(e));
  }

  let runId: string;
  try {
    const [row] = await sql`
      insert into agent_run (requester_id, agent, repo, issue_number, status)
      values (${user.id}, ${agent}, ${repo}, ${issue}, 'running')
      returning id`;
    runId = row.id;
  } catch (e) {
    return refuse(503, dbErrorMessage(e));
  }

  const stream = new ReadableStream({
    async start(controller) {
      // A reader who leaves must not make the run throw halfway through writing
      // its ledger row, so a failed enqueue is swallowed.
      const send = (event: string, data: unknown) => {
        try { controller.enqueue(sse(event, data)); } catch { /* the reader has gone */ }
      };
      send("started", { run_id: runId, branch: `agent/${agent}/issue-${issue}` });

      const result = await runDirect(
        { repo, issue, title: task.title, body: task.body ?? "", agent, requester: user.gh_login, brief, runId },
        send
      );
      forgetWork(repo);

      const input = result.usage.input + result.usage.cacheWrite + result.usage.cacheRead;
      try {
        await sql`
          update agent_run
             set status = ${result.status}, pr_url = ${result.prUrl}, cost_usd = ${result.cost},
                 input_tokens = ${input}, output_tokens = ${result.usage.output}, finished_at = now()
           where id = ${runId}`;
      } catch (e) {
        send("error", {
          error: `The run ended but its record could not be saved: ${dbErrorMessage(e)} agent_run ${runId} will read "running" until it is updated by hand, and counts against your two-run limit until then.`,
        });
      }

      send("done", {
        status: result.status, pr_url: result.prUrl,
        cost: Number(result.cost.toFixed(4)), input, output: result.usage.output,
      });
      try { controller.close(); } catch { /* already closed */ }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
