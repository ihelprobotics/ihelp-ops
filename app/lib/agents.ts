// The agent roster.
//
// One list, because it was three: the tiles, the tier map the run routes
// enforce, and the picker in the chat — which is a client component and so
// cannot import anything that reaches lib/db.ts. Nothing in this file touches
// the database or the network, which is what makes it safe on both sides of the
// wire.
//
// Three copies of a roster means a ninth agent gets added to two of them and
// the third quietly disagrees. This file is the one.

export type Tier = "week1" | "week2" | "full";

export const AGENTS = [
  { id: "scribe",       name: "Scribe",         blurb: "Docs, runbooks, handovers",         tier: "week1" },
  { id: "annotator",    name: "Data Annotator", blurb: "Pre-labels for human checking",     tier: "week1" },
  { id: "qa",           name: "QA",             blurb: "Tests, eval harnesses, reports",    tier: "week1" },
  { id: "frontend",     name: "Frontend",       blurb: "Dashboards and operator UI",        tier: "week2" },
  { id: "fullstack",    name: "Full-stack",     blurb: "APIs, models, business logic",      tier: "full"  },
  { id: "ai-developer", name: "AI Developer",   blurb: "Training, eval, model integration", tier: "full"  },
  { id: "integrator",   name: "Integrator",     blurb: "Wiring, contract tests",            tier: "full"  },
  { id: "architect",    name: "Architect",      blurb: "ADRs and design review",            tier: "full"  },
] as const satisfies readonly { id: string; name: string; blurb: string; tier: Tier }[];

export type AgentId = (typeof AGENTS)[number]["id"];

export const TIER_RANK: Record<Tier, number> = { week1: 1, week2: 2, full: 3 };

/**
 * Which agents each tier may run. Derived from the roster rather than written
 * out again, so an agent cannot appear on a tile and be missing from the tier
 * that is supposed to unlock it.
 */
export const TIERS: Record<Tier, string[]> = {
  week1: AGENTS.filter((a) => TIER_RANK[a.tier] <= 1).map((a) => a.id),
  week2: AGENTS.filter((a) => TIER_RANK[a.tier] <= 2).map((a) => a.id),
  full:  AGENTS.map((a) => a.id),
};

/**
 * The draft and advisory agents. Never run from the platform, by either path
 * and for anyone: their output leaves the company or changes production, so
 * their human owner runs them. They can be talked to on a task — a draft in a
 * private conversation leaves nothing behind and changes nothing.
 */
export const DRAFT_AGENTS = [
  { id: "deployer", name: "Deployer", blurb: "Deploy plans, rollback checks",   why: "Draft tier — the CTO triggers production" },
  { id: "cloud",    name: "Cloud",    blurb: "Infra, cost and backup advice",   why: "Advisory — proposes, never applies" },
  { id: "social",   name: "Social",   blurb: "Post drafts and a calendar",      why: "Draft tier — a human publishes" },
  { id: "outreach", name: "Outreach", blurb: "Sequences and proposal drafts",   why: "Draft tier — a human sends" },
  { id: "leadgen",  name: "Lead Gen", blurb: "Account research and briefs",     why: "Research only — never contacts anyone" },
] as const;

export const HUMAN_OWNER_ONLY: string[] = DRAFT_AGENTS.map((a) => a.id);

export const agentName = (id: string) =>
  [...AGENTS, ...DRAFT_AGENTS].find((a) => a.id === id)?.name ?? id;

// ---------------------------------------------------------------------------
// Talking to them
// ---------------------------------------------------------------------------

/**
 * Which agents can be talked to.
 *
 * Every one of them, regardless of tier, and the draft agents too. Tiers gate
 * *running*, because a run changes code — a new joiner should not be able to
 * send the architect at the repository in week one. A conversation changes
 * nothing, so gating it would only stop somebody learning what the architect
 * thinks, or getting the outreach agent's draft of an email they will send
 * themselves.
 */
export const CHAT_AGENTS: string[] = [...AGENTS, ...DRAFT_AGENTS].map((a) => a.id);
export const isChatAgent = (s: string) => CHAT_AGENTS.includes(s);

/**
 * How long a run's brief may be.
 *
 * Here rather than in a route because four things enforce it — the box on the
 * task page, both run routes, and `agent-run.yml`, which can be dispatched by
 * hand and so cannot trust the platform to have checked. A limit that disagrees
 * between them is a box that lets you type something the run then refuses.
 *
 * 2000 is a paragraph or two. The brief narrows the issue; anything needing
 * more than that is a change to the issue, which is public and is the record.
 */
export const BRIEF_LIMIT = 2000;

/**
 * Whether this person may run this agent — the rule `POST /api/agents/run` and
 * `POST /api/agents/direct` both enforce, in a form the task page can use to
 * decide whether to offer the button at all.
 *
 * Offering a button that the API will refuse teaches nothing. A tier that
 * cannot run an agent still sees why, the way a locked tile does.
 *
 * `why` is empty rather than absent when allowed: this project compiles with
 * `strict: false`, so a `{ok: true} | {ok: false, why}` union does not narrow
 * on `!result.ok` and every caller would need a cast to read the reason.
 */
export function canDispatch(
  agent: string,
  who: { role?: string | null; tier?: string | null } | null
): { ok: boolean; why: string } {
  if (!who) return { ok: false, why: "Sign in to dispatch an agent." };

  if (HUMAN_OWNER_ONLY.includes(agent)) {
    return {
      ok: false,
      why: `The ${agentName(agent)} agent is draft or advisory tier. You can talk to it here, but its human owner runs it directly — its output either leaves the company or changes production.`,
    };
  }

  const allowed = who.role === "cto" || who.role === "founder"
    ? TIERS.full
    : TIERS[(who.tier as Tier) ?? "week1"] ?? TIERS.week1;

  if (!allowed.includes(agent)) {
    return {
      ok: false,
      why: `You can talk to ${agentName(agent)}, but dispatching it is above your level for now. You can dispatch: ${allowed.map(agentName).join(", ")}.`,
    };
  }
  return { ok: true, why: "" };
}

/**
 * What an exchange or a run cost, in dollars.
 *
 * Written down rather than left implicit, because a conversation that silently
 * spends money is the thing analytics exists to prevent. Rates are per million
 * tokens and are the published Claude Opus 5 prices; a cache write costs 1.25×
 * input and a cache read 0.1×. If the model changes, these change with it.
 */
const RATE_IN = 5 / 1_000_000;
const RATE_OUT = 25 / 1_000_000;
const RATE_CACHE_WRITE = RATE_IN * 1.25;
const RATE_CACHE_READ = RATE_IN * 0.1;
export const costOf = (input: number, output: number, cacheWrite = 0, cacheRead = 0) =>
  input * RATE_IN + output * RATE_OUT + cacheWrite * RATE_CACHE_WRITE + cacheRead * RATE_CACHE_READ;

export const CHAT_MODEL = process.env.CHAT_MODEL || "claude-opus-5";

/** The model a run through the Claude API uses (Path D). */
export const RUN_MODEL = process.env.RUN_MODEL || "claude-opus-5";
