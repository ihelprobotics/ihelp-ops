#!/usr/bin/env node
// Assignment and multiple repositories.
//
//   npm run test:assign                    (against a local `npm run dev`)
//   PAGE_URL=https://<domain> npm run test:assign
//
// Three parts, in increasing cost:
//
//   A. The rules, as functions. No database, no network.
//   B. The repository list, and what it refuses.
//   C. A real round trip: the board across every configured repository, then an
//      assignment actually written to a GitHub issue and read back.
//
// Part C touches a real issue. It records who holds it first and puts that back
// at the end, whatever happened in between — a check that leaves somebody
// else's name on a task, or takes one off, is worse than no check.

import { randomUUID } from "node:crypto";
import { encode } from "@auth/core/jwt";

const { sql } = await import("../lib/db.ts");
const { canAssign, assignsOthers } = await import("../app/lib/assign.ts");
const { parseRepo, taskHref } = await import("../app/lib/repos.ts");

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
console.log("\n— who may put a name on a task —");
// =========================================================================
const member = { login: "dev-one", role: "member" };
const lead = { login: "the-lead", role: "lead" };
const shiva = { login: null, role: "lead" };        // a lead with no GitHub account
const unlinked = { login: null, role: "member" };

is("you can take work nobody has", canAssign(member, null, "dev-one"), null);
is("you can hand back what is yours", canAssign(member, "dev-one", null), null);
refuses("you cannot take what somebody else holds", canAssign(member, "dev-two", "dev-one"), "already has that task");
refuses("you cannot hand back what is not yours", canAssign(member, "dev-two", null), "not yours to hand back");
refuses("you cannot assign to a colleague", canAssign(member, null, "dev-two"), "Only a lead");
refuses("an unlinked account cannot take work", canAssign(unlinked, null, null), "Link your GitHub account");

is("a lead can assign to anyone", canAssign(lead, null, "dev-two"), null);
is("a lead can move work off somebody", canAssign(lead, "dev-one", "dev-two"), null);
is("a lead can clear it entirely", canAssign(lead, "dev-one", null), null);
is("a lead with no GitHub account can still assign", canAssign(shiva, null, "dev-two"), null);
is("because the platform assigns with its own token", assignsOthers(shiva), true);
is("and a member is not a lead", assignsOthers(member), false);

// =========================================================================
console.log("\n— the repository list —");
// =========================================================================
is("owner/name parses", parseRepo("ihelprobotics/ihelp-ops")?.full, "ihelprobotics/ihelp-ops");
is("a bare name does not", parseRepo("ihelp-ops"), null);
is("a URL does not", parseRepo("https://github.com/a/b"), null);
is("nor a third segment", parseRepo("a/b/c"), null);
is("a task's path carries both", taskHref("ihelprobotics/ihelp-ops", 42), "/task/ihelprobotics/ihelp-ops/42");

// =========================================================================
console.log("\n— the board, and a real assignment —");
// =========================================================================
let restore = null;
let fixtures = [];

