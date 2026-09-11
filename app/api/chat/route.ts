// POST /api/chat — talk to an agent about a task, streamed.
//
// The one place in this platform that calls Claude directly rather than
// dispatching GitHub Actions. That is a deliberate exception, recorded in
// docs/01, and it is narrow on purpose: this conversation can read and reason,
// and it has no tool that writes. Changing code still goes through the
// workflow, sandboxed, ending in a pull request somebody reviews.
//
// Streamed as Server-Sent Events. A model thinking for twenty seconds before a
// single word appears reads as a hang, and the second thing a person does when
// something looks hung is press the button again.
//
// Reads and writes go through withUser, so the policies in db/schema-chat.sql
// apply: a conversation belongs to one person and there is no admin clause.

import { auth } from "@/auth";
import { withUser } from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";
import { systemPrompt, history, threadFor } from "@/app/lib/chat";
import { costOf, isChatAgent, CHAT_MODEL } from "@/app/lib/agents";
import { repoFromPath } from "@/app/lib/repos";

export const dynamic = "force-dynamic";
// Long enough for a considered answer; the platform's own ceiling, not the
// model's. A conversation that needs more than this wants a pull request.
export const maxDuration = 120;

const enc = new TextEncoder();
const sse = (event: string, data: unknown) =>
  enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Sign in first." }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "The request body is not JSON." }, { status: 400 });
  }

  const agent = String(body?.agent ?? "");
  const issue = Number(body?.issue);
  const message = String(body?.message ?? "").trim();

  if (!isChatAgent(agent)) {
    return Response.json({ error: `"${agent}" is not an agent you can talk to.` }, { status: 400 });
  }
  if (!Number.isInteger(issue) || issue < 1) {
    return Response.json({ error: "That is not a task number." }, { status: 400 });
  }
  if (!message) {
    return Response.json({ error: "An empty message says nothing. Write something first." }, { status: 400 });
  }
  if (message.length > 8000) {
    return Response.json({ error: "That message is too long for a conversation. If it is a specification, put it on the issue and have the agent run on it." }, { status: 400 });
  }

  let found;
  try {
    found = await repoFromPath(String(body?.owner ?? ""), String(body?.name ?? ""));
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
  if (!found) {
    return Response.json({ error: "That repository is not one this platform reports on." }, { status: 404 });
  }
  const repo = found.full;

  // Checked here rather than at the top, after the request has been found
  // sound and the repository known. A person who sent a bad agent name should
  // be told that, not told about a key they cannot see and did not break —
  // "the deployment is misconfigured" and "you asked for something that does
  // not exist" send people to entirely different places.
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY is not set, so the agents cannot be talked to. It exists as a GitHub Actions secret for the agent-run workflow; that copy is write-only and cannot be read back, so the platform needs its own in the environment." },
      { status: 500 }
    );
  }

  const uid = session.user.id;
  const role = session.user.role ?? "member";
  const person = session.user.name ?? "a colleague";

  // The conversation so far, and this turn recorded before the model sees it —
  // so a message that produces an error is still in the history rather than
  // vanishing and leaving the reader unsure whether they sent it.
  let threadId: string;
  let past: { role: "user" | "assistant"; content: string }[];
  try {
    ({ threadId, past } = await withUser(uid, role, async (tx) => {
      const id = await threadFor(tx, uid, repo, issue, agent);
      const prior = await history(id, tx);
      await tx`insert into chat_message (thread_id, role, content) values (${id}, 'user', ${message})`;
      return { threadId: id, past: prior };
    }));
  } catch (e: any) {
    return Response.json({ error: `The conversation could not be saved: ${e?.message ?? String(e)}` }, { status: 500 });
  }

  const system = await systemPrompt(repo, issue, agent, person);
  const client = new Anthropic();

  const stream = new ReadableStream({
    async start(controller) {
      let text = "";
      let usage = { input: 0, output: 0 };

      try {
        const run = client.messages.stream({
          model: CHAT_MODEL,
          max_tokens: 8000,
          system,
          // Adaptive thinking, summarised, so a long pause shows its working
          // rather than looking like nothing is happening.
          thinking: { type: "adaptive", display: "summarized" },
          output_config: { effort: "medium" },
          messages: [...past, { role: "user" as const, content: message }],
        });

        // The summarised thinking, forwarded as it arrives.
        //
        // Measured before this was here: the first word of an answer landed
        // between four and eight seconds after the question, and everything
        // before it was a blinking ellipsis. Eight seconds of nothing reads as
        // broken — and a person who thinks something is broken presses the
        // button again, which costs a second answer nobody wanted.
        //
        // It is not stored. What the model thought on the way to an answer is
        // working-out, not the answer, and keeping it would mean this table
        // held more of somebody's session than the conversation itself.
        run.on("thinking", (delta) => {
          controller.enqueue(sse("thinking", { delta }));
        });

        run.on("text", (delta) => {
          text += delta;
          controller.enqueue(sse("text", { delta }));
        });

        const final = await run.finalMessage();
        usage = { input: final.usage.input_tokens, output: final.usage.output_tokens };

        if (final.stop_reason === "refusal") {
          controller.enqueue(sse("error", {
            error: "The model declined to answer that. Nothing was charged for the refusal.",
          }));
        }
      } catch (e: any) {
        const detail =
          e instanceof Anthropic.AuthenticationError ? "ANTHROPIC_API_KEY is invalid or expired."
          : e instanceof Anthropic.RateLimitError ? "The Anthropic API is rate limiting this key. Try again shortly."
          : e instanceof Anthropic.APIError ? `The Anthropic API returned ${e.status}: ${e.message}`
          : e?.message ?? String(e);
        controller.enqueue(sse("error", { error: detail }));
      }

      // Whatever happened, record what came back and what it cost. A partial
      // answer is still an answer, and a turn that spent money and left no
      // trace is the failure agent_run was fixed for.
      const cost = costOf(usage.input, usage.output);
      if (text) {
        try {
          await withUser(uid, role, (tx) => tx`
            insert into chat_message (thread_id, role, content, input_tokens, output_tokens, cost_usd)
            values (${threadId}, 'assistant', ${text}, ${usage.input}, ${usage.output}, ${cost})`);
        } catch { /* the answer already reached the reader; losing the copy is not worth failing over */ }
      }

      controller.enqueue(sse("done", {
        cost: Number(cost.toFixed(4)),
        input: usage.input,
        output: usage.output,
      }));
      controller.close();
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
