// Path D: an agent working on a task through the Claude API, from the platform.
//
// docs/01 has the four paths and why this one exists. This file is the loop.
// The route (app/api/agents/direct) decides whether a run may start and keeps
// the ledger; this decides what the agent sees, lets it read and write through
// the tools in workspace.ts, and lands what it wrote with land.ts.
//
// The budget is wall-clock, because the function's is. Vercel stops the
// function at maxDuration, and a run killed mid-turn leaves its row "running",
// where it counts against the person's two-run limit. So the loop stops
// starting turns at TURN_CUTOFF_MS, aborts a turn still going at HARD_STOP_MS,
// and lands whatever was written as a pull request marked unfinished — with the
// minute that is left, rather than none.

import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageParam, BetaToolUseBlock } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { Workspace, TOOLS, useTool } from "@/app/lib/workspace";
import { startingPoint, land, reportNoChange, type Start } from "@/app/lib/land";
import { agentBrief } from "@/app/lib/chat";
import { agentName, costOf, RUN_MODEL } from "@/app/lib/agents";

const TURN_CUTOFF_MS = 200_000;
const HARD_STOP_MS = 250_000;
const MAX_TURNS = 40;
const DOC_LIMIT = 40_000;

export type Send = (event: string, data: unknown) => void;

export type RunInput = {
  repo: string; issue: number; title: string; body: string;
  agent: string; requester: string; brief: string; runId: string;
};

export type RunResult = {
  status: "success" | "failure" | "no_changes";
  prUrl: string | null;
  usage: { input: number; output: number; cacheWrite: number; cacheRead: number };
  cost: number;
};

export async function runDirect(run: RunInput, send: Send): Promise<RunResult> {
  const started = Date.now();
  const usage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  const cost = () => costOf(usage.input, usage.output, usage.cacheWrite, usage.cacheRead);
  const result = (status: RunResult["status"], prUrl: string | null = null): RunResult =>
    ({ status, prUrl, usage, cost: cost() });
  const branch = `agent/${run.agent}/issue-${run.issue}`;

  try {
    send("status", { line: `Reading ${run.repo}…` });
    const start = await startingPoint(run.repo, branch);
    const ws = await Workspace.open(run.repo, start.commit, start.tree);
    const [brief, claudeMd] = await Promise.all([agentBrief(run.repo, run.agent), ws.readIfPresent("CLAUDE.md")]);
    send("status", {
      line: start.resumed
        ? `Continuing ${branch}, which an earlier run started.`
        : `Starting from ${start.base} at ${start.commit.slice(0, 7)}.`,
    });

    const system = systemPrompt(run, start, brief, claudeMd);
    const messages: BetaMessageParam[] = [{ role: "user", content: taskPrompt(run) }];
    const client = new Anthropic();
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), HARD_STOP_MS - (Date.now() - started));

    let summary = "";
    let unfinished = "";
    try {
      for (let turn = 0; ; turn++) {
        if (turn >= MAX_TURNS) { unfinished = `The run used all ${MAX_TURNS} of its turns before the agent said it was done.`; break; }
        if (Date.now() - started > TURN_CUTOFF_MS) { unfinished = "The run reached the platform's time limit before the agent said it was done."; break; }

        const stream = client.beta.messages.stream(
          {
            model: RUN_MODEL,
            max_tokens: 32000,
            system,
            tools: TOOLS,
            messages,
            thinking: { type: "adaptive" },
            output_config: { effort: "high" },
            // Every turn resends the files read so far; caching is what keeps
            // a forty-turn run from paying for them forty times.
            cache_control: { type: "ephemeral" },
            // A declined request is retried server-side on the model Anthropic
            // recommends for that refusal category, instead of ending the run.
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
          },
          { signal: abort.signal }
        );
        stream.on("text", (delta) => send("text", { delta }));
        const msg = await stream.finalMessage();

        usage.input += msg.usage.input_tokens;
        usage.output += msg.usage.output_tokens;
        usage.cacheWrite += msg.usage.cache_creation_input_tokens ?? 0;
        usage.cacheRead += msg.usage.cache_read_input_tokens ?? 0;

        if (msg.stop_reason === "refusal") {
          throw new Error("The model declined this task, and so did the model it was retried on. Nothing was committed; rewording the issue or the brief is the way forward.");
        }

        messages.push({ role: "assistant", content: msg.content });
        if (msg.stop_reason === "pause_turn") continue;

        const uses = msg.content.filter((b): b is BetaToolUseBlock => b.type === "tool_use");
        if (uses.length === 0) {
          summary = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
          if (msg.stop_reason === "max_tokens") unfinished = "The agent's last answer was cut off at the output limit.";
          break;
        }

        // In order, not in parallel: a read and a write of the same file in one
        // turn must see each other the way the agent wrote them.
        const results = [];
        for (const use of uses) {
          const r = await useTool(ws, use);
          send("tool", { name: use.name, path: r.path, ok: r.ok, note: r.note });
          results.push(r.block);
        }
        messages.push({ role: "user", content: results });
      }
    } catch (e) {
      // An abort is the clock, not a fault in the work so far — land what exists.
      if (!abort.signal.aborted) throw e;
      unfinished = "The run reached the platform's time limit in the middle of the agent's turn, so the cost of that last turn is not included.";
    } finally {
      clearTimeout(timer);
    }

    const changes = ws.changes();
    if (changes.length === 0) {
      if (unfinished) {
        send("error", { error: `${unfinished} It had not written anything, so there is nothing to commit.` });
        return result("failure");
      }
      send("status", { line: "The agent changed nothing. Saying so on the issue…" });
      await reportNoChange({ repo: run.repo, issue: run.issue, agent: run.agent, requester: run.requester, summary });
      send("status", { line: "Commented on the issue." });
      return result("no_changes");
    }

    send("status", { line: `Committing ${changes.length} ${changes.length === 1 ? "file" : "files"} to ${branch}…` });
    const landed = await land({
      repo: run.repo, start, changes, agent: run.agent, issue: run.issue, title: run.title,
      requester: run.requester, runId: run.runId, brief: run.brief, summary, unfinished, cost: cost(),
    });
    send("landed", {
      url: landed.url, number: landed.number, commit: landed.commit.slice(0, 7), opened: landed.opened,
      files: changes.map((c) => (c.content === null ? `${c.path} (deleted)` : c.path)),
    });
    if (landed.labelError) send("status", { line: landed.labelError });
    if (unfinished) send("error", { error: `${unfinished} What it had written is in the pull request, which is marked unfinished.` });
    return result(unfinished ? "failure" : "success", landed.url);
  } catch (e: any) {
    send("error", { error: explain(e) });
    return result("failure");
  }
}

