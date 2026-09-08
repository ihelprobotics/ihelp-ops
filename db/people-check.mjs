#!/usr/bin/env node
// People check — docs/04 Phase 6, and docs/09-acceptance.md Test 7 parts 1-4.
//
//   npm run test:people
//
// db/rls-check.mjs already proves the three assertions Phase 6 names. This
// proves the rest of Phase 6: that leave behaves the way the Escalator depends
// on, that a person cannot be nudged twice in a day, that the rules in
// app/lib/leave.ts refuse what they claim to refuse, and that the reads behind
// /me and /person/[id] return exactly what the policies allow and no more.
//
// The leave rules are imported from app/lib/leave.ts rather than restated. A
// copy here would be a test of something nobody ships, and it would keep
// passing after the shipped rule changed.
//
// Part B runs inside a transaction that is always rolled back. That is not only
// tidiness: goal, one_on_one and feedback_note have no DELETE policy — a note
// that can be quietly removed is worse than no note — so a check that inserted
// fixtures could not clean up after itself as the application role.

import { randomUUID } from "node:crypto";

const { sql, withUser, assumeAppRole, APP_ROLE } = await import("../lib/db.ts");
const { validateLeave, daysOf, overlaps, canDecide, countsAgainstBalance } = await import("../app/lib/leave.ts");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Refusing to run: a check that passes without a database proves nothing about leave, and nothing at all about row-level security.");
  process.exit(1);
}

let bad = 0;
const is = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(60)} ${JSON.stringify(got)}${ok ? "" : `   expected ${JSON.stringify(want)}`}`);
};
/** `refusal` is the message, or null when the thing was allowed. */
const refuses = (label, refusal, mustMention) => {
  const ok = typeof refusal === "string" && refusal.toLowerCase().includes(mustMention.toLowerCase());
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(60)} ${JSON.stringify(typeof refusal === "string" ? refusal.slice(0, 66) : "allowed it")}${ok ? "" : `   expected a refusal mentioning "${mustMention}"`}`);
};

class Rollback extends Error {}

const tag = randomUUID().slice(0, 8);
const iso = (d) => d.toISOString().slice(0, 10);
const TODAY = iso(new Date());
const IN_A_WEEK = iso(new Date(Date.now() + 7 * 864e5));
const YEAR = new Date().getFullYear();

