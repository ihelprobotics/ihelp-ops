#!/usr/bin/env node
// Talking to an agent — the roster, the policies, and the route.
//
//   npm run test:chat                      (against a local `npm run dev`)
//   PAGE_URL=https://<domain> npm run test:chat
//
// Three things are worth proving and one is worth proving hardest. A
// conversation is the only place this platform stores what somebody typed, and
// the promise made in db/schema-chat.sql is that it is theirs alone — not their
// lead's, not the CTO's, not the founder's. That promise is a row-level
// security policy with exactly one clause, and a policy nobody tested is a
// comment. So this check signs in as a founder and tries to read an engineer's
// conversation, and fails loudly if it can.
//
// Fixtures only. Everything written here is deleted, and the check asserts it.

import { randomUUID } from "node:crypto";
import { encode } from "@auth/core/jwt";

const { sql, withUser } = await import("../lib/db.ts");
const { AGENTS, TIERS, TIER_RANK, HUMAN_OWNER_ONLY,
        CHAT_AGENTS, isChatAgent, costOf, CHAT_MODEL } = await import("../app/lib/agents.ts");

const BASE = (process.env.PAGE_URL || "http://localhost:3000").replace(/\/$/, "");
const SECRET = process.env.AUTH_SECRET;
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is not set."); process.exit(1); }
if (!SECRET) { console.error("AUTH_SECRET is not set."); process.exit(1); }

let bad = 0;
const is = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(58)} ${JSON.stringify(got)}${ok ? "" : `   expected ${JSON.stringify(want)}`}`);
};
const says = (label, text, mustMention) => {
  const ok = typeof text === "string" && text.toLowerCase().includes(mustMention.toLowerCase());
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(58)} ${JSON.stringify(typeof text === "string" ? text.slice(0, 70) : text)}${ok ? "" : `   expected "${mustMention}"`}`);
};
const refused = async (label, run, code) => {
  let got;
  try { await run(); got = "allowed it"; } catch (e) { got = e.code ?? e.message; }
  is(label, got, code);
};

const tag = randomUUID().slice(0, 8);
const COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"];
let fixtures = [];

// =========================================================================
console.log("\n— the roster —");
// =========================================================================
is("eight agents can be talked to", CHAT_AGENTS.length, 8);
is("the picker and the board are the same list", CHAT_AGENTS, AGENTS.map((a) => a.id));
is("no agent is listed twice", new Set(CHAT_AGENTS).size, CHAT_AGENTS.length);
is("an agent nobody defined is not one you can talk to", isChatAgent("ceo"), false);
is("nor is a draft-tier agent the platform never dispatches", isChatAgent("deployer"), false);
is("no roster agent is also human-owner-only",
   AGENTS.some((a) => HUMAN_OWNER_ONLY.includes(a.id)), false);

// Tiers gate dispatch, not conversation — so every tier is a prefix of the
// roster and the full tier is the whole of it.
is("week1 dispatches three", TIERS.week1.length, 3);
is("week2 dispatches four", TIERS.week2.length, 4);
is("full dispatches every agent", TIERS.full, AGENTS.map((a) => a.id));
is("each tier is exactly the agents at or below it",
   ["week1", "week2", "full"].every((t) =>
     JSON.stringify(TIERS[t]) === JSON.stringify(AGENTS.filter((a) => TIER_RANK[a.tier] <= TIER_RANK[t]).map((a) => a.id))),
   true);
is("but every agent can be talked to regardless of tier",
   CHAT_AGENTS.length > TIERS.week1.length, true);

// =========================================================================
console.log("\n— what it costs —");
// =========================================================================
is("nothing said costs nothing", costOf(0, 0), 0);
is("a million in is five dollars", costOf(1_000_000, 0), 5);
is("a million out is twenty-five", costOf(0, 1_000_000), 25);
is("a small exchange is fractions of a cent", Number(costOf(1200, 400).toFixed(4)), 0.016);
is("the model is named, not guessed", typeof CHAT_MODEL === "string" && CHAT_MODEL.length > 3, true);

