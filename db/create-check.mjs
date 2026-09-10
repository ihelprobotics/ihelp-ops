#!/usr/bin/env node
// Opening a task — /new and POST /api/tasks.
//
//   npm run test:create                    (against a local `npm run dev`)
//   PAGE_URL=https://<domain> npm run test:create
//
// This is the one screen that writes something a person typed into GitHub, so
// the checks that matter are the ones about what it refuses: a repository the
// board does not cover, an account with no GitHub login, an empty title.
//
// It does open one real issue, because a create endpoint that is only ever
// tested against its own validation is a create endpoint nobody has tested. The
// issue is titled as a fixture, closed immediately, and the check asserts it
// left nothing open behind it.

import { randomUUID } from "node:crypto";
import { encode } from "@auth/core/jwt";

const { sql } = await import("../lib/db.ts");
const { repos } = await import("../app/lib/repos.ts");

const BASE = (process.env.PAGE_URL || "http://localhost:3000").replace(/\/$/, "");
const SECRET = process.env.AUTH_SECRET;
const TOK = process.env.GH_DISPATCH_TOKEN;
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is not set."); process.exit(1); }
if (!SECRET) { console.error("AUTH_SECRET is not set."); process.exit(1); }
if (!TOK) { console.error("GH_DISPATCH_TOKEN is not set."); process.exit(1); }

let bad = 0;
const is = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(56)} ${JSON.stringify(got)}${ok ? "" : `   expected ${JSON.stringify(want)}`}`);
};
const says = (label, text, mustMention) => {
  const ok = typeof text === "string" && text.toLowerCase().includes(mustMention.toLowerCase());
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(56)} ${JSON.stringify(typeof text === "string" ? text.slice(0, 66) : text)}${ok ? "" : `   expected "${mustMention}"`}`);
};

const tag = randomUUID().slice(0, 8);
const COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"];
let fixtures = [];
let opened = null;

