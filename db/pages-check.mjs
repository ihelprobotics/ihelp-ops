#!/usr/bin/env node
// Screens check — docs/04 Phase 6, and docs/03 for what each page has to show.
//
//   npm run test:pages                     (against a local `npm run dev`)
//   PAGE_URL=https://<domain> npm run test:pages
//
// db/people-check.mjs proves the rules and the policies. This proves the four
// screens built on them actually render, by signing in as three different
// people and reading what each one is served.
//
// It signs in the way the application does — a real Auth.js session cookie,
// encoded with AUTH_SECRET — rather than by mocking a session. A test that
// stubs the session tests everything except the part that decides who you are.
//
// The three fixtures are a CTO, a lead, and a member whose lead_email is the
// lead's. They are real rows for the length of the run and are deleted at the
// end, with the count asserted. Nothing else in the database is touched.

import { randomUUID } from "node:crypto";
import { encode } from "@auth/core/jwt";

const { sql } = await import("../lib/db.ts");

const BASE = (process.env.PAGE_URL || "http://localhost:3000").replace(/\/$/, "");
const SECRET = process.env.AUTH_SECRET;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Refusing to run: these pages are reads out of Postgres and would all render as errors.");
  process.exit(1);
}
if (!SECRET) {
  console.error("AUTH_SECRET is not set, so no session cookie can be signed and every page would answer with the sign-in redirect.");
  process.exit(1);
}