// =========================================================================
console.log("\n— whose conversation it is —");
// =========================================================================
try {
  const rows = await sql`
    insert into app_user (gh_login, name, role, agent_tier, email) values
      (${`chat-${tag}-eng`},   'Fixture Engineer', 'member',  'week1', ${`chat-${tag}-eng@example.invalid`}),
      (${`chat-${tag}-boss`},  'Fixture Founder',  'founder', 'full',  ${`chat-${tag}-boss@example.invalid`})
    returning id, name, email, gh_login, role`;
  fixtures = rows.map((r) => r.id);
  const eng  = rows.find((r) => r.gh_login.endsWith("eng"));
  const boss = rows.find((r) => r.gh_login.endsWith("boss"));

  // The engineer starts a conversation and says something private in it.
  const threadId = await withUser(eng.id, "member", async (tx) => {
    const [t] = await tx`insert into chat_thread (user_id, repo, issue_number, agent)
                         values (${eng.id}, ${`fixture/${tag}`}, 1, 'qa') returning id`;
    await tx`insert into chat_message (thread_id, role, content) values (${t.id}, 'user', 'I do not understand this codebase at all.')`;
    await tx`insert into chat_message (thread_id, role, content, input_tokens, output_tokens, cost_usd)
             values (${t.id}, 'assistant', 'Start with lib/db.ts.', 1200, 400, ${costOf(1200, 400)})`;
    return t.id;
  });

  const mine = await withUser(eng.id, "member", (tx) =>
    tx`select role, content from chat_message where thread_id = ${threadId} order by id`);
  is("the author reads their own conversation", mine.length, 2);
  says("including what they typed", mine[0].content, "do not understand");

  const asFounder = await withUser(boss.id, "founder", (tx) =>
    tx`select id from chat_thread where id = ${threadId}`);
  is("the founder cannot see that a conversation exists", asFounder.length, 0);

  const founderMsgs = await withUser(boss.id, "founder", (tx) =>
    tx`select id from chat_message where thread_id = ${threadId}`);
  is("nor read a word of it", founderMsgs.length, 0);

  // A founder who guesses the thread id cannot write into it either — the
  // insert policy is the same one clause.
  await refused("nor add to somebody else's conversation",
    () => withUser(boss.id, "founder", (tx) =>
      tx`insert into chat_message (thread_id, role, content) values (${threadId}, 'user', 'planted')`),
    "42501");

  await refused("nor open a conversation in their name",
    () => withUser(boss.id, "founder", (tx) =>
      tx`insert into chat_thread (user_id, repo, issue_number, agent) values (${eng.id}, ${`fixture/${tag}`}, 2, 'qa')`),
    "42501");

  // No UPDATE policy on either table: a transcript that can be edited after
  // the fact is one nobody can rely on, including the person who wrote it.
  const edited = await withUser(eng.id, "member", (tx) =>
    tx`update chat_message set content = 'never said that' where thread_id = ${threadId} returning id`);
  is("not even the author can rewrite what was said", edited.length, 0);

  // One conversation per person, per agent, per task.
  await refused("the same task and agent cannot start a second thread",
    () => withUser(eng.id, "member", (tx) =>
      tx`insert into chat_thread (user_id, repo, issue_number, agent) values (${eng.id}, ${`fixture/${tag}`}, 1, 'qa')`),
    "23505");

  const second = await withUser(eng.id, "member", (tx) =>
    tx`insert into chat_thread (user_id, repo, issue_number, agent)
       values (${eng.id}, ${`fixture/${tag}`}, 1, 'architect') returning id`);
  is("but a different agent on the same task does", second.length, 1);

  // A scratchpad you cannot clear is not a scratchpad.
  const gone = await withUser(eng.id, "member", (tx) =>
    tx`delete from chat_thread where id = ${threadId} returning id`);
  is("the author may delete their own conversation", gone.length, 1);
  const orphans = await sql`select count(*)::int as n from chat_message where thread_id = ${threadId}`;
  is("and the messages go with it", orphans[0].n, 0);

  // =======================================================================
  console.log("\n— the route —");
  // =======================================================================
  const cookieFor = async (p, n) =>
    `${n}=${await encode({ token: { email: p.email, name: p.name, sub: p.id }, secret: SECRET, salt: n, maxAge: 900 })}`;

  let cn = null;
  for (const n of COOKIES) {
    const r = await fetch(BASE + "/me", { headers: { Cookie: await cookieFor(eng, n) }, redirect: "manual" });
    if (r.status === 200) { cn = n; break; }
  }
  if (!cn) throw new Error(`Neither session cookie was accepted by ${BASE}. Is it running, and is AUTH_SECRET the same one?`);
  const cookie = await cookieFor(eng, cn);

  const post = async (body, hdrs = { Cookie: cookie }) =>
    fetch(BASE + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...hdrs },
      body: JSON.stringify(body),
    });

  const ok = { owner: "x", name: "y", issue: 1, agent: "qa", message: "hello" };

  // The middleware turns a signed-out request away before the route runs, so
  // what comes back is the sign-in screen and not the chat. The route keeps its
  // own 401 anyway — a guard that only exists in the middleware is one edit to
  // the matcher away from not existing.
  const anon = await post(ok, {});
  const anonBody = await anon.text();
  is("a stranger never reaches the chat", anonBody.includes("event: text"), false);
  says("and lands on the sign-in screen instead", anonBody, "Continue with Google");

  for (const [label, body, code, mention] of [
    ["an agent nobody defined is refused",  { ...ok, agent: "ceo" },        400, "is not an agent"],
    ["a draft-tier agent too",              { ...ok, agent: "deployer" },   400, "is not an agent"],
    ["a task number that is not a number",  { ...ok, issue: "soon" },       400, "not a task number"],
    ["an empty message is refused",         { ...ok, message: "   " },      400, "says nothing"],
    ["and so is a specification",           { ...ok, message: "x".repeat(8001) }, 400, "too long"],
  ]) {
    const r = await post(body);
    const out = await r.json().catch(() => ({}));
    is(label, r.status, code);
    says(`  ${label} — and says what`, out.error, mention);
  }

  const nope = await post({ ...ok, owner: "nobody", name: `no-such-${tag}` });
  is("a repository this platform does not report on", nope.status, 404);
  says("  is named, not guessed at", (await nope.json()).error, "not one this platform reports on");

  // A sound request against a real repository. Both answers are a pass — what
  // must never happen is a bare 500 that sends somebody to the network tab.
  const [live] = await sql`select repo, number from gh_event where number is not null order by occurred_at desc limit 1`;
  if (!live?.repo) {
    console.log("\n  No repository has been seen by the webhook yet, so the last leg —");
    console.log("  a real request reaching the model — was not exercised.");
  } else {
    const [o, nm] = live.repo.split("/");
    const r = await post({ owner: o, name: nm, issue: live.number, agent: "qa", message: "In one sentence: can you edit files from this conversation?" });
    const ct = r.headers.get("content-type") || "";
    if (r.status === 500) {
      says("without the key, a sound request names the key", (await r.json()).error, "ANTHROPIC_API_KEY");
      console.log("\n  ANTHROPIC_API_KEY is not set where the server is running, so the");
      console.log("  model was not called. Put it in .env.local and in Vercel, restart,");
      console.log("  and run this check again to exercise the last leg.");
    } else {
      is("a sound request opens a stream", ct.includes("text/event-stream"), true);
      const body = await r.text();
      is("  which carries text back", body.includes("event: text"), true);
      is("  and closes by saying what it cost", body.includes("event: done"), true);
      const done = /event: done\ndata: (.+)/.exec(body);
      const cost = done ? JSON.parse(done[1]).cost : null;
      is("  a real number of dollars", typeof cost === "number" && cost > 0, true);
      console.log(`\n  One real turn against ${live.repo}#${live.number} cost $${cost}.`);
      // The turn is recorded, and it belongs to the person who had it.
      const kept = await withUser(eng.id, "member", (tx) =>
        tx`select m.role from chat_message m join chat_thread t on t.id = m.thread_id
            where t.user_id = ${eng.id} and t.repo = ${live.repo} order by m.id`);
      is("  both sides of it are kept", kept.map((k) => k.role), ["user", "assistant"]);
      await withUser(eng.id, "member", (tx) =>
        tx`delete from chat_thread where user_id = ${eng.id}`);
    }
  }

} finally {
  if (fixtures.length) {
    await sql`delete from app_user where id = any(${fixtures})`;
    const left = await sql`select count(*)::int as n from chat_thread where repo = ${`fixture/${tag}`}`;
    is("the check left nothing behind", left[0].n, 0);
  }
  await sql.end();
}

console.log(bad === 0 ? "\nAll checks passed.\n" : `\n${bad} FAILED.\n`);
process.exit(bad === 0 ? 0 : 1);