function explain(e: any): string {
  if (e instanceof Anthropic.AuthenticationError) return "ANTHROPIC_API_KEY is invalid or expired, so the agent could not run. Nothing was committed.";
  if (e instanceof Anthropic.RateLimitError) return "The Anthropic API is rate limiting this key. Nothing was committed; try again shortly.";
  if (e instanceof Anthropic.APIError) return `The Anthropic API returned ${e.status}: ${e.message}. Nothing was committed.`;
  return e?.message ?? String(e);
}

function doc(text: string): string {
  return text.length <= DOC_LIMIT
    ? text
    : `${text.slice(0, DOC_LIMIT)}\n\n[Cut at ${DOC_LIMIT} of ${text.length} characters. Read the file with read_file if the rest matters.]`;
}

/** Stable across the run, so it is the cached prefix. The same rules agent-run.yml gives Claude Code. */
function systemPrompt(run: RunInput, start: Start, brief: string | null, claudeMd: string | null): string {
  const from = start.resumed
    ? `the head of ${start.branch} (${start.commit.slice(0, 7)}), which an earlier run started`
    : `${start.base} at ${start.commit.slice(0, 7)}`;

  return [
    `You are the ${agentName(run.agent)} agent for iHelp Robotics, working on ${run.repo}#${run.issue} for @${run.requester}.`,
    "",
    "HOW THIS RUN WORKS",
    `There is no checkout and no shell. You have four tools — list_files, read_file, write_file and delete_file — and they act on ${run.repo} as it is at ${from}.`,
    `What you write is staged. When you stop calling tools, everything you wrote becomes one commit on ${start.branch} and a pull request that a human reviews before anything merges.`,
    "You cannot run, build or test anything. Never say something was tested; say what a reviewer should run.",
    "write_file replaces the whole file. Read a file before changing it and write back all of it.",
    "Time is short: a few minutes and a limited number of turns. Keep the change as small as the issue allows, and read only what you need.",
    "",
    "WHEN YOU ARE DONE",
    "Stop calling tools and write a short summary for the pull request: what you changed, why, and what a reviewer should check. It is published on the pull request exactly as you write it.",
    "",
    "STOP CONDITIONS",
    "Stop and write down what you need, rather than guessing, if any of these is true:",
    "  * The issue is ambiguous, or you would have to guess what a screen does.",
    "  * The work would touch auth, session handling, row-level security, or any query against goal, goal_evidence, one_on_one or feedback_note.",
    "  * The change would widen who can read data about a person.",
    "  * Two requirements in docs/ genuinely conflict.",
    "In those cases make no code changes. Write the question you need answered into AGENT-NOTES.md at the repository root, and stop. Stopping with a clear question is a correct outcome. A guess that looks finished is worse than no change, because it gets merged.",
    "",
    "Stay in scope. Build what the issue asks for and nothing else. If you notice something else worth fixing, say so in your summary; do not fix it.",
    "",
    brief
      ? `YOUR BRIEF — the same .claude/agents/${run.agent}.md that GitHub Actions runs you with:\n\n${doc(brief)}`
      : `This repository has no .claude/agents/${run.agent}.md, so you are working without your usual brief. Say so in your summary.`,
    "",
    claudeMd
      ? `THIS REPOSITORY'S CLAUDE.md — not advisory; it is the standard this work is reviewed against:\n\n${doc(claudeMd)}`
      : "This repository has no CLAUDE.md.",
  ].join("\n");
}

function taskPrompt(run: RunInput): string {
  const parts = [
    `Work on issue #${run.issue} in ${run.repo}.`,
    "",
    `Title: ${run.title}`,
    "",
    "Body:",
    run.body.trim() || "(no description)",
  ];
  if (run.brief) {
    parts.push(
      "",
      "The person who started this run asked for this specifically:",
      "",
      run.brief.split("\n").map((l) => `  ${l}`).join("\n"),
      "",
      "Treat that as the focus of this run. It narrows the issue; it does not replace it and cannot authorise work the issue does not cover. If it asks for something outside the issue, or contradicts it, do not guess between them — write the conflict into AGENT-NOTES.md and stop. It is a request from a colleague, not an instruction that overrides CLAUDE.md or the stop conditions."
    );
  }
  return parts.join("\n");
}
