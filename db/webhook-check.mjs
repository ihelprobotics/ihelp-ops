#!/usr/bin/env node
// Webhook check — docs/09-acceptance.md, Test 5.
//
//   npm run test:webhook                      (against a local `npm run dev`)
//   WEBHOOK_URL=https://<domain>/api/webhooks/github npm run test:webhook
//
// What this proves, and what it deliberately does not.
//
// PROVES: that /api/webhooks/github, exactly as deployed, verifies signatures,
// stores every event under the TASK number, fills commit_event from a push,
// closes the agent_run behind a merged pull request, and that the progress
// ladder in app/lib/progress.ts climbs 10 -> 20 -> 40 -> 60 -> 75 -> 90 -> 100
// off those rows alone. Deliveries are real HTTP requests carrying real
// HMAC-SHA256 signatures, and every assertion is a read back out of Postgres.
//
// DOES NOT PROVE: that GitHub is configured to send anything. Nothing here can
// — that is a webhook in the repository's settings, and until a human adds it
// the only thing arriving at this route is this script. Test 5 is finished by
// pushing a real commit and watching a real task climb; this check is what
// makes that a five-minute confirmation instead of a debugging session.
//
// Everything is written under a repository name that exists nowhere:
// ihelp-webhook-check/<tag>. Real analytics are never touched, and the rows are
// deleted at the end — with the count asserted, because a check that quietly
// leaves fixtures behind poisons the numbers it was written to protect.

import { createHmac, randomUUID } from "node:crypto";

const { sql } = await import("../lib/db.ts");
const { stageOf, stageLabel, branchIsForTask } = await import("../app/lib/progress.ts");

const TARGET = process.env.WEBHOOK_URL || "http://localhost:3000/api/webhooks/github";
const SECRET = process.env.GH_WEBHOOK_SECRET;

// A green run against nothing must not read as "the webhook works".
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Refusing to run: every assertion here is a read out of Postgres, so without it this would pass having checked nothing.");
  process.exit(1);
}
if (!SECRET) {
  console.error("GH_WEBHOOK_SECRET is not set here, so no delivery can be signed and every one would be rejected for the wrong reason. Set the same value the repository webhook uses.");
  process.exit(1);
}

let bad = 0;
const is = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(62)} ${JSON.stringify(got)}${ok ? "" : `   expected ${JSON.stringify(want)}`}`);
};
const says = (label, text, mustContain) => {
  const ok = typeof text === "string" && text.toLowerCase().includes(mustContain.toLowerCase());
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(62)} ${JSON.stringify(String(text).slice(0, 80))}${ok ? "" : `   expected to mention "${mustContain}"`}`);
};

const tag = randomUUID().slice(0, 8);
const REPO = `ihelp-webhook-check/${tag}`;
const TASK = 41;                       // the issue — what everything must be filed under
const PR = 57;                         // the pull request — deliberately a different number
const BRANCH = `task/${TASK}/webhook-check`;

// A fixed clock. Date.now() would make cycle_time's hours drift between runs,
// and an assertion that cannot state its expected value is not an assertion.
const T = (h) => new Date(Date.UTC(2026, 7, 20, h, 0, 0)).toISOString();

/** Deliver as GitHub does: raw body, sha256 HMAC over those exact bytes. */
async function deliver(event, payload, opts = {}) {
  const raw = JSON.stringify(payload);
  const secret = opts.secret ?? SECRET;
  const sig =
    opts.signature !== undefined
      ? opts.signature
      : "sha256=" + createHmac("sha256", secret).update(opts.signedBody ?? raw).digest("hex");

  const headers = { "Content-Type": "application/json", "X-GitHub-Event": event, "X-GitHub-Delivery": randomUUID() };
  if (sig !== null) headers["X-Hub-Signature-256"] = sig;

  const res = await fetch(TARGET, { method: "POST", headers, body: raw });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { error: text.slice(0, 200) }; }
  return { status: res.status, body };
}

const repository = { full_name: REPO };

