#!/usr/bin/env node
// Builds one handbook per role.
//
//   node ops/handbooks/build.mjs
//
// Four documents, one source. Written this way because the alternative — four
// hand-maintained files — drifts within a month, and the first symptom is a new
// joiner reading something that stopped being true before they arrived.
//
// The access table is not written here at all. It is generated from
// app/lib/roles.ts, which is the same file /admin renders and the same one the
// checks import. So a permission cannot change in the code without changing in
// every handbook, and cannot be described in a handbook without being real.
//
// What IS written here is the part no code knows: what a person in this role
// actually does on a Tuesday.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

// pathToFileURL, not the bare path. On Windows an absolute path starts with a
// drive letter, and Node's ESM loader reads "G:" as a URL scheme it does not
// support — so importing by path works everywhere except the machine this is
// actually run on.
const { PERMISSIONS, ROLES } = await import(
  pathToFileURL(join(ROOT, "app", "lib", "roles.ts")).href
);

// The live platform. NOT ihelp-ops-ai-decodeds-projects.vercel.app — that is a
// different Vercel project, `ihelp-ops`, which cannot deploy at all (private
// organisation repository on the Hobby plan) and still serves a build from
// before /agents and /plan existed. Handbooks printed with that URL sent people
// to a stale site where half the product 404s.
const URL_ = "https://ihelp-ops-live.vercel.app";

