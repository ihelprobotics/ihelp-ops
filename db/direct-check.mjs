#!/usr/bin/env node
// Running an agent through the Claude API — who may, and what is refused first.
//
//   npm run test:direct                     (against a local `npm run dev`)
//   PAGE_URL=https://<domain> npm run test:direct
//
// Every case here is refused before the route calls the model or writes to
// GitHub. A check that started real runs would spend money and leave branches
// and pull requests behind, so the one request that would otherwise run — a
// permitted agent on a real repository — is stopped at the two-run limit, with
// two fixture rows standing in for runs already going.
//
// POST /api/agents/direct is the first route in this platform that writes code,
// so the gates are the thing under test: a linked GitHub login, the tier, the
// draft agents, the configured repositories, the brief, and the WIP limit.

import { randomUUID } from "node:crypto";
import { encode } from "@auth/core/jwt";

const { sql } = await import("../lib/db.ts");
const { BRIEF_LIMIT } = await import("../app/lib/agents.ts");

const BASE = (process.env.PAGE_URL || "http://localhost:3000").replace(/\/$/, "");
const SECRET = process.env.AUTH_SECRET;
const REPO = process.env.OPS_REPO;

if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is not set."); process.exit(1); }
if (!SECRET) { console.error("AUTH_SECRET is not set, so no session can be signed."); process.exit(1); }
if (!REPO) { console.error("OPS_REPO is not set, so there is no repository to run against."); process.exit(1); }
const [OWNER, NAME] = REPO.split("/");

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

const COOKIE = "authjs.session-token";
const tag = randomUUID().slice(0, 8);

async function sessionFor(person) {
  const token = await encode({
    token: { email: person.email, uid: person.id, login: person.gh_login, role: person.role, tier: person.agent_tier },
    secret: SECRET,
    salt: COOKIE,
  });
  return `${COOKIE}=${token}`;
}

async function run(cookie, body) {
  const res = await fetch(`${BASE}/api/agents/direct`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
  const type = res.headers.get("content-type") ?? "";
  // A stream here would mean a run started, which no case in this file allows.
  if (type.includes("event-stream")) { await res.body?.cancel(); return { status: res.status, error: "a run started" }; }
  if (!type.includes("json")) return { status: res.status, error: `not json: ${type}` };
  return { status: res.status, ...(await res.json()) };
}

const [linked, unlinked] = await sql`
  insert into app_user (email, name, gh_login, role, agent_tier, active) values
    (${`direct-check-${tag}@example.test`}, 'Direct Check', ${`direct-${tag}`}, 'member', 'week1', true),
    (${`direct-check-nolink-${tag}@example.test`}, 'Direct Check Unlinked', null, 'member', 'week1', true)
  returning id, email, gh_login, role, agent_tier
`;

try {
  const base = { owner: OWNER, name: NAME, issue: 1 };
  const cookie = await sessionFor(linked);

  // =========================================================================
  console.log("\n— who may run an agent from the platform —");
  // =========================================================================
  const anon = await run(null, { ...base, agent: "scribe" });
  is("signed out never reaches the route", [301, 302, 303, 307, 308, 401].includes(anon.status), true);

  const noLink = await run(await sessionFor(unlinked), { ...base, agent: "scribe" });
  is("an account with no GitHub login is refused", noLink.status, 403);
  refuses("and is told to link one", noLink.error, "Link your GitHub account");

  const draft = await run(cookie, { ...base, agent: "deployer" });
  is("a draft agent is refused", draft.status, 403);
  refuses("and says its owner runs it", draft.error, "human owner runs it");

  const locked = await run(cookie, { ...base, agent: "architect" });
  is("week1 cannot run the architect", locked.status, 403);
  refuses("and the refusal says it is above their level", locked.error, "above your level");

  // =========================================================================
  console.log("\n— what is refused before anything runs —");
  // =========================================================================
  const unknown = await run(cookie, { ...base, agent: "ceo" });
  is("an agent nobody defined is refused", unknown.status, 400);
  refuses("by name", unknown.error, '"ceo"');

  const notNumber = await run(cookie, { ...base, issue: "one", agent: "scribe" });
  is("a task number that is not a number is refused", notNumber.status, 400);

  const elsewhere = await run(cookie, { owner: "someone-else", name: "not-ours", issue: 1, agent: "scribe" });
  is("a repository the board does not report on is refused", elsewhere.status, 404);
  refuses("and says so", elsewhere.error, "not one of the repositories");

  const wrongType = await run(cookie, { ...base, agent: "scribe", brief: { text: "no" } });
  is("a brief that is not a string is refused", wrongType.status, 400);
  refuses("and says what it should be", wrongType.error, "must be a string");

  const tooLong = await run(cookie, { ...base, agent: "scribe", brief: "x".repeat(BRIEF_LIMIT + 1) });
  is("an oversized brief is refused", tooLong.status, 400);
  refuses("and the refusal gives the limit", tooLong.error, String(BRIEF_LIMIT));

  // =========================================================================
  console.log("\n— the two-run limit —");
  // =========================================================================
  await sql`
    insert into agent_run (requester_id, agent, repo, issue_number, status) values
      (${linked.id}, 'scribe', ${REPO}, 1, 'running'),
      (${linked.id}, 'qa',     ${REPO}, 1, 'queued')`;

  const third = await run(cookie, { ...base, agent: "scribe", brief: "a permitted run, stopped by the limit" });
  is("a third concurrent run is refused", third.status, 429);
  refuses("and the limit is explained", third.error, "two agent runs");

  const [{ count }] = await sql`select count(*)::int from agent_run where requester_id = any(${[linked.id, unlinked.id]})`;
  is("no refused request wrote an agent_run row", count, 2);
} finally {
  await sql`delete from agent_run where requester_id = any(${[linked.id, unlinked.id]})`;
  await sql`delete from app_user where id = any(${[linked.id, unlinked.id]})`;
  const [{ count: left }] = await sql`select count(*)::int from app_user where email like ${`direct-check-%${tag}@example.test`}`;
  is("the fixture people are gone", left, 0);
  await sql.end({ timeout: 5 });
}

console.log(bad === 0 ? "\nAll good.\n" : `\n${bad} failed.\n`);
process.exit(bad === 0 ? 0 : 1);