try {
  const [founder] = await sql`
    select id, name, email, gh_login, role from app_user where gh_login is not null and role in ('founder','cto') limit 1`;
  if (!founder) throw new Error("No founder or CTO with a linked GitHub login, so no assignment can be made as one.");

  const [fixtureMember] = await sql`
    insert into app_user (gh_login, name, role, email)
    values (${`as-check-${tag}`}, 'Fixture Member', 'member', ${`as-${tag}@example.invalid`})
    returning id, name, email, gh_login, role`;
  fixtures.push(fixtureMember.id);

  const cookieFor = async (person, name) =>
    `${name}=${await encode({ token: { email: person.email, name: person.name, sub: person.id }, secret: SECRET, salt: name, maxAge: 900 })}`;

  let cookieName = null;
  for (const n of COOKIES) {
    const r = await fetch(BASE + "/api/tasks", { headers: { Cookie: await cookieFor(founder, n) } });
    if (r.ok) { cookieName = n; break; }
  }
  if (!cookieName) throw new Error("A session cookie signed with AUTH_SECRET was not accepted.");

  const asFounder = { Cookie: await cookieFor(founder, cookieName), "Content-Type": "application/json" };
  const asMember = { Cookie: await cookieFor(fixtureMember, cookieName), "Content-Type": "application/json" };

  // ---- the board spans every configured repository ----
  const board = await (await fetch(BASE + "/api/tasks", { headers: asFounder })).json();
  is("the board reports which repositories it read", Array.isArray(board.repos), true);
  is("and none of them failed", board.repos.filter((r) => r.error).map((r) => r.repo), []);
  is("every task says which repository it is in", board.tasks.every((t) => !!t.repo), true);
  is("and carries a link that includes it",
     board.tasks.every((t) => t.href === `/task/${t.repo}/${t.number}`), true);

  const task = board.tasks[0];
  if (!task) throw new Error("No open issues on the board, so there is nothing to assign.");
  const url = `${BASE}/api/tasks/${task.repo}/${task.number}`;

  // Remember who holds it, so it can be handed straight back.
  restore = { url, headers: asFounder, to: task.assignee };
  console.log(`     (using ${task.repo}#${task.number}, currently ${task.assignee ? "@" + task.assignee : "unassigned"})`);

  const post = (headers, body) => fetch(url, { method: "POST", headers, body: JSON.stringify(body) });

  // ---- a repository nobody configured ----
  const nowhere = await fetch(`${BASE}/api/tasks/someone/else/1`, { method: "POST", headers: asFounder, body: JSON.stringify({ action: "assign", to: null }) });
  is("a repository not in REPOS is refused", nowhere.status, 404);
  is("and says so by name", (await nowhere.json()).error.includes("someone/else"), true);

  // ---- what is not a username ----
  const junk = await post(asFounder, { action: "assign", to: "not a username!" });
  is("a display name is refused", junk.status, 400);

  // ---- the founder takes it ----
  const took = await post(asFounder, { action: "assign", to: founder.gh_login });
  is("a lead can assign", took.status, 200);
  const tookBody = await took.json();
  is("and GitHub reports exactly that one name", tookBody.assignee, founder.gh_login);

  // ---- a member cannot take what the founder now holds ----
  const stolen = await post(asMember, { action: "assign", to: `as-check-${tag}` });
  is("a member cannot take a task somebody holds", stolen.status, 403);
  is("with the holder named", (await stolen.json()).error.includes(founder.gh_login), true);

  // ---- nor assign it to anybody else ----
  const given = await post(asMember, { action: "assign", to: founder.gh_login });
  is("nor hand it to a colleague", given.status, 403);

  // ---- read it back off the board ----
  const after = await (await fetch(BASE + "/api/tasks", { headers: asFounder })).json();
  const seen = after.tasks.find((t) => t.repo === task.repo && t.number === task.number);
  is("the board shows the new owner", seen?.assignee, founder.gh_login);

  // ---- and cleared entirely ----
  const cleared = await post(asFounder, { action: "assign", to: null });
  is("a lead can clear it", cleared.status, 200);
  is("and nobody holds it", (await cleared.json()).assignee, null);
} finally {
  console.log("\n— putting it back —");
  if (restore) {
    const res = await fetch(restore.url, {
      method: "POST",
      headers: restore.headers,
      body: JSON.stringify({ action: "assign", to: restore.to }),
    });
    const out = await res.json().catch(() => ({}));
    is("the task is back with whoever had it", out.assignee ?? null, restore.to ?? null);
  }
  if (fixtures.length) await sql`delete from app_user where id = any(${fixtures})`;
  const [{ left }] = await sql`select count(*)::int as left from app_user where gh_login like 'as-check-%'`;
  is("no fixtures left behind", left, 0);
  await sql.end();
}

console.log(bad === 0 ? "\nall passed\n" : `\n${bad} FAILED\n`);
process.exit(bad === 0 ? 0 : 1);