let bad = 0;
const is = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(62)} ${JSON.stringify(got)}${ok ? "" : `   expected ${JSON.stringify(want)}`}`);
};
const shows = (label, html, needle) => {
  const ok = typeof html === "string" && html.includes(needle);
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(62)} ${ok ? "yes" : `could not find ${JSON.stringify(needle)}`}`);
};
const hides = (label, html, needle) => {
  const ok = typeof html === "string" && !html.includes(needle);
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(62)} ${ok ? "yes" : `LEAKED ${JSON.stringify(needle)}`}`);
};

const tag = randomUUID().slice(0, 8);
const gh = (who) => `pg-check-${tag}-${who}`;
const mail = (who) => `pg-${tag}-${who}@example.invalid`;

// Built here rather than interpolated into the SQL below. Inside a tagged
// template a ${} is a bind parameter wherever it appears — including inside
// what looks like a quoted string — so 'PRIVATE-${tag}' sends a parameter the
// statement never references, and Postgres answers "could not determine data
// type of parameter $3" about a line that reads as an ordinary string.
const PRIVATE = "PRIVATE-" + tag + "-CONVERSATION";
const AGREED = "AGREED-" + tag + "-ACTION";
const FEEDBACK = "FEEDBACK-" + tag + "-BODY";
const LEADNOTE = "LEADNOTE-" + tag + "-CONVERSATION";
const iso = (d) => d.toISOString().slice(0, 10);
const TODAY = iso(new Date());
const SOON = iso(new Date(Date.now() + 3 * 864e5));
const LATER = iso(new Date(Date.now() + 40 * 864e5));

// Auth.js salts the JWE with the cookie name, and picks the secure name on
// https. Both are tried rather than assumed, because guessing wrong looks
// exactly like "the page is broken".
const COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"];

async function cookieFor(person, name) {
  const token = await encode({
    token: { email: person.email, name: person.name, sub: person.id },
    secret: SECRET,
    salt: name,
    maxAge: 600,
  });
  return `${name}=${token}`;
}

/** Fetch a page as this person, following redirects manually so a bounce to
 *  /login is visible rather than silently rendering the sign-in screen. */
async function as(person, path, init = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { ...(init.headers ?? {}), Cookie: person.cookie },
    redirect: "manual",
  });
  const text = res.status < 300 || res.status >= 400 ? await res.text() : "";
  return { status: res.status, text, location: res.headers.get("location") };
}

let people = [];

try {
  const probe = await fetch(BASE + "/team", { redirect: "manual" }).catch((e) => {
    throw new Error(`Nothing is listening at ${BASE} (${e.cause?.code || e.message}). Start it with \`npm run dev\`, or set PAGE_URL.`);
  });
  is("an unauthenticated visitor is sent to sign in, not served the page", probe.status >= 300 && probe.status < 400, true);

  // -------------------------------------------------------------------------
  // Fixtures
  // -------------------------------------------------------------------------
  const rows = await sql`
    insert into app_user (gh_login, name, role, agent_tier, email, lead_email, pod) values
      (${gh("cto")},    'Zed Fixture-CTO',    'cto',    'full',  ${mail("cto")},    null,             'platform'),
      (${gh("lead")},   'Yara Fixture-Lead',  'lead',   'full',  ${mail("lead")},   null,             'platform'),
      (${gh("member")}, 'Xan Fixture-Member', 'member', 'week1', ${mail("member")}, ${mail("lead")},  'platform')
    returning id, name, email, gh_login`;
  const by = Object.fromEntries(rows.map((r) => [r.gh_login.split("-").pop(), r]));
  const [cto, lead, member] = [by.cto, by.lead, by.member];
  people = rows.map((r) => r.id);

  await sql`insert into leave_balance (user_id, year, entitled, carried_over)
            values (${member.id}, ${new Date().getFullYear()}, 12, 2.5)`;

  // Something to read on the person page: a goal with evidence, a 1:1, and a
  // feedback note — all written by the CTO, about the member.
  const [goal] = await sql`
    insert into goal (subject_id, author_id, cycle, starts_on, due_on, statement)
    values (${member.id}, ${cto.id}, 'day30', current_date, current_date + 30, 'Ship the fall-detection eval harness')
    returning id`;
  await sql`insert into goal_evidence (goal_id, kind, url, label, landed)
            values (${goal.id}, 'pr', 'https://example.invalid/pull/1', 'the harness', true),
                   (${goal.id}, 'doc', 'https://example.invalid/notes', 'design note', false)`;
  // Two 1:1s about the same person, by different authors. One author is the
  // CTO, one is the lead — which is what makes the access log observable: a
  // read is logged when the reader is neither the author nor the subject, so
  // the CTO reading their own note logs nothing and reading the lead's does.
  await sql`insert into one_on_one (subject_id, author_id, held_on, notes, agreed_actions)
            values (${member.id}, ${cto.id},  current_date,     ${PRIVATE},  ${AGREED}),
                   (${member.id}, ${lead.id}, current_date - 7, ${LEADNOTE}, 'pair on the pooler')`;
  await sql`insert into feedback_note (subject_id, author_id, body)
            values (${member.id}, ${cto.id}, ${FEEDBACK})`;

  // Which cookie name this deployment reads.
  let cookieName = null;
  for (const name of COOKIES) {
    const probe2 = await fetch(BASE + "/team", { headers: { Cookie: await cookieFor(cto, name) }, redirect: "manual" });
    if (probe2.status === 200) { cookieName = name; break; }
  }
  if (!cookieName) {
    throw new Error(`A session cookie signed with AUTH_SECRET was not accepted under either ${COOKIES.join(" or ")}. Check that AUTH_SECRET here is the one the server is running with.`);
  }
  for (const p of [cto, lead, member]) p.cookie = await cookieFor(p, cookieName);

  console.log(`\nsigned in against ${BASE} using ${cookieName}\n`);

  // -------------------------------------------------------------------------
  // /team
  // -------------------------------------------------------------------------
  console.log("— /team —");
  const team = await as(lead, "/team");
  is("renders", team.status, 200);
  shows("everyone on the pod is listed", team.text, "Xan Fixture-Member");
  shows("with their GitHub login, the attribution key", team.text, `@${gh("member")}`);
  shows("their role", team.text, "week1");
  shows("and a link to their page", team.text, `/person/${member.id}`);
  shows("nobody is away yet", team.text, "Nobody is on approved leave today");

  // -------------------------------------------------------------------------
  // /leave — book, clash, refuse, approve
  // -------------------------------------------------------------------------
  console.log("\n— /leave —");
  const leave = await as(member, "/leave");
  is("renders", leave.status, 200);
  shows("the entitlement is read, not assumed", leave.text, "entitled");
  shows("carried over is shown", leave.text, "carried over");
  shows("and who decides it", leave.text, mail("lead"));
  shows("nothing booked yet", leave.text, "You have not booked any leave");

  const book = (person, body) =>
    as(person, "/api/leave", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  const bad1 = await book(member, { kind: "sabbatical", starts_on: TODAY, ends_on: TODAY });
  is("a kind nobody defined is refused", bad1.status, 400);
  shows("and the refusal names the four that exist", bad1.text, "planned, sick, unpaid, comp_off");

  const booked = await book(member, { kind: "planned", starts_on: TODAY, ends_on: SOON, reason: "fixture holiday" });
  is("a good request is accepted", booked.status, 200);
  const bookedId = JSON.parse(booked.text).id;
  shows("and says what it will cost and who has it", booked.text, mail("lead"));

  const clash = await book(member, { kind: "planned", starts_on: TODAY, ends_on: TODAY });
  is("an overlapping request is refused", clash.status, 409);
  shows("with the dates that already cover it", clash.text, TODAY);

  const decide = (person, id, body) =>
    as(person, `/api/leave/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  is("the requester cannot approve their own leave", (await decide(member, bookedId, { action: "approve" })).status, 403);
  const notMine = await decide(cto, bookedId, { action: "reject" });
  is("a rejection with no reason is refused", notMine.status, 400);

  const queue = await as(lead, "/leave");
  shows("the request is in their lead's queue", queue.text, "Xan Fixture-Member");
  shows("with the reason they gave", queue.text, "fixture holiday");

  const approved = await decide(lead, bookedId, { action: "approve" });
  is("their lead approves it", approved.status, 200);
  is("and it cannot be decided twice", (await decide(lead, bookedId, { action: "approve" })).status, 409);
  is("the view the digest reads now has them",
     (await sql`select 1 from on_leave_today where user_id = ${member.id}`).length, 1);
  shows("and /team shows them away", (await as(lead, "/team")).text, "on leave");

  const later = await book(member, { kind: "planned", starts_on: LATER, ends_on: LATER });
  const laterId = JSON.parse(later.text).id;
  is("a second, non-overlapping request is fine", later.status, 200);
  is("somebody else's lead cannot decide it", (await decide(member, laterId, { action: "approve" })).status, 403);
  is("but the person can withdraw their own", (await decide(member, laterId, { action: "cancel" })).status, 200);

  // -------------------------------------------------------------------------
  // /me and /person/[id] — the page the policies are for
  // -------------------------------------------------------------------------
  console.log("\n— /me and /person/[id] —");
  const me = await as(member, "/me");
  is("renders", me.status, 200);
  shows("the subject reads the goal set for them", me.text, "Ship the fall-detection eval harness");
  shows("with evidence counted, never scored", me.text, "1 of 2 linked");
  shows("the 1:1 written about them", me.text, PRIVATE);
  shows("what was agreed in it", me.text, AGREED);
  shows("and the feedback written about them", me.text, FEEDBACK);
  shows("their own access log", me.text, "Who has read notes about you");

  shows("both 1:1s, whoever wrote them", me.text, LEADNOTE);

  const colleague = await as(lead, `/person/${member.id}`);
  is("a colleague's page renders", colleague.status, 200);
  hides("the 1:1 they did not write is not on it", colleague.text, PRIVATE);
  hides("nor what was agreed in it", colleague.text, AGREED);
  hides("nor the feedback", colleague.text, FEEDBACK);
  hides("nor the goal they did not set", colleague.text, "Ship the fall-detection eval harness");
  shows("the one they wrote themselves is", colleague.text, LEADNOTE);
  shows("and the page says why the rest is not", colleague.text, "enforced by Postgres");
  hides("somebody else's access log is not theirs to read", colleague.text, "Who has read notes about you");

  is("nothing is logged when the reader wrote it",
     (await sql`select count(*)::int as n from note_access_log where subject_id = ${member.id}`)[0].n, 0);

  const asCto = await as(cto, `/person/${member.id}`);
  is("the CTO's view renders", asCto.status, 200);
  shows("the CTO reads their own note", asCto.text, PRIVATE);
  shows("and the one the lead wrote", asCto.text, LEADNOTE);
  const logged = await sql`
    select l.note_id from note_access_log l
     where l.subject_id = ${member.id} and l.reader_id = ${cto.id}`;
  is("exactly one read is logged — the note they did not write", logged.length, 1);
  is("and it is that note",
     (await sql`select author_id from one_on_one where id = ${logged[0]?.note_id}`)[0]?.author_id, lead.id);

  // Sliced from the heading down, because the CTO's name also appears further
  // up as the author of a note — a match anywhere on the page would pass
  // whether or not the log rendered at all.
  const meAgain = await as(member, "/me");
  const logSection = meAgain.text.slice(meAgain.text.indexOf("Who has read notes about you"));
  shows("and the subject can see who looked", logSection, "Zed Fixture-CTO");

  const missing = await as(cto, `/person/${randomUUID()}`);
  is("a person who does not exist is a 404, not an empty page", missing.status, 404);
  is("and a malformed id is too", (await as(cto, "/person/not-a-uuid")).status, 404);

} finally {
  console.log("\n— cleanup —");
  if (people.length) {
    await sql`delete from note_access_log where subject_id = any(${people}) or reader_id = any(${people})`;
    await sql`delete from goal_evidence where goal_id in (select id from goal where subject_id = any(${people}))`;
    await sql`delete from goal          where subject_id = any(${people}) or author_id = any(${people})`;
    await sql`delete from one_on_one    where subject_id = any(${people}) or author_id = any(${people})`;
    await sql`delete from feedback_note where subject_id = any(${people}) or author_id = any(${people})`;
    await sql`delete from leave_request where user_id = any(${people}) or decided_by = any(${people})`;
    await sql`delete from leave_balance where user_id = any(${people})`;
    await sql`delete from notification_log where user_id = any(${people})`;
    await sql`delete from app_user      where id = any(${people})`;
  }
  const [{ left }] = await sql`select count(*)::int as left from app_user where gh_login like 'pg-check-%'`;
  is("nothing was left behind", left, 0);
  await sql.end();
}

console.log(bad === 0 ? "\nall passed\n" : `\n${bad} FAILED\n`);
process.exit(bad === 0 ? 0 : 1);
