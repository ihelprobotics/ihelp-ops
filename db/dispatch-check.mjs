#!/usr/bin/env node
// Turning a conversation into a run.
//
//   npm run test:dispatch                    (against a local `npm run dev`)
//   PAGE_URL=https://<domain> npm run test:dispatch
//
// Two parts:
//
//   A. Who may dispatch whom, as a function. No database, no network.
//   B. What POST /api/agents/run does with a brief, signed in as three people.
//
// Part B never lets a dispatch reach GitHub. It asserts the refusals — which
// happen before the workflow call — and for the one case that would dispatch,
// it stops at the tier gate by using an agent the person cannot run. A check
// that fires real agent runs costs money and leaves branches behind.
//
// The brief is the thing under test because it is the one piece of this feature
// that crosses a privacy line: the conversation is private and the run is
// public, so what the platform sends must be exactly what the person confirmed
// and never the transcript.

import { randomUUID } from "node:crypto";
import { encode } from "@auth/core/jwt";

const { sql } = await import("../lib/db.ts");
const { canDispatch, BRIEF_LIMIT, TIERS, HUMAN_OWNER_ONLY } = await import("../app/lib/agents.ts");

const BASE = (process.env.PAGE_URL || "http://localhost:3000").replace(/\/$/, "");
const SECRET = process.env.AUTH_SECRET;

if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is not set."); process.exit(1); }
if (!SECRET) { console.error("AUTH_SECRET is not set, so no session can be signed."); process.exit(1); }

let bad = 0;
const is = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(58)} ${JSON.stringify(got)}${ok ? "" : `   expected ${JSON.stringify(want)}`}`);
};
const refuses = (label, refusal, mustMention) => {
  const ok = typeof refusal === "string" && refusal.toLowerCase().includes(mustMention.toLowerCase());
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(58)} ${JSON.stringify(typeof refusal === "string" ? refusal.slice(0, 62) : "allowed it")}${ok ? "" : `   expected "${mustMention}"`}`);
};

const tag = randomUUID().slice(0, 8);
const COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"];

// =========================================================================
console.log("\n— who may turn a conversation into a run —");
// =========================================================================
const newJoiner = { login: "dev-one", role: "member", tier: "week1" };
const midway    = { login: "dev-two", role: "member", tier: "week2" };
const senior    = { login: "dev-three", role: "member", tier: "full" };
const founder   = { login: "the-founder", role: "founder", tier: "week1" };

is("week1 may dispatch the scribe",        canDispatch("scribe", newJoiner).ok, true);
is("week1 may dispatch qa",                canDispatch("qa", newJoiner).ok, true);
is("week1 may not dispatch the frontend",  canDispatch("frontend", newJoiner).ok, false);
is("week2 may dispatch the frontend",      canDispatch("frontend", midway).ok, true);
is("week2 may not dispatch the architect", canDispatch("architect", midway).ok, false);
is("full may dispatch the architect",      canDispatch("architect", senior).ok, true);

// A founder on week1 still dispatches everything: the route reads role before
// tier, and the button must agree with it or it offers what the API refuses.
is("a founder outranks their own tier",    canDispatch("architect", founder).ok, true);

refuses("a locked agent says why",         canDispatch("architect", midway).why, "above your level");
refuses("and says what you can dispatch",  canDispatch("architect", midway).why, "Scribe");
refuses("signed out cannot dispatch",      canDispatch("scribe", null).why, "Sign in");

// The five draft agents are refused for everyone, including the founder. This
// is the rule in docs/06 that has no admin override.
for (const agent of HUMAN_OWNER_ONLY) {
  refuses(`${agent} is never dispatchable`, canDispatch(agent, founder).why, "human owner runs it");
}

// Talking is not gated. If this ever inverts, a new joiner loses the thing the
// chat exists for.
const { isChatAgent } = await import("../app/lib/agents.ts");
is("every dispatchable agent is chattable", TIERS.full.every(isChatAgent), true);
is("a draft agent can be talked to, though never dispatched", HUMAN_OWNER_ONLY.every(isChatAgent), true);

