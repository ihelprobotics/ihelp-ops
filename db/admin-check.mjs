#!/usr/bin/env node
// Roles, and who may change them — docs/07.
//
//   npm run test:admin                     (against a local `npm run dev`)
//   PAGE_URL=https://<domain> npm run test:admin
//
// The rules as functions, then the real screen and route driven as three
// different people. Fixtures only: no real account's role is touched, and the
// check asserts it left none behind.

import { randomUUID } from "node:crypto";
import { encode } from "@auth/core/jwt";

const { sql } = await import("../lib/db.ts");
const { validatePersonPatch, isAdmin, ROLES, TIERS, PERMISSIONS } = await import("../app/lib/roles.ts");

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
const refuses = (label, refusal, mustMention) => {
  const ok = typeof refusal === "string" && refusal.toLowerCase().includes(mustMention.toLowerCase());
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(58)} ${JSON.stringify(typeof refusal === "string" ? refusal.slice(0, 60) : "allowed it")}${ok ? "" : `   expected "${mustMention}"`}`);
};

const tag = randomUUID().slice(0, 8);
const COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"];
let fixtures = [];

// =========================================================================
console.log("\n— the rules —");
// =========================================================================
const boss = { id: "A", role: "cto" };
const other = { id: "B", role: "member" };

is("the cto administers", isAdmin("cto"), true);
is("so does the founder", isAdmin("founder"), true);
is("a lead does not", isAdmin("lead"), false);
is("nor a member", isAdmin("member"), false);

is("an admin may promote somebody", validatePersonPatch(boss, other, { role: "lead" }, 2), null);
refuses("a member may not", validatePersonPatch(other, boss, { role: "member" }, 2), "needs the cto or founder");
refuses("nobody edits their own row", validatePersonPatch(boss, { id: "A", role: "cto" }, { role: "founder" }, 2), "cannot change your own row");
refuses("a role nobody defined is refused", validatePersonPatch(boss, other, { role: "admin" }, 2), "member, lead, cto, founder");
refuses("a tier nobody defined is refused", validatePersonPatch(boss, other, { agent_tier: "week9" }, 2), "week1, week2, full");
refuses("a GitHub URL is not a username", validatePersonPatch(boss, other, { gh_login: "https://github.com/x" }, 2), "not a GitHub username");
refuses("nor an @handle", validatePersonPatch(boss, other, { gh_login: "@someone" }, 2), "not a GitHub username");
refuses("a lead's email must be an email", validatePersonPatch(boss, other, { lead_email: "shiva" }, 2), "not an email address");

// The one that stops the platform locking everybody out.
refuses("the last admin cannot be demoted",
        validatePersonPatch(boss, { id: "C", role: "founder" }, { role: "member" }, 0), "leave nobody able to change roles");
refuses("nor deactivated",
        validatePersonPatch(boss, { id: "C", role: "founder" }, { active: false }, 0), "deactivate the last admin");
is("but demoting one of two is fine",
   validatePersonPatch(boss, { id: "C", role: "founder" }, { role: "member" }, 1), null);

is("every role has a column in the permission table",
   PERMISSIONS.every((p) => ROLES.every((r) => typeof p[r] === "string")), true);
is("and every row says where it is enforced",
   PERMISSIONS.every((p) => p.where && p.where.length > 8), true);

// =========================================================================
console.log("\n— the screen and the route —");
// =========================================================================
try {
  const rows = await sql`
    insert into app_user (gh_login, name, role, agent_tier, email) values
      (${`adm-${tag}-boss`},   'Fixture Boss',   'cto',    'full',  ${`adm-${tag}-boss@example.invalid`}),
      (${`adm-${tag}-member`}, 'Fixture Junior', 'member', 'week1', ${`adm-${tag}-member@example.invalid`})
    returning id, name, email, gh_login, role`;
  fixtures = rows.map((r) => r.id);
  const bossRow = rows.find((r) => r.gh_login.endsWith("boss"));
  const junior = rows.find((r) => r.gh_login.endsWith("member"));

  const cookieFor = async (p, n) =>
    `${n}=${await encode({ token: { email: p.email, name: p.name, sub: p.id }, secret: SECRET, salt: n, maxAge: 900 })}`;

  let cn = null;
  for (const n of COOKIES) {
    const r = await fetch(BASE + "/admin", { headers: { Cookie: await cookieFor(bossRow, n) }, redirect: "manual" });
    if (r.status === 200) { cn = n; break; }
  }
  if (!cn) throw new Error("A session cookie signed with AUTH_SECRET was not accepted.");

  const asBoss = { Cookie: await cookieFor(bossRow, cn), "Content-Type": "application/json" };
  const asJunior = { Cookie: await cookieFor(junior, cn), "Content-Type": "application/json" };

  const bossPage = await (await fetch(BASE + "/admin", { headers: asBoss })).text();
  is("an admin sees the accounts list", bossPage.includes("Fixture Junior"), true);
  is("and the permission table", bossPage.includes("What each role can do"), true);

  const juniorPage = await (await fetch(BASE + "/admin", { headers: asJunior })).text();
  is("a member is told why, not shown a blank page", juniorPage.includes("for the CTO and the founder"), true);
  // Their own name is in the header, so looking for it proves nothing. What
  // matters is whether somebody else's row is on the page.
  is("and cannot see anybody else's account", juniorPage.includes("Fixture Boss"), false);
  is("nor anybody's email address", juniorPage.includes(`adm-${tag}-boss@example.invalid`), false);
  is("but does see what the roles mean", juniorPage.includes("What each role can do"), true);

  const patch = (headers, id, body) =>
    fetch(`${BASE}/api/admin/people/${id}`, { method: "POST", headers, body: JSON.stringify(body) });

  is("a member cannot change anybody", (await patch(asJunior, bossRow.id, { role: "member" })).status, 403);

  const promoted = await patch(asBoss, junior.id, { role: "lead", agent_tier: "week2" });
  is("an admin can promote", promoted.status, 200);
  const after = await promoted.json();
  is("and the change is real", [after.person.role, after.person.agent_tier], ["lead", "week2"]);
  is("the message says what changed", after.message.includes("role → lead"), true);

  is("a bad GitHub login is refused", (await patch(asBoss, junior.id, { gh_login: "https://github.com/x" })).status, 403);
  is("editing your own row is refused", (await patch(asBoss, bossRow.id, { role: "founder" })).status, 403);
  is("an account that does not exist is a 404",
     (await patch(asBoss, "00000000-0000-0000-0000-000000000000", { role: "lead" })).status, 404);

  // Clearing a field, rather than setting it to the empty string.
  const cleared = await patch(asBoss, junior.id, { pod: "", lead_email: "" });
  is("blank means cleared, not empty", (await cleared.json()).person.pod, null);

  const [check] = await sql`select role, agent_tier from app_user where id = ${junior.id}`;
  is("the database agrees", [check.role, check.agent_tier], ["lead", "week2"]);
} finally {
  console.log("\n— cleanup —");
  if (fixtures.length) await sql`delete from app_user where id = any(${fixtures})`;
  const [{ left }] = await sql`select count(*)::int as left from app_user where gh_login like 'adm-%'`;
  is("no fixtures left behind", left, 0);
  await sql.end();
}

console.log(bad === 0 ? "\nall passed\n" : `\n${bad} FAILED\n`);
process.exit(bad === 0 ? 0 : 1);