// ---------------------------------------------------------------------------
// What each role is for, and what their day looks like
// ---------------------------------------------------------------------------
const ROLE = {
  member: {
    title: "If you build things here",
    standfirst:
      "You take work, you do it, and the platform shows what happened. Nobody asks you for a status, ever.",
    who: "Engineers, data annotators, anyone whose day produces commits.",
    day: [
      ["Morning", "Open the board. If something has your name on it, that is your day. If nothing does, find an unclaimed task and press <strong>Take it</strong> — you do not need permission, and you do not need to wait to be assigned. Found work nobody has written down? <strong>New task</strong> in the header, and it becomes a GitHub issue."],
      ["Starting", "Press <strong>Start task</strong>, open it in VS Code, and run <code>git config core.hooksPath .githooks</code> once per clone. That one command is what makes everything you push attach itself to the task."],
      ["Through the day", "Commit and push as you go. The board moves on its own within a minute of a push — you never touch it. When the work is ready, open the pull request from the task page."],
      ["When you are stuck", "Raise it in writing the same day. Label the issue <code>blocked</code> or say so in your pod channel. A block that is raised belongs to the company; a block that is not raised belongs to you."],
      ["End of day", "Nothing. There is no timesheet, no standup form, no status to file. If you pushed something, it is already visible."],
    ],
    notes: [
      ["Ask the agent before you ask a person.", "It has read the task and the repository, it answers in seconds, and nobody sees that you asked. It is also the fastest way to find out whether a task is bigger than it looks."],
      ["You cannot take a task somebody else holds.", "The platform names who has it. Go and ask them — they may be stuck, finished, or glad to hand it over."],
      ["Handing work back is normal.", "If a task is yours and you have not started, press <strong>Hand it back</strong>. No explanation owed. An honest hand-back beats a task sitting under your name for three weeks."],
      ["You own what an agent produced for you.", "Your name goes on the pull request. Read every line and be ready to explain it. “The agent wrote it” is not an answer, and the platform records who asked for the run."],
    ],
  },

  lead: {
    title: "If you run a pod",
    standfirst:
      "You put names on work, unblock it, and decide leave. Everything you need to do that is an artifact, not a report somebody wrote for you.",
    who: "Pod leads. Whoever is named in somebody’s lead_email.",
    day: [
      ["Morning", "Open <strong>Analytics</strong>. Two numbers decide your day: <em>claimed, not proven</em> — tasks with a name and no artifact behind them — and <em>stalled</em>, anything untouched for three days. Neither is a naughty list; both are a prompt to ask."],
      ["Assigning", "Open work with <strong>New task</strong> — the description you write there is the brief an agent gets, so write it as one. Anything under “nobody’s name on it” on <strong>Team</strong> is unclaimed: open the task and use <strong>Assign to…</strong>. You can also move a task off somebody who is stuck, away, or gone — that is the whole reason the power exists."],
      ["Reviewing", "Pull requests waiting on a human show on each task. <em>Review wait</em> on Analytics tells you if you are the bottleneck before anybody complains about it."],
      ["Leave", "Requests from your reports appear under <strong>Waiting on you</strong> on the Leave screen. A rejection needs a written reason — they read it on their own page."],
      ["Weekly", "1:1s. What was said stays with the pair; what was agreed becomes a goal or a task and travels normally."],
    ],
    notes: [
      ["A conversation is not evidence.", "You cannot read your reports’ conversations with agents, and that is deliberate. Judge the work by what landed. If somebody says an agent told them something, ask them to put it on the issue."],
      ["You decide leave only for your own reports.", "Matched on their <code>lead_email</code> being your address. The CTO and founder decide for everybody."],
      ["You cannot read a 1:1 you did not write.", "Not for your own reports either. Only the CTO can, and every such read appears in that person’s access log."],
      ["You do not need a GitHub account to assign work.", "The platform assigns with its own credentials. Only <em>doing</em> the work needs a linked account."],
    ],
  },

  cto: {
    title: "If you are the CTO",
    standfirst:
      "You see everything, including the notes. That reach is logged where the person it is about can read it — which is what makes it acceptable rather than quietly corrosive.",
    who: "One person. The only role that can read a 1:1 it did not write.",
    day: [
      ["Morning", "The digest is in your inbox from 6pm yesterday: who moved, who was quiet, who is on leave. Read the quiet list as a prompt for a conversation, never as a verdict — plenty of days are reading, debugging or meetings."],
      ["Analytics", "Cycle time and review wait are the two that describe the system rather than the people. If review wait is climbing, reviews are the bottleneck and no amount of pushing on authors will help."],
      ["Unblocking", "Assign or reassign anything, in any repository. Approve leave for anybody. Merge is available to you, and can still be refused by branch protection — that refusal is protection working."],
      ["People", "1:1 notes and feedback. Nothing you write about somebody is hidden from them; that is enforced by Postgres, not by a guideline. Every note you read that you did not write appears in their access log."],
      ["Accounts", "<strong>Admin</strong> is where roles, agent tiers and GitHub logins are set. Setting somebody’s GitHub login is the thing that turns an account into a person who can own work."],
    ],
    notes: [
      ["You cannot read anybody’s agent conversations.", "The policy has one clause and no admin escape, and <code>npm run test:chat</code> proves it by signing in as a founder and failing to read one. If that ever needs to change, it is a schema change with a written reason, not a setting."],
      ["You cannot change your own row.", "Nobody can, including you. A role change should be something a second person agreed to."],
      ["The last admin is protected.", "Nothing can demote or deactivate the only remaining admin — the way back would be a hand-written SQL statement against production."],
      ["Every role change is recorded.", "Who, when, and what it was before. The person it was about reads it on their own page, and nobody can edit or remove a line."],
    ],
  },

  founder: {
    title: "If you are the founder",
    standfirst:
      "You see the whole company’s work and what it costs. You deliberately cannot read 1:1 notes — that is the CTO alone, and it is a decision, not an oversight.",
    who: "One person. Full reach over work and accounts; no reach over private conversations.",
    day: [
      ["Morning", "The digest: who moved, who was quiet, who is away. One email covering everybody, not one per person."],
      ["Analytics", "Cycle time, review wait, rework, and cost per agent and per person. <em>Claimed, not proven</em> is the number worth arguing with — everything else describes the system, that one describes a gap."],
      ["Cost", "Every agent run records what it spent. A run showing nothing has not reported back yet; a failure with a cost against it is money spent on work that did not ship, and is worth reading the log for."],
      ["Unblocking", "Assign and reassign across every pod and repository. Any agent, any tier."],
      ["Accounts", "<strong>Admin</strong>: roles, tiers, GitHub logins, and the record of every change ever made to them."],
    ],
    notes: [
      ["Chat spend shows up as chat spend.", "Every conversation records its tokens and cost the way an agent run does. What was said is private; what it cost is not."],
      ["You cannot read other people’s 1:1 notes.", "The CTO alone can. If that should change it is one line in <code>db/schema-people-growth.sql</code> — a deliberate decision, made in the open, not a setting."],
      ["You cannot change your own row either.", "Same rule as everybody. Ask the CTO."],
      ["No hours, anywhere.", "There is no time-online, no presence, no session table, and there will not be. The moment those sit next to merged work, people optimise the easier number."],
    ],
  },
};

// ---------------------------------------------------------------------------
// Shared: the one rule, and how the ladder works. Same words in every book,
// because they are the same facts.
// ---------------------------------------------------------------------------
const THESIS = `
  <div class="thesis">
    <p class="big">Nobody types how far along they are.</p>
    <p>There is no “80% done” box anywhere in this platform, and there never will be. A task moves because something real happened: a branch appeared, a commit landed, a pull request opened, a person approved it, it merged.</p>
    <p><strong>You cannot fall behind by forgetting to update a status.</strong> If you did the work, the platform already knows.</p>
    <p><strong>You also cannot get ahead by saying you did.</strong> Nobody can, including the founder.</p>
  </div>`;

const TALK = `
  <section>
    <h2>Talking to an agent</h2>
    <p class="lede">Every task page has a conversation. Four things about it are worth knowing before you use it.</p>
    <dl class="rows">
      <div class="row"><dt>It can read, not write</dt><dd>The agent sees the task, its comments and its own brief from the repository, and will read the code with you, review an approach, or say plainly that it does not know. It cannot edit a file, commit or open a pull request from the conversation. When the work needs doing, press <strong>Run</strong> — that dispatches the same agent into GitHub Actions, where it opens a pull request somebody reviews</dd></div>
      <div class="row"><dt>It is private, and it is not the record</dt><dd>Nobody else can read your conversations — not your lead, not the CTO, not the founder. Nothing said in one moves a task or counts as work. If something from it matters, put it on the issue as a comment. That is the record; this is the thinking</dd></div>
      <div class="row"><dt>Any agent, from your first day</dt><dd>Tiers decide which agents you may <em>dispatch</em>, because a dispatched agent changes code. Talking changes nothing, so you may talk to all eight — including the architect</dd></div>
      <div class="row"><dt>It costs money</dt><dd>Each answer shows what it cost, usually a fraction of a cent. It is charged to the company like any agent run</dd></div>
    </dl>
  </section>`;

