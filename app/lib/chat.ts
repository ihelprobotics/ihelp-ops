// Talking to an agent about a task.
//
// What this is, and what it deliberately is not.
//
// This conversation runs in the platform and is **read-only against the
// repository**: it can look at the task, the comments, and the files, and it
// can think out loud with you. It cannot commit, push, or open a pull request.
//
// When you want the code changed you press "Have <agent> do this", and a real
// run does it — through the Claude API from the task page (Path D), or in
// GitHub Actions (Path A) — ending in a pull request a human reviews. So the
// fast thing stays cheap and the consequential thing stays evidenced.
//
// The agent is the same one. Its brief is read from .claude/agents/<name>.md in
// the repository, which is the identical file the workflow hands to Claude Code
// — so the qa agent you talk to has the same standards as the qa agent that
// opens the pull request, rather than being a second personality with the same
// name.

import { sql } from "@/lib/db";
import { ghFetch } from "@/app/lib/github";
import { cached } from "@/app/lib/cache";
import { HUMAN_OWNER_ONLY } from "@/app/lib/agents";

export type ChatMessage = { role: "user" | "assistant"; content: string; cost_usd?: string | null; created_at?: string };

/**
 * The agent's own brief, from the repository it works on.
 *
 * Cached for five minutes: it is a file that changes when somebody edits an
 * agent definition, which is not often, and re-reading it on every keystroke
 * would spend the request budget the rest of the platform is careful with.
 *
 * A missing brief is not fatal — a repository need not define every agent — but
 * it is said out loud in the system prompt rather than silently producing a
 * generic assistant wearing the agent's name.
 *
 * Exported because a run through the Claude API reads the same file, so the
 * agent you talk to and the agent that writes the pull request hold the same
 * standards.
 */
export async function agentBrief(repo: string, agent: string): Promise<string | null> {
  return cached(`brief:${repo}:${agent}`, async () => {
    try {
      const { body } = await ghFetch(`/repos/${repo}/contents/.claude/agents/${agent}.md`);
      if (!body?.content) return null;
      return Buffer.from(body.content, "base64").toString("utf8").slice(0, 12_000);
    } catch {
      return null;
    }
  }, 5 * 60_000);
}

/** The task, as GitHub has it right now. */
async function task(repo: string, issue: number) {
  return cached(`chattask:${repo}#${issue}`, async () => {
    const [issueRes, commentsRes] = await Promise.all([
      ghFetch(`/repos/${repo}/issues/${issue}`, { allow: [404] }),
      ghFetch(`/repos/${repo}/issues/${issue}/comments?per_page=50`, { allow: [404] }),
    ]);
    if (issueRes.status === 404) return null;
    const i = issueRes.body;
    const comments = Array.isArray(commentsRes.body) ? commentsRes.body : [];
    return {
      title: i.title as string,
      body: (i.body ?? "") as string,
      state: i.state as string,
      assignee: i.assignee?.login ?? null,
      labels: (i.labels ?? []).map((l: any) => (typeof l === "string" ? l : l.name)),
      comments: comments.map((c: any) => ({ author: c.user?.login ?? "unknown", body: c.body ?? "" })),
    };
  }, 30_000);
}

/**
 * The system prompt.
 *
 * Two things in here are load-bearing. The agent is told plainly that it cannot
 * change anything, because an agent that believes it can write code will
 * describe edits as though it has made them and the reader will believe it.
 * And it is told to say when it does not know — the same rule the workflow
 * gives it, where stopping with a clear question is a correct outcome.
 */
export async function systemPrompt(repo: string, issue: number, agent: string, person: string) {
  const [ownBrief, t] = await Promise.all([agentBrief(repo, agent), task(repo, issue)]);
  const draft = HUMAN_OWNER_ONLY.includes(agent);

  const lines = [
    `You are the ${agent} agent for iHelp Robotics, talking with ${person} about ${repo}#${issue}.`,
    "",
    "WHAT YOU CAN DO HERE",
    "You are in a conversation, not a work session. You can read, reason, explain,",
    "review, plan and disagree. You cannot edit files, commit, push, or open a pull",
    "request from this conversation — none of those tools exist here.",
    draft
      ? "You are a draft or advisory agent, so the platform never runs you. Draft what is needed here, in the conversation; your human owner decides what happens to it."
      : "When the work needs doing, say so plainly and tell them to press \"Have this agent do this\" below the conversation, which starts a real run that can change files and opens a pull request.",
    "",
    "Never describe an edit as though you have made it. You have not.",
    "",
    "HOW TO ANSWER",
    "Be brief and concrete. This is a colleague at their desk, not a document.",
    "If you do not know something about this repository, say so and name what you",
    "would need to read — do not guess at file contents or invent behaviour. A",
    "clear question is a better answer than a confident wrong one.",
    "",
  ];

  if (ownBrief) {
    lines.push("YOUR BRIEF — the same file you are given when you run for real:", "", ownBrief, "");
  } else {
    lines.push(
      `This repository has no .claude/agents/${agent}.md, so you are working without`,
      "your usual brief. Say so if the conversation turns on what your role covers.",
      ""
    );
  }

  if (t) {
    lines.push(
      "THE TASK",
      `#${issue} — ${t.title}  (${t.state}${t.assignee ? `, assigned to @${t.assignee}` : ", unassigned"})`,
      t.labels.length ? `Labels: ${t.labels.join(", ")}` : "",
      "",
      t.body.trim() || "(no description)",
      ""
    );
    if (t.comments.length) {
      lines.push("COMMENTS ON THE ISSUE", ...t.comments.map((c) => `@${c.author}: ${c.body}`.slice(0, 1500)), "");
    }
  } else {
    lines.push(`Issue #${issue} could not be read from ${repo}. Say so rather than guessing at it.`, "");
  }

  return lines.filter((l) => l !== null).join("\n");
}

/** The conversation so far, oldest first. Empty for a new one. */
export async function history(threadId: string, tx: any): Promise<ChatMessage[]> {
  return tx`select role, content from chat_message
             where thread_id = ${threadId} order by created_at, id`;
}

/** Find this person's thread for this agent and task, or start one. */
export async function threadFor(tx: any, userId: string, repo: string, issue: number, agent: string) {
  const [existing] = await tx`
    select id from chat_thread
     where user_id = ${userId} and repo = ${repo} and issue_number = ${issue} and agent = ${agent}`;
  if (existing) return existing.id as string;

  const [made] = await tx`
    insert into chat_thread (user_id, repo, issue_number, agent)
    values (${userId}, ${repo}, ${issue}, ${agent})
    returning id`;
  return made.id as string;
}
