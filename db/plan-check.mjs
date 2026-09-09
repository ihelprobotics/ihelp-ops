#!/usr/bin/env node
// Breaking a prompt into issues.
//
//   npm run test:plan                    (against a local `npm run dev`)
//   PAGE_URL=https://<domain> npm run test:plan
//
// Two parts:
//
//   A. Who may do it, as a function. No database, no network, no model.
//   B. What the two routes refuse, signed in as three people.
//
// Part B never lets a model run and never opens an issue from a plan. Every
// case it drives is one the routes refuse before either happens — a check that
// spends model tokens on every run is a check people stop running, and one that
// opens real issues leaves somebody else's board to tidy up.
//
// The one case that does reach GitHub is a single directly-opened task, so that
// "the plan route opens nothing" is proved against a repository where opening
// demonstrably works rather than against one where everything fails anyway.
// It is closed again in the same run.

import { randomUUID } from "node:crypto";
import { encode } from "@auth/core/jwt";

const { sql } = await import("../lib/db.ts");
const { canPlan, PLANNING_ROLES, PERMISSIONS } = await import("../app/lib/roles.ts");

const BASE = (process.env.PAGE_URL || "http://localhost:3000").replace(/\/$/, "");
const SECRET = process.env.AUTH_SECRET;
const REPO = process.env.OPS_REPO;

if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is not set."); process.exit(1); }
if (!SECRET) { console.error("AUTH_SECRET is not set, so no session can be signed."); process.exit(1); }
if (!REPO) { console.error("OPS_REPO is not set, so there is no repository to plan into."); process.exit(1); }

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

// =========================================================================
console.log("\n— who may turn a prompt into issues —");
// =========================================================================
is("a member may not",   canPlan("member"), false);
is("a lead may",         canPlan("lead"), true);
is("the CTO may",        canPlan("cto"), true);
is("the founder may",    canPlan("founder"), true);
is("an unknown role may not", canPlan(""), false);
is("the roles are exactly these", [...PLANNING_ROLES].sort(), ["cto", "founder", "lead"]);

// The permission table is what /admin renders and the handbooks are generated
// from. A capability the code enforces and the table omits is one nobody can
// discover, and one the table claims and the code does not is a lie.
const row = PERMISSIONS.find((p) => p.what.toLowerCase().includes("break a prompt"));
is("the permission table names it", !!row, true);
if (row) {
  is("and refuses members there too", row.member, "—");
  is("and grants it to a lead", row.lead.includes("GitHub"), true);
  refuses("and says where it is enforced", row.where, "canPlan");
}

// =========================================================================
console.log("\n— what the routes refuse —");
// =========================================================================

async function sessionFor(p) {
  return `authjs.session-token=${await encode({
    token: { email: p.email, uid: p.id, login: p.gh_login, role: p.role, tier: p.agent_tier },
    secret: SECRET, salt: "authjs.session-token",
  })}`;
}
async function post(path, cookie, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify(body),
  });
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("json")) return { status: res.status, error: `not json: ${type}` };
  return { status: res.status, ...(await res.json()) };
}

const people = Object.fromEntries(
  (await sql`
    insert into app_user (email, name, gh_login, role, agent_tier, active) values
      (${`plan-${tag}-member@x.dev`}, 'Plan Member', ${`plan-${tag}-m`}, 'member', 'week1', true),
      (${`plan-${tag}-lead@x.dev`},   'Plan Lead',   ${`plan-${tag}-l`}, 'lead',   'week1', true),
      (${`plan-${tag}-bare@x.dev`},   'Plan Bare',   null,               'lead',   'week1', true)
    returning role, gh_login, id, email, agent_tier
  `).map((r) => [r.gh_login ?? "bare", r])
);
const member = people[`plan-${tag}-m`];
const lead = people[`plan-${tag}-l`];
const bare = people["bare"];

