#!/usr/bin/env node
// Analytics check — docs/04 Phase 7, docs/03 for what the page has to report.
//
//   npm run test:analytics                 (against a local `npm run dev`)
//   PAGE_URL=https://<domain> npm run test:analytics
//
// Every figure on /analytics is derived from rows, so this seeds rows whose
// answers are known by hand and reads the numbers back off the rendered page.
// Asserting the SQL instead would prove the query returns what the query
// returns; the thing worth protecting is what a person actually sees.
//
// The fixtures have to live under the real OPS_REPO, because that is the only
// repository the page will report on — a synthetic repo name would be invisible
// to it. They use issue numbers in the 99xx range, which do not exist on
// GitHub, and every row is deleted at the end with the count asserted.

import { randomUUID } from "node:crypto";
import { encode } from "@auth/core/jwt";

const { sql } = await import("../lib/db.ts");

const BASE = (process.env.PAGE_URL || "http://localhost:3000").replace(/\/$/, "");
const SECRET = process.env.AUTH_SECRET;
const REPO = process.env.OPS_REPO;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Refusing to run: every number on this page is a read out of Postgres.");
  process.exit(1);
}
if (!SECRET) {
  console.error("AUTH_SECRET is not set, so no session cookie can be signed and the page would answer with the sign-in redirect.");
  process.exit(1);
}
if (!REPO) {
  console.error("OPS_REPO is not set, so there is no repository for the page to report on and nothing to seed against.");
  process.exit(1);
}

let bad = 0;
const is = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(58)} ${JSON.stringify(got)}${ok ? "" : `   expected ${JSON.stringify(want)}`}`);
};
const shows = (label, html, needle) => {
  const ok = typeof html === "string" && html.includes(needle);
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(58)} ${ok ? JSON.stringify(needle) : `could not find ${JSON.stringify(needle)}`}`);
};

const tag = randomUUID().slice(0, 8);
const A = 9001, B = 9002;                 // task numbers that exist nowhere
const AUTHOR = `fixture-${tag}`;
const COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"];

// A fixed clock, so every expected value can be stated rather than computed.
const T = (h) => new Date(Date.UTC(2026, 6, 10, h, 0, 0)).toISOString();

const prPayload = (n, login, agent) => ({
  action: "closed",
  pull_request: { number: n + 500, user: { login }, labels: agent ? [{ name: "agent-authored" }] : [] },
});

let fixtureUser = null;

