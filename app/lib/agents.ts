// The agent roster.
//
// One list, because it was three: the tiles on the board, the tier map the
// dispatch route enforces, and now the picker in the chat — which is a client
// component and so cannot import anything that reaches lib/db.ts. Nothing in
// this file touches the database or the network, which is what makes it safe
// on both sides of the wire.
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
 * Which agents each tier may dispatch. Derived from the roster rather than
 * written out again, so an agent cannot appear on the board and be missing
 * from the tier that is supposed to unlock it.
 */
export const TIERS: Record<Tier, string[]> = {
  week1: AGENTS.filter((a) => TIER_RANK[a.tier] <= 1).map((a) => a.id),
  week2: AGENTS.filter((a) => TIER_RANK[a.tier] <= 2).map((a) => a.id),
  full:  AGENTS.map((a) => a.id),
};

/**
 * Never dispatched from the platform. Their human owner runs them, because
 * their output leaves the company or changes production.
 */
export const HUMAN_OWNER_ONLY = ["deployer", "cloud", "social", "outreach", "leadgen"];

export const agentName = (id: string) => AGENTS.find((a) => a.id === id)?.name ?? id;

// ---------------------------------------------------------------------------
// Talking to them
// ---------------------------------------------------------------------------

/**
 * Which agents can be talked to.
 *
 * Every one of them, regardless of tier. The tiers gate *dispatch*, because a
 * dispatched agent changes code — a new joiner should not be able to send the
 * architect at the repository in week one. A conversation changes nothing, so
 * gating it would only stop somebody learning what the architect thinks.
 */
export const CHAT_AGENTS: string[] = AGENTS.map((a) => a.id);
export const isChatAgent = (s: string) => CHAT_AGENTS.includes(s);

/**
 * What an exchange cost, in dollars.
 *
 * Written down rather than left implicit, because a conversation that silently
 * spends money is the thing analytics exists to prevent. Rates are per million
 * tokens and are the published Claude Opus 5 prices; if the model changes,
 * these change with it.
 */
const RATE_IN = 5 / 1_000_000;
const RATE_OUT = 25 / 1_000_000;
export const costOf = (input: number, output: number) => input * RATE_IN + output * RATE_OUT;

export const CHAT_MODEL = process.env.CHAT_MODEL || "claude-opus-5";