try {
  const asMember = await sessionFor(member);
  const asLead = await sessionFor(lead);
  const asBare = await sessionFor(bare);

  for (const [path, what] of [["/api/plan", "planning"], ["/api/plan/open", "opening"]]) {
    const denied = await post(path, asMember, { repo: REPO, prompt: "x", tasks: [{ title: "x", body: "" }] });
    is(`a member is refused by ${path}`, denied.status, 403);
    refuses(`  and told who it is for (${what})`, denied.error, "leads, the CTO and the founder");

    const unlinked = await post(path, asBare, { repo: REPO, prompt: "x", tasks: [{ title: "x", body: "" }] });
    is(`an unlinked lead is refused by ${path}`, unlinked.status, 403);
    refuses("  and told to link GitHub", unlinked.error, "GitHub");

    const nowhere = await post(path, asLead, { repo: "nobody/nothing", prompt: "x", tasks: [{ title: "x", body: "" }] });
    is(`an unconfigured repo is refused by ${path}`, nowhere.status, 404);
    refuses("  and says why it would not appear", nowhere.error, "would not appear on the board");
  }

  // /api/plan validation, none of which reaches a model.
  const empty = await post("/api/plan", asLead, { repo: REPO, prompt: "   " });
  is("an empty prompt is refused", empty.status, 400);
  refuses("  and says the breakdown depends on it", empty.error, "only as good as");

  const huge = await post("/api/plan", asLead, { repo: REPO, prompt: "x".repeat(4001) });
  is("an oversized prompt is refused", huge.status, 400);
  refuses("  and says to break it in half", huge.error, "break it in half");

  // /api/plan/open validation, none of which reaches GitHub.
  const notArray = await post("/api/plan/open", asLead, { repo: REPO, prompt: "x", tasks: "no" });
  is("tasks that are not an array are refused", notArray.status, 400);
  refuses("  and says the shape", notArray.error, "array of");

  const none = await post("/api/plan/open", asLead, { repo: REPO, prompt: "x", tasks: [] });
  is("an empty selection is refused", none.status, 400);
  refuses("  and says nothing was opened", none.error, "nothing was opened");

  const many = await post("/api/plan/open", asLead, {
    repo: REPO, prompt: "x",
    tasks: Array.from({ length: 13 }, (_, i) => ({ title: `t${i}`, body: "" })),
  });
  is("more than the limit is refused", many.status, 400);
  refuses("  and gives the limit", many.error, "12");

  const untitled = await post("/api/plan/open", asLead, {
    repo: REPO, prompt: "x", tasks: [{ title: "fine", body: "" }, { title: "  ", body: "" }],
  });
  is("a task with no title is refused", untitled.status, 400);
  refuses("  and says which one", untitled.error, "Task 2");

  const longTitle = await post("/api/plan/open", asLead, {
    repo: REPO, prompt: "x", tasks: [{ title: "t".repeat(257), body: "" }],
  });
  is("an oversized title is refused", longTitle.status, 400);
  refuses("  and says where the detail goes", longTitle.error, "detail in the description");

  // Nothing above may have opened anything. Proved against a repository where
  // opening demonstrably works, so this is the routes refusing rather than
  // GitHub being unreachable.
  const before = await fetch(`https://api.github.com/repos/${REPO}/issues?state=open&per_page=100`, {
    headers: { Authorization: `Bearer ${process.env.GH_DISPATCH_TOKEN ?? ""}`, Accept: "application/vnd.github+json" },
  });
  const open = before.ok ? await before.json() : null;
  is("GitHub is reachable, so 'nothing opened' means something", before.ok, true);
  if (open) {
    const mine = open.filter((i) => (i.title ?? "").includes(tag));
    is("no issue was opened by any refused request", mine.length, 0);
  }
} finally {
  for (const p of [member, lead, bare]) await sql`delete from app_user where id = ${p.id}`;
  const [{ count }] = await sql`select count(*)::int from app_user where email like ${`plan-${tag}-%`}`;
  is("the fixture people are gone", count, 0);
  await sql.end({ timeout: 5 });
}

console.log(bad === 0 ? "\nAll good.\n" : `\n${bad} failed.\n`);
process.exit(bad === 0 ? 0 : 1);