try {
  // Not the role the connection string logs in as — on Supabase that is
  // `postgres`, which has BYPASSRLS — but the role withUser() switches to
  // before reading anything. That is the role Part C has to be proved against.
  const [me] = await sql`select current_user as who`;
  const [appRole] = await sql`select rolname, rolsuper, rolbypassrls from pg_roles where rolname = ${APP_ROLE}`;
  if (!appRole) {
    console.error(`\nThere is no role called "${APP_ROLE}" in this database, so withUser() cannot switch to it. Set DB_APP_ROLE to a role that exists.\n`);
    process.exit(1);
  }
  if (appRole.rolsuper || appRole.rolbypassrls) {
    console.error(`\nwithUser() runs as "${APP_ROLE}", which ${appRole.rolsuper ? "is a superuser" : "has BYPASSRLS"}. Policies do not apply to that role, so Part C could not prove anything.\n`);
    process.exit(1);
  }
  console.log(`\nconnected as ${me.who}; guarded reads run as ${APP_ROLE} — policies are in force\n`);

  // =========================================================================
  // A. The rules, as functions. No database needed, and none used.
  // =========================================================================
  console.log("— the rules a request has to satisfy —");
  is("three days is three days", daysOf({ starts_on: "2026-09-14", ends_on: "2026-09-16" }), 3);
  is("one day is one day", daysOf({ starts_on: "2026-09-14", ends_on: "2026-09-14" }), 1);
  is("a half day is half a day", daysOf({ starts_on: "2026-09-14", ends_on: "2026-09-14", half_day: true }), 0.5);
  is("planned leave comes off the balance", countsAgainstBalance("planned"), true);
  is("sick leave does not", countsAgainstBalance("sick"), false);

  const check = (input) => validateLeave(input).error;
  refuses("a kind nobody defined is refused by name", check({ kind: "sabbatical", starts_on: TODAY, ends_on: TODAY }), "planned, sick, unpaid, comp_off");
  refuses("31 February is refused", check({ kind: "planned", starts_on: "2026-02-31", ends_on: "2026-02-31" }), "not a date");
  refuses("ending before starting is refused", check({ kind: "planned", starts_on: "2026-09-16", ends_on: "2026-09-14" }), "cannot end before it starts");
  refuses("a half day across three dates is refused", check({ kind: "planned", starts_on: "2026-09-14", ends_on: "2026-09-16", half_day: true }), "single date");
  refuses("a mistyped year is refused", check({ kind: "planned", starts_on: "0226-09-14", ends_on: "0226-09-14" }), "typo in the year");
  is("a coherent request is accepted", check({ kind: "planned", starts_on: "2026-09-14", ends_on: "2026-09-16" }), null);
  is("and comes back normalised", validateLeave({ kind: "planned", starts_on: "2026-09-14", ends_on: "2026-09-16", reason: "  holiday  " }).value,
     { kind: "planned", starts_on: "2026-09-14", ends_on: "2026-09-16", half_day: false, reason: "holiday" });

  is("touching ranges overlap", overlaps({ starts_on: "2026-09-14", ends_on: "2026-09-16" }, { starts_on: "2026-09-16", ends_on: "2026-09-18" }), true);
  is("adjacent ranges do not", overlaps({ starts_on: "2026-09-14", ends_on: "2026-09-16" }, { starts_on: "2026-09-17", ends_on: "2026-09-18" }), false);

  const aLead = { id: "L", role: "lead", email: "Lead@ihelp.dev" };
  is("a lead decides for their own report", canDecide(aLead, { user_id: "M", requester_lead_email: "lead@ihelp.dev" }), null);
  refuses("and for nobody else", canDecide(aLead, { user_id: "M", requester_lead_email: "other@ihelp.dev" }), "not yours to decide");
  refuses("nobody approves their own leave", canDecide(aLead, { user_id: "L", requester_lead_email: "lead@ihelp.dev" }), "cannot approve your own");
  is("the CTO decides anything", canDecide({ id: "C", role: "cto", email: "cto@ihelp.dev" }, { user_id: "M", requester_lead_email: null }), null);
  refuses("a member decides nothing", canDecide({ id: "X", role: "member", email: "x@ihelp.dev" }, { user_id: "M", requester_lead_email: null }), "lead, cto or founder");

  // =========================================================================
  // B. Leave against real Postgres — Test 7, parts 1 to 4.
  // =========================================================================
  console.log("\n— leave, and what the digest reads —");
  try {
    await sql.begin(async (tx) => {
      const people = Object.fromEntries(
        (await tx`
          insert into app_user (gh_login, name, role, email, lead_email, pod) values
            (${`ppl-check-${tag}-cto`},    'Fixture CTO',    'cto',    ${`ppl-${tag}-cto@x.dev`},    null, 'platform'),
            (${`ppl-check-${tag}-lead`},   'Fixture Lead',   'lead',   ${`ppl-${tag}-lead@x.dev`},   null, 'platform'),
            (${`ppl-check-${tag}-member`}, 'Fixture Member', 'member', ${`ppl-${tag}-member@x.dev`}, ${`ppl-${tag}-lead@x.dev`}, 'platform')
          returning gh_login, id
        `).map((r) => [r.gh_login, r.id])
      );
      const cto = people[`ppl-check-${tag}-cto`];
      const leadId = people[`ppl-check-${tag}-lead`];
      const member = people[`ppl-check-${tag}-member`];

      // 1. Book leave covering today, approve it, and look for the person in
      //    the view the Escalator and the digest both read.
      const [req] = await tx`
        insert into leave_request (user_id, kind, starts_on, ends_on, reason)
        values (${member}, 'planned', ${TODAY}::date, ${IN_A_WEEK}::date, 'fixture')
        returning id, status`;
      is("a new request lands as pending", req.status, "pending");
      is("and does not put anyone on leave yet",
         (await tx`select 1 from on_leave_today where user_id = ${member}`).length, 0);

      await tx`update leave_request set status='approved', decided_by=${leadId}, decided_at=now() where id = ${req.id}`;
      is("1. approved leave puts them in on_leave_today",
         (await tx`select 1 from on_leave_today where user_id = ${member}`).length, 1);

      // 2. The digest's own filter — ops/lib/daily-email.mjs selects the people
      //    to consider with exactly this NOT IN, so a person on leave is never
      //    even a candidate for a nudge.
      const considered = await tx`
        select u.id from app_user u
         where u.active and u.email is not null
           and u.id = ${member}
           and u.id not in (select user_id from on_leave_today)`;
      is("2. and takes them out of the nudge list entirely", considered.length, 0);

      is("leave_taken counts the days the same way daysOf does",
         Number((await tx`select days from leave_taken where user_id = ${member} and year = ${YEAR}`)[0]?.days ?? 0),
         daysOf({ starts_on: TODAY, ends_on: IN_A_WEEK }));

      // Sick leave is recorded but is not spent entitlement.
      await tx`insert into leave_request (user_id, kind, starts_on, ends_on, status)
               values (${member}, 'sick', ${"2026-01-05"}::date, ${"2026-01-06"}::date, 'approved')`;
      is("sick leave is not counted against the balance",
         Number((await tx`select days from leave_taken where user_id = ${member} and year = ${YEAR}`)[0]?.days ?? 0),
         daysOf({ starts_on: TODAY, ends_on: IN_A_WEEK }));

      // A rejected request frees its dates again — the clash query behind
      // /api/leave only looks at pending and approved.
      await tx`insert into leave_request (user_id, kind, starts_on, ends_on, status)
               values (${leadId}, 'planned', ${TODAY}::date, ${TODAY}::date, 'rejected')`;
      is("a rejected request does not block those dates",
         (await tx`select 1 from leave_request where user_id = ${leadId}
                    and status in ('pending','approved')
                    and starts_on <= ${TODAY}::date and ends_on >= ${TODAY}::date`).length, 0);

      // An entitlement to read, so the balance policy has something to hide or
      // show rather than an empty table that would pass either way.
      await tx`insert into leave_balance (user_id, year, entitled, carried_over)
               values (${member}, ${YEAR}, 12, 2.5)`;

      // 3 and 4. One nudge per person per Indian day, enforced by the index
      // rather than by the sender remembering.
      await tx`insert into notification_log (user_id, kind, sent_to, subject)
               values (${member}, 'nudge', ${`ppl-${tag}-member@x.dev`}, 'first')`;
      let second = "it was allowed through";
      try {
        await tx`savepoint before_second`;
        await tx`insert into notification_log (user_id, kind, sent_to, subject)
                 values (${member}, 'nudge', ${`ppl-${tag}-member@x.dev`}, 'second')`;
      } catch (e) {
        second = e.code;                       // 23505 — unique_violation
        await tx`rollback to savepoint before_second`;
      }
      is("3+4. a second nudge on the same day is refused by the index", second, "23505");
      is("a digest to the same person on the same day is not", await (async () => {
        await tx`insert into notification_log (user_id, kind, sent_to, subject)
                 values (${member}, 'digest', ${`ppl-${tag}-member@x.dev`}, 'digest')`;
        return "allowed";
      })(), "allowed");

      // The digest addressed to a lead, which belongs to no one person and so
      // carries a null user_id. It is asserted on further down — "the CTO can"
      // — and until this line existed that assertion passed only when the
      // database happened to hold a row from a real digest run. It did on
      // production and did not on an empty one, which is a check reporting the
      // history of the database it ran against rather than the policy.
      await tx`insert into notification_log (user_id, kind, sent_to, subject)
               values (null, 'digest', ${`ppl-${tag}-lead@x.dev`}, 'the daily digest')`;

      // Ledger fixtures, written as the owner — which is how the webhook, the
      // agent callback and the Claude Code hooks all write them.
      const LREPO = `ppl-check/${tag}`;
      await tx`insert into gh_event (kind, repo, number, actor, occurred_at, payload)
               values ('pr_merged', ${LREPO}, 7, 'someone', now(), '{}'::jsonb)`;
      await tx`insert into commit_event (repo, sha, author, branch, message, issue_number, committed_at)
               values (${LREPO}, ${`ppl-${tag}-sha`}, 'someone', 'main', 'x', 7, now())`;
      await tx`insert into agent_run (requester_id, agent, repo, issue_number, status, cost_usd)
               values (${member}, 'scribe', ${LREPO}, 7, 'success', 0.11)`;
      await tx`insert into local_session (session_id, user_id, repo, branch, issue_number)
               values (${`ppl-${tag}-sess`}, ${member}, ${LREPO}, 'task/7/x', 7)`;

      // =====================================================================
      // C. Leave, under the policies rather than under a WHERE clause.
      // =====================================================================
      console.log("\n— leave, under row-level security —");
      await assumeAppRole(tx);
      const as0 = async (id, role) => {
        await tx`select set_config('app.user_id', ${id}, true)`;
        await tx`select set_config('app.user_role', ${role}, true)`;
      };
      const refused = async (label, code, run) => {
        let got = "it was allowed through";
        try {
          await tx`savepoint s`;
          await run();
        } catch (e) {
          got = e.code;
          await tx`rollback to savepoint s`;
        }
        is(label, got, code);
      };

      // The member sees their own two requests and nothing else.
      await as0(member, "member");
      is("the member reads their own leave",
         (await tx`select id from leave_request where user_id = ${member}`).length, 2);
      is("and no leave belonging to anybody else",
         (await tx`select id from leave_request where user_id <> ${member}`).length, 0);
      is("and their own entitlement",
         (await tx`select entitled from leave_balance where user_id = ${member}`)[0]?.entitled, "12.0");

      // The lead is this member's lead_email, so they see the requests.
      await as0(leadId, "lead");
      is("their lead reads them",
         (await tx`select id from leave_request where user_id = ${member}`).length, 2);
      is("and their balance", (await tx`select entitled from leave_balance where user_id = ${member}`).length, 1);

      // A colleague on no-one's lead line sees nothing.
      await as0(cto, "member");     // the CTO's id, deliberately without the role
      is("a colleague with no claim on them reads none",
         (await tx`select id from leave_request where user_id = ${member}`).length, 0);
      is("nor their entitlement",
         (await tx`select entitled from leave_balance where user_id = ${member}`).length, 0);

      await as0(cto, "cto");
      is("the CTO reads everything",
         (await tx`select id from leave_request where user_id = ${member}`).length, 2);

      await tx`select set_config('app.user_id', '', true)`;
      await tx`select set_config('app.user_role', '', true)`;
      is("unset context reads no leave at all",
         (await tx`select id from leave_request`).length, 0);
      is("and no balances", (await tx`select user_id from leave_balance`).length, 0);

      // Writes.
      await as0(member, "member");
      await refused("you cannot book leave in somebody else's name", "42501", () =>
        tx`insert into leave_request (user_id, kind, starts_on, ends_on)
           values (${leadId}, 'planned', current_date + 200, current_date + 200)`);

      const [own] = await tx`
        insert into leave_request (user_id, kind, starts_on, ends_on)
        values (${member}, 'planned', current_date + 300, current_date + 301)
        returning id, status`;
      is("you can book your own", own.status, "pending");

      // This is the one the policy exists for: the status column is writable,
      // so without a WITH CHECK anybody could approve themselves by setting it.
      await refused("you cannot approve your own leave by writing the column", "42501", () =>
        tx`update leave_request set status = 'approved' where id = ${own.id}`);
      await tx`update leave_request set status = 'cancelled' where id = ${own.id}`;
      is("but you can withdraw it",
         (await tx`select status from leave_request where id = ${own.id}`)[0].status, "cancelled");

      is("and a withdrawn request cannot be revived",
         (await tx`update leave_request set status = 'pending' where id = ${own.id} returning id`).length, 0);

      // Nothing may be deleted, by anyone, ever.
      await as0(cto, "cto");
      is("not even the CTO can delete a leave record",
         (await tx`delete from leave_request where user_id = ${member} returning id`).length, 0);

      // =====================================================================
      // D. The ledger, and the two records that are about a person.
      // =====================================================================
      console.log("\n— the ledger, and what is personal in it —");

      // The evidence the board and /analytics are computed from. Open to the
      // team, closed to a session with nobody set.
      await as0(member, "member");
      is("anyone signed in reads the event ledger",
         (await tx`select id from gh_event where repo = ${LREPO}`).length, 1);
      is("and the commits",
         (await tx`select sha from commit_event where repo = ${LREPO}`).length, 1);
      is("and what the agents cost",
         (await tx`select id from agent_run where repo = ${LREPO}`).length, 1);

      await tx`select set_config('app.user_id', '', true)`;
      await tx`select set_config('app.user_role', '', true)`;
      is("with nobody set, the ledger reads nothing",
         (await tx`select id from gh_event where repo = ${LREPO}`).length, 0);
      is("nor the commits", (await tx`select sha from commit_event where repo = ${LREPO}`).length, 0);
      is("nor the runs", (await tx`select id from agent_run where repo = ${LREPO}`).length, 0);

      // A nudge says "nothing was recorded against your name today". That is
      // material for a conversation with your lead, not for comparison between
      // colleagues.
      await as0(member, "member");
      is("you can see that you were nudged",
         (await tx`select id from notification_log where user_id = ${member} and kind = 'nudge'`).length, 1);
      is("and the session your own editor reported",
         (await tx`select session_id from local_session where user_id = ${member}`).length, 1);

      await as0(leadId, "lead");
      is("your lead can see it too",
         (await tx`select id from notification_log where user_id = ${member} and kind = 'nudge'`).length, 1);

      await as0(cto, "member");        // the CTO's id without the role — a colleague
      is("a colleague cannot see that you were nudged",
         (await tx`select id from notification_log where user_id = ${member}`).length, 0);
      is("nor which branch you sat on",
         (await tx`select session_id from local_session where user_id = ${member}`).length, 0);

      // The digest is addressed to a lead and is about everybody, so it belongs
      // to no one person and stays closed to everyone but the roles it reaches.
      is("a colleague cannot read the digest log",
         (await tx`select id from notification_log where user_id is null`).length, 0);
      await as0(cto, "cto");
      is("the CTO can", (await tx`select id from notification_log where user_id is null`).length >= 1, true);

      // =====================================================================
      // E. What /me and /person/[id] read, under the policies.
      // =====================================================================
      console.log("\n— the person page, under row-level security —");

      // Everything from here down runs as the role the application's guarded
      // reads run as. Without this the policies below would be tested against
      // a role that bypasses them, and every assertion would pass by accident.
      await assumeAppRole(tx);
      is("the fixture transaction is now the unprivileged role",
         (await tx`select current_user as who`)[0].who, APP_ROLE);

      const as = async (id, role) => {
        await tx`select set_config('app.user_id', ${id}, true)`;
        await tx`select set_config('app.user_role', ${role}, true)`;
      };

      await as(cto, "cto");
      const [goal] = await tx`
        insert into goal (subject_id, author_id, cycle, starts_on, due_on, statement)
        values (${member}, ${cto}, 'day30', current_date, current_date + 30, 'Ship the eval harness')
        returning id`;
      await tx`insert into goal_evidence (goal_id, kind, url, label, landed)
               values (${goal.id}, 'pr', 'https://github.com/x/y/pull/1', 'the harness', true),
                      (${goal.id}, 'doc', 'https://example.com/notes', 'design note', false)`;
      await tx`insert into one_on_one (subject_id, author_id, held_on, notes, agreed_actions)
               values (${member}, ${cto}, current_date, 'private conversation', 'ship the eval harness')`;
      await tx`insert into feedback_note (subject_id, author_id, body)
               values (${member}, ${cto}, 'strong week on the perception stack')`;

      // The goals query on the person page, run as the subject. Counts, never
      // a score — docs/06.
      await as(member, "member");
      const [g] = await tx`
        select g.id, count(e.id)::int as linked, count(e.id) filter (where e.landed)::int as landed
          from goal g left join goal_evidence e on e.goal_id = g.id
         where g.subject_id = ${member} group by g.id`;
      is("the subject reads their own goal", !!g, true);
      is("with its evidence linked", g?.linked, 2);
      is("and how much of it landed", g?.landed, 1);

      is("the subject reads the 1:1 written about them",
         (await tx`select notes from one_on_one where subject_id = ${member}`)[0]?.notes, "private conversation");
      is("and the feedback written about them",
         (await tx`select id from feedback_note where subject_id = ${member}`).length, 1);

      // A colleague on the same pod, who is neither subject, author nor CTO.
      await as(leadId, "lead");
      is("a lead reads no 1:1 they did not write",
         (await tx`select id from one_on_one where subject_id = ${member}`).length, 0);
      is("no feedback they did not write",
         (await tx`select id from feedback_note where subject_id = ${member}`).length, 0);
      is("and no goal they did not set",
         (await tx`select id from goal where subject_id = ${member}`).length, 0);
      is("nor any evidence hanging off it",
         (await tx`select id from goal_evidence where goal_id = ${goal.id}`).length, 0);

      // The read the subject is entitled to know about.
      await as(cto, "cto");
      const seen = await tx`select id, author_id, subject_id from one_on_one where subject_id = ${member}`;
      is("the CTO reads it", seen.length, 1);
      await tx`insert into note_access_log (note_id, reader_id, subject_id)
               values (${seen[0].id}, ${cto}, ${member})`;

      // A log anyone could write anyone else's name into is not evidence of
      // anything, so the policy allows recording a read you performed and no
      // other kind.
      let forged = "it was allowed through";
      try {
        await tx`savepoint before_forgery`;
        await tx`insert into note_access_log (note_id, reader_id, subject_id)
                 values (${seen[0].id}, ${leadId}, ${member})`;
      } catch (e) {
        forged = e.code;                       // 42501 — insufficient_privilege
        await tx`rollback to savepoint before_forgery`;
      }
      is("a read cannot be logged under somebody else's name", forged, "42501");

      await as(member, "member");
      is("and the subject can see that it was read",
         (await tx`select reader_id from note_access_log where subject_id = ${member}`).length, 1);

      await as(leadId, "lead");
      is("a colleague cannot read that log",
         (await tx`select reader_id from note_access_log where subject_id = ${member}`).length, 0);

      // The one that is silent when it breaks.
      await tx`select set_config('app.user_id', '', true)`;
      await tx`select set_config('app.user_role', '', true)`;
      is("unset context reads no goal", (await tx`select id from goal`).length, 0);
      is("no 1:1", (await tx`select id from one_on_one`).length, 0);
      is("no feedback", (await tx`select id from feedback_note`).length, 0);
      is("and no access log", (await tx`select id from note_access_log`).length, 0);

      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }

  // =========================================================================
  // D. withUser is what puts the context where those queries can see it.
  // =========================================================================
  console.log("\n— the wrapper the pages actually call —");
  const someone = "00000000-0000-0000-0000-000000000042";
  const [ctx] = await withUser(someone, "lead", (tx) => tx`
    select current_setting('app.user_id', true) as uid, current_setting('app.user_role', true) as role`);
  is("loadPerson's transaction carries the reader", ctx.uid, someone);
  is("and their role", ctx.role, "lead");

  const [{ leftover }] = await sql`
    select count(*)::int as leftover from app_user where gh_login like 'ppl-check-%'`;
  is("nothing was left behind", leftover, 0);
} finally {
  await sql.end();
}

console.log(bad === 0 ? "\nall passed\n" : `\n${bad} FAILED\n`);
process.exit(bad === 0 ? 0 : 1);
