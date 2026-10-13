// The repository, as an agent running through the Claude API sees it.
//
// Path D in docs/01. There is no checkout and no shell: the agent reads files
// from GitHub at one commit and stages whole-file writes here, in memory.
// Nothing reaches GitHub until the run is over, and then all of it lands as one
// commit and one pull request (app/lib/land.ts). A run that is cut off leaves no
// half-pushed branch behind.
//
// Three limits are refusals, never silent trims:
//
//   * A file too long to read whole comes back with a line saying so, and that
//     file cannot then be written. An agent that edits the half it saw and
//     writes it back deletes the other half, and the diff looks like a rewrite.
//   * Workflow files cannot be written or deleted. A workflow decides what runs
//     with the repository's secrets; a change to one is a person's decision.
//   * Paths are relative and cannot climb out with "..".

import type {
  BetaTool,
  BetaToolUseBlock,
  BetaToolResultBlockParam,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { ghFetch } from "@/app/lib/github";

const READ_LIMIT = 100_000;    // characters handed back per read
const WRITE_LIMIT = 500_000;   // characters per written file
const LIST_LIMIT = 500;        // paths per listing
const BLOB_LIMIT = 2_000_000;  // bytes; a larger file is not read at all

type Entry = { sha: string; size: number; mode: string };

export type Change = { path: string; content: string | null; mode: string };

export class Workspace {
  private tree = new Map<string, Entry>();
  /** A string is a write, null is a deletion. */
  private staged = new Map<string, string | null>();
  private originals = new Map<string, string>();
  private partlySeen = new Set<string>();
  private truncatedTree = false;

  private constructor(readonly repo: string, readonly commit: string) {}

  static async open(repo: string, commit: string, treeSha: string): Promise<Workspace> {
    const ws = new Workspace(repo, commit);
    const { body } = await ghFetch(`/repos/${repo}/git/trees/${treeSha}?recursive=1`);
    if (!Array.isArray(body?.tree)) {
      throw new Error(`GitHub returned no file tree for ${repo} at ${commit.slice(0, 7)}, so there is nothing for the agent to read.`);
    }
    for (const e of body.tree) {
      if (e.type === "blob") ws.tree.set(e.path, { sha: e.sha, size: e.size ?? 0, mode: e.mode });
    }
    ws.truncatedTree = !!body.truncated;
    return ws;
  }

  list(prefix: string): string {
    const dir = String(prefix ?? "").trim().replace(/^\.?\/+/, "").replace(/\/+$/, "");
    const paths = new Set([...this.tree.keys()].filter((p) => this.staged.get(p) !== null));
    for (const [p, c] of this.staged) if (c !== null) paths.add(p);

    const hits = [...paths].filter((p) => !dir || p === dir || p.startsWith(`${dir}/`)).sort();
    if (hits.length === 0) return dir ? `Nothing exists under ${dir}/.` : "The repository has no files.";

    return [
      hits.slice(0, LIST_LIMIT).join("\n"),
      hits.length > LIST_LIMIT ? `\n…and ${hits.length - LIST_LIMIT} more. Pass a narrower path to see them.` : "",
      this.truncatedTree ? "\nGitHub truncated this repository's file tree, so this listing may be missing files." : "",
    ].join("");
  }

  async read(path: string): Promise<string> {
    const p = checkPath(path, "read");
    if (this.staged.has(p)) {
      const c = this.staged.get(p);
      if (c === null) throw new Error(`${p} was deleted earlier in this run.`);
      return c;
    }

    const e = this.tree.get(p);
    if (!e) throw new Error(`There is no file at ${p}. Use list_files to see what exists.`);
    if (e.size > BLOB_LIMIT) {
      throw new Error(`${p} is ${e.size} bytes, too large to read here. If the task needs it changed, say so in your summary rather than working around it.`);
    }

    let text = this.originals.get(p);
    if (text === undefined) {
      const { body } = await ghFetch(`/repos/${this.repo}/git/blobs/${e.sha}`);
      const bytes = Buffer.from(String(body?.content ?? ""), "base64");
      if (bytes.includes(0)) throw new Error(`${p} is a binary file and cannot be read as text.`);
      text = bytes.toString("utf8");
      this.originals.set(p, text);
    }

    if (text.length <= READ_LIMIT) return text;
    this.partlySeen.add(p);
    return `${text.slice(0, READ_LIMIT)}\n\n[${p} is ${text.length} characters; only the first ${READ_LIMIT} are shown. You cannot write this file back — you have not seen all of it.]`;
  }

  /** A file the run needs for itself, like CLAUDE.md. Absent is an answer, not an error. */
  async readIfPresent(path: string): Promise<string | null> {
    return this.tree.has(path) ? this.read(path) : null;
  }

  write(path: string, content: unknown): string {
    const p = checkPath(path, "write");
    if (typeof content !== "string") throw new Error("content must be the whole file, as a string.");
    if (content.length > WRITE_LIMIT) {
      throw new Error(`That is ${content.length} characters; a file written from a run may be at most ${WRITE_LIMIT}. Leave a change this large for a person.`);
    }
    if (this.partlySeen.has(p)) {
      throw new Error(`You have only seen the first part of ${p}, so writing it back would delete the rest. Leave it unchanged and say so in your summary.`);
    }
    const existed = this.tree.has(p) || typeof this.staged.get(p) === "string";
    this.staged.set(p, content);
    return `${existed ? "Replaced" : "Created"} ${p} (${content.length} characters). Staged — it is committed when you finish.`;
  }

  remove(path: string): string {
    const p = checkPath(path, "delete");
    const inTree = this.tree.has(p);
    if (!inTree && typeof this.staged.get(p) !== "string") throw new Error(`There is no file at ${p} to delete.`);
    if (inTree) this.staged.set(p, null);
    else this.staged.delete(p);
    return `Deleted ${p}. Staged — it is committed when you finish.`;
  }

  /** What the run changed against the commit it started from. Rewriting a file with its own contents is not a change. */
  changes(): Change[] {
    const out: Change[] = [];
    for (const [path, content] of this.staged) {
      if (content !== null && this.originals.get(path) === content) continue;
      out.push({ path, content, mode: this.tree.get(path)?.mode ?? "100644" });
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }
}

function checkPath(raw: unknown, verb: "read" | "write" | "delete"): string {
  const p = String(raw ?? "").trim().replace(/^\.\//, "");
  if (!p || p.startsWith("/") || p.split("/").some((s) => s === "" || s === "." || s === "..")) {
    throw new Error(`"${String(raw)}" is not a path inside the repository. Use a relative path such as src/app.ts — no leading slash, no "..".`);
  }
  if (verb !== "read" && (p === ".git" || p.startsWith(".git/"))) {
    throw new Error(`${p} is inside .git, which is not part of the repository's files.`);
  }
  if (verb !== "read" && p.startsWith(".github/workflows/")) {
    throw new Error(`${p} is a GitHub Actions workflow, and a run from the platform cannot ${verb} one. A workflow decides what runs with this repository's secrets, so a change to it is made by a person, in their own pull request.`);
  }
  return p;
}

// ---------------------------------------------------------------------------
// The tools the agent is given
// ---------------------------------------------------------------------------

const PATH = { type: "string", description: "A path relative to the repository root, such as app/lib/work.ts." };

export const TOOLS: BetaTool[] = [
  {
    name: "list_files",
    description: "List file paths in the repository as of this run, including files you have written. Pass a directory to narrow the list, or an empty string for everything.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string", description: "A directory such as app/api, or an empty string for the whole repository." } },
      required: ["path"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "read_file",
    description: "Read a text file. Returns your staged version if you have written it in this run.",
    input_schema: { type: "object", properties: { path: PATH }, required: ["path"], additionalProperties: false },
    strict: true,
  },
  {
    name: "write_file",
    description: "Create a file or replace one entirely. There is no patching: send the complete file. Read an existing file first and keep everything you are not changing.",
    input_schema: {
      type: "object",
      properties: { path: PATH, content: { type: "string", description: "The entire contents of the file." } },
      required: ["path", "content"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "delete_file",
    description: "Delete a file.",
    input_schema: { type: "object", properties: { path: PATH }, required: ["path"], additionalProperties: false },
    strict: true,
  },
];

export type ToolOutcome = { block: BetaToolResultBlockParam; path: string; ok: boolean; note: string };

/** Run one tool call. A failure goes back to the agent as an error result, so it can correct itself. */
export async function useTool(ws: Workspace, use: BetaToolUseBlock): Promise<ToolOutcome> {
  const input = (use.input ?? {}) as Record<string, unknown>;
  const path = String(input.path ?? "");
  try {
    let out: string;
    switch (use.name) {
      case "list_files": out = ws.list(path); break;
      case "read_file": out = await ws.read(path); break;
      case "write_file": out = ws.write(path, input.content); break;
      case "delete_file": out = ws.remove(path); break;
      default: throw new Error(`There is no tool called ${use.name}.`);
    }
    const note = use.name === "write_file" || use.name === "delete_file" ? out.split(" Staged")[0] : "";
    return { block: { type: "tool_result", tool_use_id: use.id, content: out }, path, ok: true, note };
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    return { block: { type: "tool_result", tool_use_id: use.id, content: msg, is_error: true }, path, ok: false, note: msg };
  }
}