const LADDER = `
  <section>
    <h2>How a task moves</h2>
    <p class="lede">Seven steps, each caused by a real thing.</p>
    <div class="ladder">
      <div class="rung"><span class="pc">10%</span><span class="cause">The issue was opened — it may have no owner yet</span></div>
      <div class="rung"><span class="pc">20%</span><span class="cause">A branch was created for it</span></div>
      <div class="rung"><span class="pc">40%</span><span class="cause">The first commit landed on that branch</span></div>
      <div class="rung"><span class="pc">60%</span><span class="cause">A pull request was opened</span></div>
      <div class="rung"><span class="pc">75%</span><span class="cause">The automated checks passed</span></div>
      <div class="rung"><span class="pc">90%</span><span class="cause">A human approved it</span></div>
      <div class="rung top"><span class="pc">100%</span><span class="cause">It was merged</span></div>
    </div>
    <p>A task stuck at 10% means nothing has happened — not that somebody forgot to update it.</p>
  </section>`;

// ---------------------------------------------------------------------------
const esc = (s) => String(s).replace(/&(?![a-z#]+;)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function accessTable(role) {
  const rows = PERMISSIONS.map((p) => {
    const mine = p[role];
    const no = mine === "—";
    return `      <div class="arow${no ? " no" : ""}">
        <span class="acan">${esc(p.what)}</span>
        <span class="aval">${no ? "no" : esc(mine)}</span>
      </div>`;
  }).join("\n");

  return `
  <section>
    <h2>What you can do</h2>
    <p class="lede">Generated from the same file the platform enforces, so it cannot describe a permission you do not have.</p>
    <div class="access">
${rows}
    </div>
  </section>`;
}

function page(role) {
  const r = ROLE[role];
  const day = r.day
    .map(([when, what]) => `      <div class="row"><dt>${esc(when)}</dt><dd>${what}</dd></div>`)
    .join("\n");
  const notes = r.notes
    .map(([head, body]) => `    <div class="note"><p><strong>${head}</strong> ${body}</p></div>`)
    .join("\n");

  return `<title>The ${role} handbook</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap">
<style>${STYLE}</style>

<div class="page">
  <header class="mast">
    <p class="eyebrow">iHelp Robotics · the ${esc(role)} handbook</p>
    <h1>${esc(r.title)}</h1>
    <p class="standfirst">${esc(r.standfirst)}</p>
    <a class="url" href="${URL_}">${URL_.replace("https://", "")}</a>
  </header>
${THESIS}

  <section>
    <h2>Your day</h2>
    <p class="lede">${esc(r.who)}</p>
    <dl class="rows">
${day}
    </dl>
  </section>
${accessTable(role)}

  <section>
    <h2>Worth knowing</h2>
${notes}
  </section>
${TALK}
${LADDER}

  <section>
    <h2>If something looks wrong</h2>
    <dl class="rows">
      <div class="row"><dt>Everything says 10%</dt><dd>No GitHub activity has reached the platform. The board says so rather than showing a quiet week</dd></div>
      <div class="row"><dt>Merge was refused</dt><dd>Branch protection. A required review or check is missing — working as intended</dd></div>
      <div class="row"><dt>My commits aren’t showing</dt><dd>The commit hook isn’t installed in that clone. Run <code>git config core.hooksPath .githooks</code> and push again</dd></div>
      <div class="row"><dt>There’s no Take it button</dt><dd>Either the task already has an owner — it says who — or your GitHub account isn’t linked</dd></div>
      <div class="row"><dt>The same number twice</dt><dd>Different tasks in different repositories. Issue numbers restart in each one</dd></div>
    </dl>
    <p>Every error in this platform says what failed and what to check. One that doesn’t is worth reporting.</p>
  </section>

  <footer>
    <p>The handbook covering everything, for everybody, is the one to read once. This one is the part that is yours.</p>
    <p>Questions about the platform go to the founder. Questions about a task go on the task.</p>
  </footer>
</div>
`;
}

const STYLE = readFileSync(join(HERE, "handbook.css"), "utf8");

mkdirSync(HERE, { recursive: true });
for (const role of ROLES) {
  const out = join(HERE, `${role}.html`);
  writeFileSync(out, page(role));
  console.log(`  ${role.padEnd(8)} -> ops/handbooks/${role}.html`);
}
console.log(`\n${ROLES.length} handbooks built from one source. The access table came from app/lib/roles.ts.`);
