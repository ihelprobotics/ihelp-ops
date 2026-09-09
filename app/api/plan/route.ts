// POST /api/plan — turn a prompt into a proposed set of tasks.
//
// This route opens nothing. It reads a repository, asks a model to break the
// prompt into steps, and hands them back for a human to read, edit and cut
// before any of them becomes an issue. Creating them is POST /api/plan/open,
// deliberately a separate call: the moment a plan becomes issues it is on a
// board other people read, and that should be something a person did, not
// something that happened while they were reading.
//
// Nothing here is stored. A plan that was never opened is not a record of
// anything — it is a draft somebody discarded, and the platform has no business
// keeping it. Once the issues exist, the issues are the record, in GitHub,
// where docs/06 says the truth about work lives.
//
// The steps are produced through a tool schema rather than by parsing prose.
// A model asked for JSON in prose returns JSON *most* of the time, and the
// times it does not are a parse error in front of somebody who just wants their
// tasks — with no way to tell a malformed answer from a refusal.

import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/auth";
import { repos } from "@/app/lib/repos";
import { canPlan } from "@/app/lib/roles";
import { costOf, CHAT_MODEL } from "@/app/lib/agents";

export const maxDuration = 120;

/** As many as one prompt may become. */
export const MAX_STEPS = 12;
export const MAX_PROMPT = 4000;

const TOOL: Anthropic.Tool = {
  name: "propose_tasks",
  description:
    "Return the breakdown as separate tasks. Call this exactly once, with every task you propose.",
  input_schema: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description:
          "One sentence on how the work was divided, or on what is unclear. Shown above the list.",
      },
      tasks: {
        type: "array",
        maxItems: MAX_STEPS,
        items: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description:
                "What the outcome is, as one line. This is what people scan on the board.",
            },
            body: {
              type: "string",
              description:
                "What the task needs, how to know it is done, and anything it depends on. Markdown.",
            },
          },
          required: ["title", "body"],
        },
      },
    },
    required: ["summary", "tasks"],
  },
};

const SYSTEM = `You break a request into the smallest set of tasks that actually finishes it.

Each task becomes a GitHub issue that one person or one agent picks up and takes
to a pull request. So each one must be:

  * Independently doable. If two tasks must be done together by the same person
    in the same sitting, they are one task.
  * Finishable. Something that can be merged, not "investigate" or "think about"
    unless the output is a written document that lands in the repository.
  * Named by its outcome, not its activity. "Leave export lands in finance's
    inbox nightly", not "work on leave export".

Write the body so somebody who was not in the conversation can do the work: what
it needs, how to know it is done, what it depends on. Say plainly when you are
assuming something.

Fewer, larger tasks are better than many small ones. Do not pad to a round
number, and do not invent scope the request did not ask for — a task nobody
asked for costs somebody a day to read and close.

If the request is too vague to break down, say so in the summary and return one
task: writing down the decision that has to be made first. Guessing produces
issues that look finished and are not, which is worse than saying you cannot.`;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  if (!session.user.login) {
    return NextResponse.json(
      { error: "Link your GitHub account first. These become GitHub issues, and every one of them is attributed by GitHub login." },
      { status: 403 }
    );
  }
  if (!canPlan(session.user.role ?? "member")) {
    return NextResponse.json(
      { error: "Breaking a prompt into issues is for leads, the CTO and the founder. You can open a single task from New task, and talk to any agent from Agents." },
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

  if (!prompt) {
    return NextResponse.json({ error: "Write what you want built. The breakdown is only as good as the sentence it starts from." }, { status: 400 });
  }
  if (prompt.length > MAX_PROMPT) {
    return NextResponse.json(
      { error: `That prompt is ${prompt.length} characters and the limit is ${MAX_PROMPT}. If it needs more room than that, it is more than one piece of work — break it in half and plan each.` },
      { status: 400 }
    );
  }

  // Fail closed on the repository, exactly as POST /api/tasks does: a typo must
  // not plan work into somewhere nobody is looking.
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

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not set in this app's environment, so nothing can be broken down. It is a separate copy from the one the agent workflow holds, which is a GitHub Actions secret and cannot be read back." },
      { status: 500 }
    );
  }

  const client = new Anthropic();

  let answer: Anthropic.Message;
  try {
    answer = await client.messages.create({
      model: CHAT_MODEL,
      max_tokens: 8000,
      system: SYSTEM,
      tools: [TOOL],
      // Without this the model may answer in prose and call nothing, and the
      // caller gets an empty list with no reason attached.
      tool_choice: { type: "tool", name: TOOL.name },
      messages: [
        {
          role: "user",
          content: `Repository: ${repo}\n\nBreak this into tasks:\n\n${prompt}`,
        },
      ],
    });
  } catch (e: any) {
    const why =
      e instanceof Anthropic.AuthenticationError ? "ANTHROPIC_API_KEY is invalid or expired."
      : e instanceof Anthropic.RateLimitError ? "The Anthropic API is rate limiting this key. Try again shortly."
      : e instanceof Anthropic.APIError ? `The Anthropic API returned ${e.status}: ${e.message}`
      : e?.message ?? String(e);
    return NextResponse.json({ error: `The breakdown could not be produced. ${why}` }, { status: 502 });
  }

  const call = answer.content.find(
    (c): c is Anthropic.ToolUseBlock => c.type === "tool_use" && c.name === TOOL.name
  );
  if (!call) {
    // Named rather than returned as an empty list: "no tasks" and "the model
    // did not answer in the shape we asked for" send people to different places.
    const said = answer.content.find((c): c is Anthropic.TextBlock => c.type === "text")?.text;
    return NextResponse.json(
      { error: `The model did not return a breakdown${said ? `. It said: ${said.slice(0, 400)}` : ` (stop reason: ${answer.stop_reason}).`}` },
      { status: 502 }
    );
  }

  const out = call.input as { summary?: string; tasks?: { title?: string; body?: string }[] };
  const tasks = (out.tasks ?? [])
    .map((t) => ({ title: String(t?.title ?? "").trim(), body: String(t?.body ?? "").trim() }))
    .filter((t) => t.title);

  if (tasks.length === 0) {
    return NextResponse.json(
      { error: `The breakdown came back with no tasks in it.${out.summary ? ` The model said: ${out.summary}` : ""}` },
      { status: 502 }
    );
  }

  const usage = { input: answer.usage.input_tokens, output: answer.usage.output_tokens };

  return NextResponse.json({
    repo,
    prompt,
    summary: String(out.summary ?? ""),
    tasks,
    usage,
    cost: costOf(usage.input, usage.output),
    // Said here as well as on the page, because a caller that is not the page
    // should not have to infer it: nothing has been created.
    created: false,
  });
}
