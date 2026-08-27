#!/usr/bin/env node
// Row-level security check — docs/09-acceptance.md, Test 7.
//
//   DATABASE_URL=... npm run test:rls
//
// Two things are verified, and they fail in different places:
//
//   A. withUser() puts the session context where the query can see it. This is
//      the one that is silent when it breaks. set_config(..., true) is
//      TRANSACTION scoped, so setting it in one call and querying in the next
//      loses it, RLS fails closed, and every read comes back empty — which
//      looks like "this person has no notes", not like a bug.
//
//   B. The policies themselves: who can read a 1:1, who cannot, and what an
//      unset context returns.
//
// Nothing is left behind. Part B runs inside a transaction that is always
// rolled back, which is not only tidiness: the four protected tables have no
// DELETE policy — deliberately, since a note that can be quietly removed is
// worse than no note — so a check that inserted fixtures could not clean up
// after itself as the application role.
//
// withUser is imported from lib/db.ts rather than reimplemented. A copy would
// drift, and then this would be testing something nobody ships.

import { randomUUID } from "node:crypto";

const { sql, withUser, assumeAppRole, APP_ROLE } = await import("../lib/db.ts");

// A green run against no database must not imply isolation holds.
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Refusing to run: a check that passes without a database proves nothing about row-level security.");
  process.exit(1);
}

let bad = 0;
const is = (label, got, want) => {
  const ok = got === want;
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(58)} ${JSON.stringify(got)}${ok ? "" : `   expected ${JSON.stringify(want)}`}`);
};

class Rollback extends Error {}

try {
  // Superusers and BYPASSRLS roles ignore policies entirely, so a pass as one
  // of those would prove nothing.
  //
  // What matters is not the role the connection string logs in as — on Supabase
  // that is `postgres`, which has BYPASSRLS — but the role withUser() switches
  // to before it reads anything. That is the role the application's guarded
  // queries actually run as, so that is the role checked here.
  const [me] = await sql`select current_user as who`;
  const [appRole] = await sql`
    select rolname, rolsuper, rolbypassrls from pg_roles where rolname = ${APP_ROLE}`;

  if (!appRole) {
    console.error(`\nThere is no role called "${APP_ROLE}" in this database, so withUser() cannot switch to it and every guarded read would fail. Set DB_APP_ROLE to a role that exists.\n`);
    process.exit(1);
  }
  if (appRole.rolsuper || appRole.rolbypassrls) {
    console.error(
      `\nwithUser() runs as "${APP_ROLE}", which ${appRole.rolsuper ? "is a superuser" : "has BYPASSRLS"}.\n` +
      `Policies do not apply to that role, so this check cannot prove anything.\n` +
      `Point DB_APP_ROLE at an unprivileged role.\n`
    );
    process.exit(1);
  }
  console.log(`\nconnected as ${me.who}; guarded reads run as ${APP_ROLE} — no superuser, no BYPASSRLS, policies are in force\n`);

  // ---------------------------------------------------------------------
  // A. The wrapper. No fixtures needed: ask the database what it can see.
  // ---------------------------------------------------------------------
  console.log("— withUser puts the context where the query can see it —");
  const someone = "00000000-0000-0000-0000-000000000042";

  const [seen] = await withUser(someone, "cto", (tx) => tx`
    select current_setting('app.user_id', true)   as uid,
           current_setting('app.user_role', true) as role,
           current_user                           as who
  `);
  is("the query reads back the user it was run as", seen.uid, someone);
  is("and the role", seen.role, "cto");
  // The one that made every other assertion here meaningless when it was
  // missing: the context was being set for a role policies do not apply to.
  is("and runs as the unprivileged role, not the login role", seen.who, APP_ROLE);
  is("which the connection goes back from afterwards",
     (await sql`select current_user as who`)[0].who, (await sql`select session_user as who`)[0].who);

  await sql`select set_config('app.user_id', ${someone}, true)`;
  const [after] = await sql`select current_setting('app.user_id', true) as uid`;
  is("context set in a separate call is gone by the next", after.uid || null, null);

  // ---------------------------------------------------------------------
  // B. The policies, against real rows, always rolled back.
  // ---------------------------------------------------------------------
  console.log("\n— the policies, against real rows —");
  try {
    await sql.begin(async (tx) => {
      // Tagged per run. gh_login is unique, so a run that dies before its
      // rollback cannot collide with the next one.
      const tag = randomUUID().slice(0, 8);
      const people = Object.fromEntries(
        (await tx`
          insert into app_user (gh_login, name, role) values
            (${`rls-check-${tag}-cto`},    'Fixture CTO',    'cto'),
            (${`rls-check-${tag}-lead`},   'Fixture Lead',   'lead'),
            (${`rls-check-${tag}-member`}, 'Fixture Member', 'member')
          returning gh_login, id
        `).map((r) => [r.gh_login, r.id])
      );
      const cto = people[`rls-check-${tag}-cto`];
      const lead = people[`rls-check-${tag}-lead`];
      const member = people[`rls-check-${tag}-member`];

      // The fixtures above are written as the login role; everything from here
      // down has to run as the role the application's guarded reads run as, or
      // the policies below are being tested against a role that bypasses them.
      await assumeAppRole(tx);

      // Context is transaction scoped, so switching it here is how one
      // transaction can act as several people in turn.
      const as = async (id, role) => {
        await tx`select set_config('app.user_id', ${id}, true)`;
        await tx`select set_config('app.user_role', ${role}, true)`;
      };

      // Writing is policed too: author_id must be the current user, and the
      // role must be one that may write at all.
      await as(cto, "cto");
      await tx`insert into one_on_one (subject_id, author_id, held_on, notes, agreed_actions)
               values (${member}, ${cto}, current_date, 'private conversation', 'ship the eval harness')`;
      await tx`insert into feedback_note (subject_id, author_id, body)
               values (${member}, ${cto}, 'strong week on the perception stack')`;

      // A row only RLS would allow through: the member is neither the author
      // nor the CTO, so subject_id = app_current_user() is the sole reason
      // this returns anything.
      await as(member, "member");
      const asSubject = await tx`select notes from one_on_one where subject_id = ${member}`;
      is("the subject reads the 1:1 written about them", asSubject.length, 1);
      is("and it is the real row", asSubject[0]?.notes, "private conversation");
      is("b. every subject reads every note about themselves",
         (await tx`select id from feedback_note`).length, 1);

      await as(lead, "lead");
      is("a. a 'lead' cannot read a 1:1 authored by the 'cto'",
         (await tx`select id from one_on_one`).length, 0);

      await tx`select set_config('app.user_id', '', true)`;
      await tx`select set_config('app.user_role', '', true)`;
      is("c. unset session context returns zero rows",
         (await tx`select id from one_on_one`).length, 0);

      await as(cto, "cto");
      is("the CTO reads all notes", (await tx`select id from one_on_one`).length, 1);

      throw new Rollback();   // nothing above is kept
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }

  const [{ leftover }] = await sql`
    select count(*)::int as leftover from app_user where gh_login like 'rls-check-%'
  `;
  is("\nnothing was left behind", leftover, 0);
} finally {
  await sql.end();
}

console.log(bad === 0 ? "\nall passed\n" : `\n${bad} FAILED\n`);
process.exit(bad === 0 ? 0 : 1);