// =========================================================================
console.log("\n— what the route does with a brief —");
// =========================================================================

async function sessionFor(person) {
  const token = await encode({
    token: { email: person.email, uid: person.id, login: person.gh_login, role: person.role, tier: person.agent_tier },
    secret: SECRET,
    salt: COOKIES[0],
  });
  return `${COOKIES[0]}=${token}`;
}

async function dispatch(cookie, body) {
  const res = await fetch(`${BASE}/api/agents/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify(body),
  });
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("json")) return { status: res.status, error: `not json: ${type}` };
  return { status: res.status, ...(await res.json()) };
}

const REPO = process.env.OPS_REPO;
if (!REPO) { console.error("OPS_REPO is not set, so there is no repository to dispatch against."); process.exit(1); }

// One fixture person, on week1, so every agent above that tier refuses before
// anything reaches GitHub.
const email = `dispatch-check-${tag}@example.test`;
const [person] = await sql`
  insert into app_user (email, name, gh_login, role, agent_tier, active)
  values (${email}, 'Dispatch Check', ${`dispatch-${tag}`}, 'member', 'week1', true)
  returning id, email, gh_login, role, agent_tier
`;

try {
  const cookie = await sessionFor(person);

  // The refusals that happen before the workflow is ever called.
  const tooLong = await dispatch(cookie, {
    agent: "scribe", repo: REPO, issue: 1, brief: "x".repeat(BRIEF_LIMIT + 1),
  });
  is("an oversized brief is refused", tooLong.status, 400);
  refuses("and the refusal gives the limit", tooLong.error, String(BRIEF_LIMIT));
  refuses("and says it belongs on the issue", tooLong.error, "belongs on the issue");

  const wrongType = await dispatch(cookie, { agent: "scribe", repo: REPO, issue: 1, brief: { text: "no" } });
  is("a brief that is not a string is refused", wrongType.status, 400);
  refuses("and says what it should be", wrongType.error, "must be a string");

  // Exactly at the limit is allowed through validation — it fails later, at the
  // tier gate, which proves the length check is not what stopped it.
  const atLimit = await dispatch(cookie, {
    agent: "architect", repo: REPO, issue: 1, brief: "x".repeat(BRIEF_LIMIT),
  });
  is("a brief exactly at the limit passes validation", atLimit.status, 403);
  refuses("and is stopped by the tier instead", atLimit.error, "Not available at your level");

  // A draft agent is refused whatever the brief says.
  const draft = await dispatch(cookie, { agent: "deployer", repo: REPO, issue: 1, brief: "ship it" });
  is("a draft agent is refused", draft.status, 403);
  refuses("and says its owner runs it", draft.error, "human owner runs it");

  // The brief is optional. Omitting it must behave exactly as before this
  // feature existed — the board dispatches without one.
  const none = await dispatch(cookie, { agent: "architect", repo: REPO, issue: 1 });
  is("no brief at all is still a valid request", none.status, 403);
  refuses("and reaches the same tier gate", none.error, "Not available at your level");

  // Nothing above should have created a run: every one was refused before the
  // insert, or at a gate that precedes it.
  const [{ count }] = await sql`
    select count(*)::int from agent_run where requester_id = ${person.id}
  `;
  is("no agent_run row was written by a refused dispatch", count, 0);
} finally {
  // Ordered: agent_run first if anything did get written, then the person.
  await sql`delete from agent_run where requester_id = ${person.id}`;
  await sql`delete from app_user where id = ${person.id}`;
  const [{ count: left }] = await sql`select count(*)::int from app_user where email = ${email}`;
  is("the fixture person is gone", left, 0);
  await sql.end({ timeout: 5 });
}

console.log(bad === 0 ? "\nAll good.\n" : `\n${bad} failed.\n`);
process.exit(bad === 0 ? 0 : 1);