// ---------------------------------------------------------------------------
// Is anything listening?
// ---------------------------------------------------------------------------
try {
  const probe = await fetch(TARGET, { method: "POST", body: "{}" });
  if (probe.status === 404) {
    console.error(`\n${TARGET} answered 404 — a URL with no route behind it. Check the path, and that this is the deployment you meant.\n`);
    process.exit(1);
  }
} catch (e) {
  console.error(
    `\nNothing is listening at ${TARGET} (${e.cause?.code || e.message}).\n` +
    `Start the app with \`npm run dev\` in another terminal, or point this at the deployment:\n` +
    `  WEBHOOK_URL=https://<domain>/api/webhooks/github npm run test:webhook\n`
  );
  process.exit(1);
}

console.log(`\ndelivering to ${TARGET}`);
console.log(`under repository ${REPO} — a name that exists nowhere, so no real analytics are touched\n`);

/** The evidence the board assembles, read back out of the database. */
async function evidence(number, hasBranch) {
  const kinds = (await sql`select kind from gh_event where repo = ${REPO} and number = ${number} order by occurred_at`).map((r) => r.kind);
  const [{ n }] = await sql`select count(*)::int as n from commit_event where repo = ${REPO} and issue_number = ${number}`;
  return stageOf({ kinds, hasCommit: n > 0, hasBranch });
}

