/**
 * Daily emails.
 *
 * Two things go out each evening:
 *   1. A nudge to anyone with no artifact and no raised block today.
 *   2. One digest to the delivery manager and the CTO covering everybody.
 *
 * Three rules this file exists to enforce:
 *
 *   - A nudge fires on MISSING WORK, not on a missing form. If someone pushed
 *     three commits and never opened the platform, they are not nudged. The
 *     opposite would teach people to type status, which is the habit this whole
 *     system was built to remove.
 *
 *   - Anyone on approved leave is skipped entirely. Emailing someone on sick
 *     leave to ask why they shipped nothing is how you lose a team.
 *
 *   - Leads get ONE digest, not one email per person. Eight emails a night are
 *     filtered by week two, and then the channel is dead for everything else.
 */

import { sql } from "./db.mjs";
import { ghAll, repos, hoursSince } from "./gh.mjs";
import { sendMail } from "./mail.mjs";

export async function runDailyEmail() {

const today = new Date().toISOString().slice(0, 10);
const DAY_AGO = new Date(Date.now() - 864e5).toISOString();

// --------------------------------------------------------------------------
// Gather artifacts — the only evidence that counts
// --------------------------------------------------------------------------
const activity = new Map(); // gh_login -> { commits, prs, reviews, blocks }

const bump = (login, field) => {
  if (!login) return;
  const a = activity.get(login) || { commits: 0, prs: 0, reviews: 0, blocks: 0, links: [] };
  a[field]++;
  activity.set(login, a);
};

for (const repo of repos()) {
  const commits = await ghAll(`/repos/${repo}/commits?since=${DAY_AGO}&per_page=100`, 2);
  for (const c of commits) bump(c.author?.login, "commits");

  const prs = await ghAll(`/repos/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=50`, 1);
  for (const pr of prs) {
    if (hoursSince(pr.updated_at) < 24) {
      bump(pr.user?.login, "prs");
      const a = activity.get(pr.user?.login);
      if (a) a.links.push(`${pr.title} — ${pr.html_url}`);
    }
  }

  const issues = (await ghAll(`/repos/${repo}/issues?state=open&per_page=100`, 2)).filter((i) => !i.pull_request);
  for (const i of issues) {
    const labels = (i.labels || []).map((l) => l.name);
    if ((labels.includes("blocked") || labels.includes("needs-human")) && hoursSince(i.updated_at) < 24) {
      for (const as of i.assignees || []) bump(as.login, "blocks");
    }
  }
}

// --------------------------------------------------------------------------
// Who is actually expected to have shipped today
// --------------------------------------------------------------------------
const people = await sql`
  select u.id, u.name, u.email, u.gh_login, u.pod, u.lead_email
  from app_user u
  where u.active and u.email is not null
    and u.id not in (select user_id from on_leave_today)
`;

const onLeave = await sql`select name, kind, ends_on from on_leave_today`;

const quiet = [];
const moving = [];

for (const p of people) {
  const a = p.gh_login ? activity.get(p.gh_login) : null;
  const shipped = a ? a.commits + a.prs + a.reviews : 0;

  if (shipped === 0 && (!a || a.blocks === 0)) quiet.push(p);
  else moving.push({ ...p, ...(a || {}) });
}

// --------------------------------------------------------------------------
// 1. Nudges — to the person, plainly, once
// --------------------------------------------------------------------------
for (const p of quiet) {
  // The same expression as the nudge_once_per_day index, deliberately. If this
  // said current_date it would read the server's zone (UTC) while the index
  // counted Indian days, and the two would disagree for the five and a half
  // hours that matter most — the digest fires at 18:00 IST.
  const already = await sql`
    select 1 from notification_log
    where user_id = ${p.id} and kind = 'nudge'
      and (sent_at at time zone 'Asia/Kolkata')::date
        = (now() at time zone 'Asia/Kolkata')::date
  `;
  if (already.length) continue;

  await sendMail({
    to: p.email,
    subject: "Nothing recorded against your name today",
    body: `Hi ${p.name?.split(" ")[0] || ""},

Nothing came through today — no commits, no pull request activity, and no block raised.

That is often fine. Some days are reading, debugging or a meeting. This is a prompt, not a reprimand.

If you are stuck, the rule exists to protect you: raise it in writing. Label the issue 'blocked' or post it in your pod channel. A block that is raised belongs to the company. A block that is not raised belongs to you.

If you were away, book it under Leave on the platform and these stop.

  ${process.env.PLATFORM_URL}

— automated, from the platform`,
  });

  await sql`
    insert into notification_log (user_id, kind, sent_to, subject)
    values (${p.id}, 'nudge', ${p.email}, 'Nothing recorded against your name today')
  `;
}

// --------------------------------------------------------------------------
// 2. One digest to the leads
// --------------------------------------------------------------------------
const lines = [];

lines.push(`Daily digest — ${today}`);
lines.push(`${moving.length} moved · ${quiet.length} quiet · ${onLeave.length} on leave`);
lines.push("");
lines.push("MOVED");
for (const m of moving.sort((a, b) => (b.commits + b.prs) - (a.commits + a.prs))) {
  lines.push(`  ${m.name} — ${m.commits} commits, ${m.prs} PRs${m.blocks ? `, ${m.blocks} blocked` : ""}`);
  for (const l of (m.links || []).slice(0, 3)) lines.push(`      ${l}`);
}

if (quiet.length) {
  lines.push("");
  lines.push("QUIET — no artifact, no block raised. Worth a message, not an assumption:");
  for (const q of quiet) lines.push(`  ${q.name}${q.pod ? ` (${q.pod})` : ""}`);
}

if (onLeave.length) {
  lines.push("");
  lines.push("ON LEAVE");
  for (const l of onLeave) lines.push(`  ${l.name} — ${l.kind}, back after ${l.ends_on}`);
}

lines.push("");
lines.push("A second quiet day for the same person is a conversation, not another email.");
lines.push(process.env.PLATFORM_URL || "");

const digest = lines.join("\n");

for (const to of (process.env.DIGEST_TO || "").split(",").map((s) => s.trim()).filter(Boolean)) {
  await sendMail({ to, subject: `iHelp daily — ${moving.length} moved, ${quiet.length} quiet`, body: digest });
  await sql`insert into notification_log (kind, sent_to, subject) values ('digest', ${to}, ${'iHelp daily ' + today})`;
}

console.log(digest);

  return { moved: moving.length, quiet: quiet.length, onLeave: onLeave.length };
}