try {
  const probe = await fetch(BASE + "/analytics", { redirect: "manual" }).catch((e) => {
    throw new Error(`Nothing is listening at ${BASE} (${e.cause?.code || e.message}). Start it with \`npm run dev\`, or set PAGE_URL.`);
  });
  is("an unauthenticated visitor is sent to sign in", probe.status >= 300 && probe.status < 400, true);

  const before = (await sql`select count(*)::int as n from gh_event where repo = ${REPO}`)[0].n;
  console.log(`\nseeding under ${REPO}, tasks #${A} and #${B} (${before} events already on record)\n`);

  // -------------------------------------------------------------------------
  // Task A: opened 09:00, PR 11:00, approved 12:00, merged 19:00.
  //   cycle 10h · review latency 1h · reworked (a commit lands after the merge)
  // Task B: opened 09:00, merged 05:00 next day. cycle 20h, never approved.
  // -------------------------------------------------------------------------
  const ev = (kind, number, actor, at, agent, payload) => sql`
    insert into gh_event (kind, repo, number, actor, agent_authored, occurred_at, payload)
    values (${kind}, ${REPO}, ${number}, ${actor}, ${agent}, ${at}, ${sql.json(payload ?? {})})`;

  await ev("issue_opened", A, "founder", T(9), false, {});
  await ev("pr_opened", A, AUTHOR, T(11), false, prPayload(A, AUTHOR, false));
  await ev("review_submitted", A, "cto", T(12), false, prPayload(A, AUTHOR, false));
  await ev("pr_merged", A, "cto", T(19), false, prPayload(A, AUTHOR, false));

  await ev("issue_opened", B, "founder", T(9), false, {});
  await ev("pr_opened", B, AUTHOR, T(20), true, prPayload(B, AUTHOR, true));
  await ev("pr_merged", B, "cto", T(29), true, prPayload(B, AUTHOR, true));

  // A commit after the merge — the definition of rework.
  await sql`insert into commit_event (repo, sha, author, branch, message, issue_number, committed_at)
            values (${REPO}, ${`analytics-${tag}`}, ${AUTHOR}, ${`task/${A}/fix`}, 'follow-up', ${A}, ${T(22)})`;

  const [u] = await sql`
    insert into app_user (gh_login, name, role) values (${`an-check-${tag}`}, 'Fixture Requester', 'member')
    returning id`;
  fixtureUser = u.id;
  // Tagged agent names. This repository already has real `scribe` runs against
  // it, and a fixture sharing the name would be summed into the same row — the
  // assertion would then be checking the total of real work plus fixture, which
  // changes every time somebody presses Run.
  const SCRIBE = `scribe-${tag}`, QA = `qa-${tag}`;
  await sql`
    insert into agent_run (requester_id, agent, repo, issue_number, status, cost_usd) values
      (${u.id}, ${SCRIBE}, ${REPO}, ${A}, 'success', 0.50),
      (${u.id}, ${QA},     ${REPO}, ${B}, 'failure', 0.25)`;

  // -------------------------------------------------------------------------
  // Read the page as a real signed-in person.
  // -------------------------------------------------------------------------
  const [viewer] = await sql`
    insert into app_user (gh_login, name, role, email) values
      (${`an-view-${tag}`}, 'Fixture Viewer', 'cto', ${`an-${tag}@example.invalid`})
    returning id, name, email`;

  let cookie = null;
  for (const name of COOKIES) {
    const token = await encode({ token: { email: viewer.email, name: viewer.name, sub: viewer.id }, secret: SECRET, salt: name, maxAge: 600 });
    const r = await fetch(BASE + "/analytics", { headers: { Cookie: `${name}=${token}` }, redirect: "manual" });
    if (r.status === 200) { cookie = `${name}=${token}`; break; }
  }
  if (!cookie) throw new Error("A session cookie signed with AUTH_SECRET was not accepted. Check AUTH_SECRET matches the running server.");

  const res = await fetch(BASE + "/analytics", { headers: { Cookie: cookie } });
  const html = await res.text();
  is("the page renders", res.status, 200);

  console.log("\n— flow —");
  // cycle times are 10h and 20h, so the median is 15 and the slowest is 20.
  shows("median cycle time", html, "15h");
  shows("slowest", html, "20h");
  shows("median review wait, from one approval an hour after opening", html, "1h");
  shows("and the pull request nobody approved is counted apart", html, "open, not yet approved");
  // One of the two merged tasks took further commits.
  shows("rework rate", html, "50%");

  console.log("\n— who shipped what —");
  shows("the author is credited, not the merger", html, `@${AUTHOR}`);
  shows("two merged, one of them agent-authored", html, "2 merged · 1 agent-authored (50%)");
  is("the merger is not listed as an author",
     html.includes(`@cto</span>`) && html.includes("2 merged"), false);

  console.log("\n— cost —");
  shows("the successful run's agent is listed", html, SCRIBE);
  shows("with what it cost", html, "$0.50");
  shows("the failed one too", html, QA);
  shows("a failed run is still money spent", html, "$0.25");
  shows("and the failure is named rather than hidden", html, "1 failed");
  shows("per person", html, "Fixture Requester");

  // Read the expected total back out of the database rather than writing it
  // down here: this repository has real agent runs against it, and hard-coding
  // the fixture's own sum would make the assertion fail the next time somebody
  // presses Run for real.
  const [{ total }] = await sql`
    select coalesce(sum(cost_usd), 0)::float as total from agent_run where repo = ${REPO}`;
  shows("the header total is the whole repository's spend", html, `$${Number(total).toFixed(2)}`);

  console.log("\n— the sections that need GitHub —");
  const live = html.includes("could not be worked out");
  is("claimed-versus-proven either rendered or explained itself",
     live || html.includes("have somebody&#x27;s name on them") || html.includes("open tasks"), true);
  is("stalled either rendered or explained itself",
     live || html.includes("Stalled"), true);

  console.log("\n— honesty of the empty state —");
  is("with events on record, the 'never delivered' notice is gone",
     html.includes("has never delivered"), false);

} finally {
  console.log("\n— cleanup —");
  await sql`delete from agent_run    where repo = ${REPO} and issue_number in (${A}, ${B})`;
  await sql`delete from commit_event where repo = ${REPO} and sha = ${`analytics-${tag}`}`;
  await sql`delete from gh_event     where repo = ${REPO} and number in (${A}, ${B})`;
  await sql`delete from app_user     where gh_login like ${`an-%${tag}`}`;
  const [{ left }] = await sql`
    select (select count(*) from gh_event where repo = ${REPO} and number in (${A}, ${B}))
         + (select count(*) from commit_event where sha = ${`analytics-${tag}`})
         + (select count(*) from app_user where gh_login like ${`an-%${tag}`}) as left`;
  is("nothing was left behind", Number(left), 0);
  await sql.end();
}

console.log(bad === 0 ? "\nall passed\n" : `\n${bad} FAILED\n`);
process.exit(bad === 0 ? 0 : 1);