try {
  const rows = await sql`
    insert into app_user (gh_login, name, role, agent_tier, email) values
      (${`new-${tag}-eng`},  'Fixture Engineer', 'member', 'week1', ${`new-${tag}-eng@example.invalid`}),
      (null,                 'Fixture Unlinked', 'member', 'week1', ${`new-${tag}-unl@example.invalid`})
    returning id, name, email, gh_login`;
  fixtures = rows.map((r) => r.id);
  const eng = rows.find((r) => r.gh_login);
  const unlinked = rows.find((r) => !r.gh_login);

  const cookieFor = async (p, n) =>
    `${n}=${await encode({ token: { email: p.email, name: p.name, sub: p.id }, secret: SECRET, salt: n, maxAge: 900 })}`;

  let cn = null;
  for (const n of COOKIES) {
    const r = await fetch(BASE + "/me", { headers: { Cookie: await cookieFor(eng, n) }, redirect: "manual" });
    if (r.status === 200) { cn = n; break; }
  }
  if (!cn) throw new Error(`Neither session cookie was accepted by ${BASE}. Is it running, and is AUTH_SECRET the same one?`);

  const post = async (person, payload) =>
    fetch(BASE + "/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: await cookieFor(person, cn) },
      body: JSON.stringify(payload),
    });

  const list = await repos();
  const target = list.find((r) => r.full === (process.env.OPS_REPO || "").trim()) ?? list[0];
  if (!target) throw new Error("No repositories configured, so there is nothing to open a task in.");

  const good = { repo: target.full, title: `fixture ${tag} — safe to close`, body: "Opened by db/create-check.mjs." };

  // =========================================================================
  console.log("\n— the screen —");
  // =========================================================================
  const page = await fetch(BASE + "/new", { headers: { Cookie: await cookieFor(eng, cn) } });
  const html = await page.text();
  is("the page renders", page.status, 200);
  says("  and offers the repositories the board covers", html, target.name);
  says("  and says what happens next", html, "10%");
  says("  and is honest about who GitHub records as the author", html, "one GitHub token");

  // A person with no linked account is told why, on the page, before they
  // type anything into a form that would refuse them.
  const unlinkedPage = await fetch(BASE + "/new", { headers: { Cookie: await cookieFor(unlinked, cn) } });
  says("somebody with no GitHub login is told before they type", await unlinkedPage.text(), "Link your GitHub account");

  // =========================================================================
  console.log("\n— what it refuses —");
  // =========================================================================
  const anon = await fetch(BASE + "/api/tasks", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(good),
  });
  const anonBody = await anon.text();
  is("a stranger never reaches it", anonBody.includes('"number"'), false);

  for (const [label, person, payload, code, mention] of [
    ["no GitHub login is refused",      unlinked, good,                              403, "Link your GitHub account"],
    ["an empty title is refused",       eng,      { ...good, title: "   " },         400, "needs a title"],
    ["so is a title that is a document",eng,      { ...good, title: "x".repeat(257) },400, "too long"],
    ["a repo off the board is refused", eng,      { ...good, repo: `nobody/no-${tag}` }, 404, "not one this platform reports on"],
    ["and so is no repo at all",        eng,      { ...good, repo: "" },             404, "not one this platform reports on"],
  ]) {
    const r = await post(person, payload);
    const out = await r.json().catch(() => ({}));
    is(label, r.status, code);
    says(`  ${label} — and says what`, out.error, mention);
  }

  // =========================================================================
  console.log("\n— one real task —");
  // =========================================================================
  const made = await post(eng, { ...good, assignToMe: true });
  const out = await made.json();
  is("it is created", made.status, 201);
  is("  and comes back with a number", typeof out.number === "number" && out.number > 0, true);
  is("  and a link into this platform", out.href, `/task/${target.full}/${out.number}`);
  if (out.number) opened = out.number;

  // The fixture engineer's login is not a real GitHub account, so assignment
  // is expected to fail — and the point is that it is reported rather than
  // swallowed, and that the task exists anyway.
  is("  assignment to an account GitHub does not know is reported",
     typeof out.assignError === "string" && out.assignError.length > 0, true);
  is("  but the task was still opened", out.assigned, null);

  const gh = await (await fetch(`https://api.github.com/repos/${target.full}/issues/${out.number}`, {
    headers: { Authorization: `Bearer ${TOK}`, Accept: "application/vnd.github+json" },
  })).json();
  is("GitHub has it", gh.number, out.number);
  is("  with the title as typed, untouched", gh.title, good.title);
  says("  and the description as typed", gh.body, "Opened by db/create-check.mjs.");
  says("  with the requester named in the artifact itself", gh.body, "Fixture Engineer");
  says("  and how it got there", gh.body, "through iHelp Ops");

  // It is on the board straight away — the create invalidates the read cache,
  // and without that the task is missing from the screen you are sent to.
  const board = await (await fetch(BASE + "/api/tasks", { headers: { Cookie: await cookieFor(eng, cn) } })).json();
  const onBoard = board.tasks.find((t) => t.repo === target.full && t.number === out.number);
  is("it is on the board immediately, not in thirty seconds", !!onBoard, true);
  is("  at ten per cent — opened, nothing done yet", onBoard?.progress, 10);
  is("  with nobody's name on it", onBoard?.assignee, null);

  // =======================================================================
  console.log("\n— the buttons post somewhere that exists —");
  // =======================================================================
  //
  // Every suite here drives the API directly, with a path it builds itself.
  // None of them ever asked what path the *page* builds, so when the route
  // moved under [owner]/[name] for multiple repositories, the task page kept
  // posting to /api/tasks/<n>. That matches no route, Next answered with its
  // HTML 404 page, and the card read the HTML as a login page and said "Your
  // session has expired" — so Start task, Open pull request, Merge and Comment
  // were all dead, and every report of it pointed at sessions.
  //
  // A client component's props are in the server-rendered payload, so the
  // paths it will post to can be read off the page without a browser.
  const taskPage = await fetch(`${BASE}/task/${target.full}/${out.number}`, {
    headers: { Cookie: await cookieFor(eng, cn) },
  });
  is("the task page renders", taskPage.status, 200);
  const taskHtml = await taskPage.text();

  const paths = [...taskHtml.matchAll(/\/api\/tasks\/[A-Za-z0-9._\/-]+/g)].map((m) => m[0]);
  is("it hands the client at least one task API path", paths.length > 0, true);

  // owner/name/number — three segments after /api/tasks. A bare number is the
  // shape that was broken.
  const malformed = paths.filter((p) => !/^\/api\/tasks\/[^/]+\/[^/]+\/\d+$/.test(p));
  is("and every one of them names owner, repo and number", malformed, []);
  is("  including the one the action buttons use",
     paths.includes(`/api/tasks/${target.full}/${out.number}`), true);

} finally {
  console.log("\n— cleanup —");
  if (opened) {
    const list = await repos();
    const target = list.find((r) => r.full === (process.env.OPS_REPO || "").trim()) ?? list[0];
    const r = await fetch(`https://api.github.com/repos/${target.full}/issues/${opened}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${TOK}`, Accept: "application/vnd.github+json" },
      body: JSON.stringify({ state: "closed", state_reason: "not_planned" }),
    });
    const closed = await r.json();
    is("the fixture issue was closed", closed.state, "closed");
  }
  if (fixtures.length) {
    await sql`delete from app_user where id = any(${fixtures})`;
    const [{ n }] = await sql`select count(*)::int as n from app_user where email like ${`new-${tag}-%`}`;
    is("no fixture accounts left behind", n, 0);
  }
  await sql.end();
}

console.log(bad === 0 ? "\nAll checks passed.\n" : `\n${bad} FAILED.\n`);
process.exit(bad === 0 ? 0 : 1);