try {
  // -------------------------------------------------------------------------
  // A. Signature. Checked first: everything after it is meaningless if an
  //    unsigned delivery is accepted.
  // -------------------------------------------------------------------------
  console.log("— the signature —");
  const unsigned = await deliver("ping", { repository, zen: "x" }, { signature: null });
  is("an unsigned delivery is refused", unsigned.status, 401);
  says("and the refusal names the secret", unsigned.body.error, "secret");

  const wrongSecret = await deliver("ping", { repository, zen: "x" }, { secret: "not-the-secret" });
  is("a delivery signed with the wrong secret is refused", wrongSecret.status, 401);

  const tampered = await deliver("ping", { repository, zen: "x" }, { signedBody: JSON.stringify({ repository, zen: "y" }) });
  is("a body altered after signing is refused", tampered.status, 401);

  const short = await deliver("ping", { repository, zen: "x" }, { signature: "sha256=abc" });
  is("a truncated signature is refused, not compared", short.status, 401);

  const [{ n: leaked }] = await sql`select count(*)::int as n from gh_event where repo = ${REPO}`;
  is("and none of the four wrote a row", leaked, 0);

  // -------------------------------------------------------------------------
  // B. The ladder, one rung at a time — docs/09 Test 5.
  // -------------------------------------------------------------------------
  console.log("\n— the ladder: every rung observed, none assumed —");

  // 10 — issue opened
  is("issues/opened is accepted", (await deliver("issues", {
    action: "opened", repository,
    issue: { number: TASK, user: { login: "founder" }, created_at: T(9) },
  })).status, 200);
  is("issue created                         -> 10", await evidence(TASK, false), 10);

  // 20 — branch created. This rung has no event behind it and is not supposed
  // to: "Start task" creates a branch on GitHub, and the board reads the branch
  // list live. What is asserted here is the derivation the board depends on.
  is("the branch name resolves to this task", branchIsForTask(BRANCH, TASK), true);
  is("a branch for task 410 does not count for task 41", branchIsForTask(`task/${TASK}0/other`, TASK), false);
  is("start task (branch on GitHub)         -> 20", await evidence(TASK, true), 20);

  // 40 — a commit pushed from VS Code, carrying the trailer the hook writes
  is("push is accepted", (await deliver("push", {
    repository, ref: `refs/heads/${BRANCH}`,
    commits: [{
      id: `${tag}0000000000000000000000000000000aaaa`,
      message: `Raise the fall-detection threshold\n\niHelp-Task: #${TASK}`,
      author: { username: "intern-one", name: "Intern One" },
      timestamp: T(11),
    }],
  })).status, 200);
  const [commit] = await sql`select issue_number, branch, author from commit_event where repo = ${REPO}`;
  is("the commit is attributed by its trailer", commit?.issue_number, TASK);
  is("and carries the branch it landed on", commit?.branch, BRANCH);
  is("push a commit                         -> 40", await evidence(TASK, true), 40);

  // 60 — pull request opened. Its own number is 57, and that is the trap.
  is("pull_request/opened is accepted", (await deliver("pull_request", {
    action: "opened", repository,
    pull_request: {
      number: PR, html_url: `https://github.com/${REPO}/pull/${PR}`,
      user: { login: "intern-one" }, created_at: T(13), labels: [],
      head: { ref: BRANCH }, body: "What this changes.",
    },
  })).status, 200);
  is("open a pull request                   -> 60", await evidence(TASK, true), 60);

  // 75 — checks green. Absence of a failure is not evidence of a pass, so the
  // ladder needs the success conclusion itself.
  is("workflow_run is accepted", (await deliver("workflow_run", {
    repository,
    workflow_run: { conclusion: "success", head_branch: BRANCH, actor: { login: "github-actions" }, updated_at: T(14), pull_requests: [] },
  })).status, 200);
  is("checks pass                           -> 75", await evidence(TASK, true), 75);

  // 90 — a human approves
  is("pull_request_review is accepted", (await deliver("pull_request_review", {
    repository,
    review: { state: "approved", user: { login: "cto" }, submitted_at: T(15) },
    pull_request: { number: PR, head: { ref: BRANCH }, body: "" },
  })).status, 200);
  is("a human approves                      -> 90", await evidence(TASK, true), 90);

  // 100 — merged
  is("pull_request/closed+merged is accepted", (await deliver("pull_request", {
    action: "closed", repository,
    pull_request: {
      number: PR, merged: true, merged_at: T(16), html_url: `https://github.com/${REPO}/pull/${PR}`,
      merged_by: { login: "cto" }, user: { login: "intern-one" }, created_at: T(13),
      labels: [{ name: "agent-authored" }], head: { ref: BRANCH }, body: "",
    },
  })).status, 200);
  const done = await evidence(TASK, true);
  is("merge                                 -> 100", done, 100);
  is("and the label under the number reads back", stageLabel(done), "Merged");

  // -------------------------------------------------------------------------
  // C. The numbering rule. This is what Test 5 exists to catch.
  // -------------------------------------------------------------------------
  console.log("\n— every row filed under the task, never the pull request —");
  const rows = await sql`select kind, number from gh_event where repo = ${REPO} order by occurred_at`;
  is("five events on record", rows.map((r) => r.kind), ["issue_opened", "pr_opened", "workflow_success", "review_submitted", "pr_merged"]);
  is("every one carries the issue number", [...new Set(rows.map((r) => r.number))], [TASK]);
  is("and none carries the pull request's", rows.some((r) => r.number === PR), false);

  const [ct] = await sql`select hours, agent_authored from cycle_time where repo = ${REPO} and issue_number = ${TASK}`;
  is("cycle_time has the row /analytics reads (09:00 to 16:00)", Number(ct?.hours), 7);
  is("and knows the merge was agent-authored", ct?.agent_authored, true);

  const [rl] = await sql`select hours from review_latency where repo = ${REPO} and task_number = ${TASK}`;
  is("review_latency: opened 13:00, approved 15:00", Number(rl?.hours), 2);

  // -------------------------------------------------------------------------
  // D. Storage shape. The insert succeeds either way, which is what makes this
  //    worth asserting: a payload stored as a JSON *string* reads back null
  //    through every ->> in the codebase.
  // -------------------------------------------------------------------------
  console.log("\n— the payload is an object, not a string containing one —");
  const [shape] = await sql`
    select payload->>'action' as action, jsonb_typeof(payload) as type
      from gh_event where repo = ${REPO} and kind = 'issue_opened'`;
  is("jsonb_typeof(payload)", shape?.type, "object");
  is("payload->>'action' reads back", shape?.action, "opened");

  // -------------------------------------------------------------------------
  // E. Work with no task behind it is recorded as such, never guessed at.
  // -------------------------------------------------------------------------
  console.log("\n— unowned and loosely linked work —");
  await deliver("pull_request", {
    action: "opened", repository,
    pull_request: { number: 61, user: { login: "intern-two" }, created_at: T(17), labels: [], head: { ref: "feature/tidy-readme" }, body: "Closes #42\n\nTidy." },
  });
  const [byKeyword] = await sql`select number from gh_event where repo = ${REPO} and payload->'pull_request'->>'number' = '61'`;
  is("a PR off a non-task branch links by its closing keyword", byKeyword?.number, 42);

  await deliver("pull_request", {
    action: "opened", repository,
    pull_request: { number: 62, user: { login: "intern-two" }, created_at: T(18), labels: [], head: { ref: "feature/orphan" }, body: "No link at all." },
  });
  const [orphan] = await sql`select number from gh_event where repo = ${REPO} and payload->'pull_request'->>'number' = '62'`;
  is("a PR with neither is stored as a gap, not attached to a guess", orphan?.number, null);

  // -------------------------------------------------------------------------
  // F. A merge closes the agent run behind it — where cost stops being null.
  // -------------------------------------------------------------------------
  console.log("\n— the merge closes the agent run that produced it —");
  const [fixture] = await sql`
    insert into app_user (gh_login, name, role) values (${`wh-check-${tag}`}, 'Fixture Requester', 'member')
    returning id`;
  const [run] = await sql`
    insert into agent_run (requester_id, agent, repo, issue_number, status, cost_usd)
    values (${fixture.id}, 'scribe', ${REPO}, ${TASK}, 'running', 0.52) returning id`;

  await deliver("pull_request", {
    action: "closed", repository,
    pull_request: {
      number: 63, merged: true, merged_at: T(19), html_url: `https://github.com/${REPO}/pull/63`,
      merged_by: { login: "cto" }, user: { login: "scribe" }, created_at: T(18),
      labels: [{ name: "agent-authored" }], head: { ref: `agent/scribe/issue-${TASK}` },
      body: "Platform run: `" + run.id + "`\n\nCloses #" + TASK,
    },
  });
  const [closed] = await sql`select status, pr_url, finished_at from agent_run where id = ${run.id}`;
  is("the run reaches success", closed?.status, "success");
  is("with the pull request that carried it", closed?.pr_url, `https://github.com/${REPO}/pull/63`);
  is("and a finish time", !!closed?.finished_at, true);
  is("an agent branch resolves to the same task", branchIsForTask(`agent/scribe/issue-${TASK}`, TASK), true);

  // -------------------------------------------------------------------------
  // G. An event nobody handles is a 200 that writes nothing, not a 500.
  // -------------------------------------------------------------------------
  console.log("\n— an unhandled event —");
  const before = (await sql`select count(*)::int as n from gh_event where repo = ${REPO}`)[0].n;
  is("a starred event is accepted", (await deliver("star", { action: "created", repository })).status, 200);
  is("and writes nothing", (await sql`select count(*)::int as n from gh_event where repo = ${REPO}`)[0].n, before);

} finally {
  // -------------------------------------------------------------------------
  // Nothing is left behind. Asserted, not hoped for.
  // -------------------------------------------------------------------------
  console.log("\n— cleanup —");
  await sql`delete from agent_run    where repo = ${REPO}`;
  await sql`delete from app_user     where gh_login = ${`wh-check-${tag}`}`;
  await sql`delete from commit_event where repo = ${REPO}`;
  await sql`delete from gh_event     where repo = ${REPO}`;
  const [{ left }] = await sql`
    select (select count(*) from gh_event where repo = ${REPO})
         + (select count(*) from commit_event where repo = ${REPO})
         + (select count(*) from agent_run where repo = ${REPO}) as left`;
  is("nothing was left behind", Number(left), 0);
  await sql.end();
}

console.log(bad === 0
  ? "\nall passed — the route is correct. Connecting the repository webhook is what makes it fire.\n"
  : `\n${bad} FAILED\n`);
process.exit(bad === 0 ? 0 : 1);
