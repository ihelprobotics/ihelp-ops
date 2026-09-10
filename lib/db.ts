// lib/db.ts — Supabase / postgres.js
//
// Supabase is Postgres, so everything in db/*.sql applies unchanged, including
// row-level security. Only the driver differs.
//
// Two settings are not optional on Supabase:
//
//   prepare: false   Supavisor in transaction mode cannot use prepared
//                    statements. Without this you get intermittent
//                    "prepared statement does not exist" under load — the
//                    worst kind of bug, because it passes in development.
//
//   port 6543        The transaction pooler. Port 5432 is a direct connection
//                    and will exhaust on serverless within a day.
//
// The connection is opened on first use, not at import. next build imports
// every route handler to collect page data, so a throw at module load fails the
// whole build instead of reaching the route's error handler — and on a live
// deploy it would turn a missing variable into an opaque 500 rather than the
// message that names it. Same reasoning as ops/lib/db.mjs.

import postgres from "postgres";

let _sql: postgres.Sql | null = null;

function client(): postgres.Sql {
  if (!_sql) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set. Use the Supabase transaction pooler string on port 6543, not the direct 5432 one.");
    }
    _sql = postgres(process.env.DATABASE_URL, {
      prepare: false,
      idle_timeout: 20,
      // One connection per instance, not five.
      //
      // The transaction pooler is already the pool: it multiplexes many clients
      // onto few Postgres backends, which is the whole reason port 6543 exists.
      // A second pool in front of it holds backends open that this instance is
      // not using, and serverless multiplies that by however many instances are
      // warm — which is how a project runs out of connections while barely
      // serving anyone. A request needs one connection at a time; this gives it
      // exactly that.
      max: 1,
      // Fail in ten seconds with a message, rather than hanging until something
      // upstream gives up. A page that eventually errors is bad; a page that
      // hangs is worse, because nobody can tell it apart from a slow one.
      connect_timeout: 10,
    });
  }
  return _sql;
}

/**
 * Tagged-template client. Behaves exactly like a postgres.js instance —
 * sql`...`, sql.begin, sql.json — but connects on first use.
 */
export const sql: postgres.Sql = new Proxy((() => {}) as any, {
  apply: (_target, _thisArg, args: any[]) => (client() as any)(...args),
  get: (_target, prop) => (client() as any)[prop],
}) as postgres.Sql;

/**
 * The role the guarded reads run as.
 *
 * DATABASE_URL connects as `postgres`, and on Supabase that role has BYPASSRLS.
 * Every policy in db/schema-people-growth.sql is therefore inert on that
 * connection: the 1:1 a delivery manager must not be able to read comes back to
 * them, and nothing anywhere reports a problem. It is the worst shape a
 * security bug can have — correct policies, correctly applied to nobody.
 *
 * So withUser() does not only set the session context, it switches role for the
 * duration of the transaction. `authenticated` is a Supabase built-in that
 * holds no superuser and no BYPASSRLS bit and already carries the table grants,
 * which is what lets this be a fix with no new credential behind it. Override
 * with DB_APP_ROLE when the app gets a dedicated login role of its own.
 *
 * SET LOCAL ROLE is transaction scoped, exactly like the set_config calls
 * beside it, so the connection goes back to what it was when the transaction
 * ends — which matters on a pooler, where the next request gets this same
 * connection.
 */
export const APP_ROLE = process.env.DB_APP_ROLE || "authenticated";

// SET ROLE takes an identifier, not a parameter, so this string is concatenated
// into SQL. It is checked rather than trusted: anything but a plain identifier
// is refused by name here instead of becoming an injection point.
if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(APP_ROLE)) {
  throw new Error(`DB_APP_ROLE is "${APP_ROLE}", which is not a plain Postgres role name. It is used in SET LOCAL ROLE, which cannot take a parameter, so only [A-Za-z_][A-Za-z0-9_]* is accepted.`);
}

/**
 * Run queries as a specific person, with row-level security applied.
 *
 * This exists because of something that is easy to get wrong and silent when
 * you do: session context set by set_config(..., true) is TRANSACTION scoped.
 * Any pooled driver — Supabase's Supavisor, or Neon's HTTP driver — treats each
 * separate sql`` call as its own transaction. So this:
 *
 *     await sql`select set_config('app.user_id', ${id}, true)`;
 *     await sql`select * from one_on_one`;          // <- different transaction
 *
 * sets the context and then throws it away. The second query runs with no
 * context, RLS fails closed, and you get zero rows — which looks like "this
 * person has no notes" rather than like a bug.
 *
 * Everything touching goal, goal_evidence, one_on_one or feedback_note must go
 * through this function.
 */
export async function withUser<T>(
  userId: string,
  role: string,
  fn: (tx: postgres.TransactionSql) => Promise<T>
): Promise<T> {
  // postgres.js types begin() as Promise<UnwrapPromiseArray<T>>, which exists so
  // that returning an array of queries resolves them. For every T that is not an
  // array of promises it is T exactly, and fn already hands back a settled
  // value — so the cast is narrowing the driver's convenience type, not hiding
  // a mismatch. Without it this file does not compile, and next build typechecks.
  return sql.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${userId}, true)`;
    await tx`select set_config('app.user_role', ${role}, true)`;
    // Last, and inside the same transaction: without it the two lines above are
    // set for a role the policies do not apply to, and every read succeeds by
    // bypassing the thing that was supposed to check it.
    await assumeAppRole(tx);
    return fn(tx);
  }) as Promise<T>;
}

/**
 * Switch this transaction to the unprivileged role, so policies apply.
 *
 * Exported because db/rls-check.mjs and db/people-check.mjs build their own
 * fixture transactions and have to run them as the same role the application
 * does. A check that proves isolation for a role nobody connects as proves
 * nothing, and that is exactly the shape the failure took here.
 */
export async function assumeAppRole(tx: postgres.TransactionSql): Promise<void> {
  await tx.unsafe(`set local role ${APP_ROLE}`);
}

/**
 * What to show a person when the database could not be reached.
 *
 * postgres.js reports transport failures the way a socket library does —
 * `write CONNECTION_CLOSED aws-0-ap-northeast-2.pooler.supabase.com:6543`, or
 * `authentication did not complete within 15000ms`. Both are accurate and
 * neither tells the reader anything they can do. Worse, they read like a bug in
 * the page they are standing on, when the platform is working and its database
 * is not: during a Supabase incident every screen blamed itself.
 *
 * So a *connection* failure says the database is unreachable, says the platform
 * is fine, and points at the two things worth checking. Everything else is
 * passed through untouched — a constraint violation or a policy refusal is
 * about what was asked for, and rewriting those would bury the answer.
 *
 * The driver's own words are kept on the end. They are what makes a report
 * actionable to whoever has to fix it.
 */
export function dbErrorMessage(e: any): string {
  const raw = e?.message ?? String(e);
  const code = e?.code ?? "";

  // postgres.js uses these for transport, not for anything SQL said.
  const transport =
    code === "CONNECTION_CLOSED" ||
    code === "CONNECTION_ENDED" ||
    code === "CONNECTION_DESTROYED" ||
    code === "CONNECT_TIMEOUT" ||
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "ETIMEDOUT" ||
    /CONNECTION_(CLOSED|ENDED|DESTROYED)|CONNECT_TIMEOUT|authentication did not complete|ECONNREFUSED|ENOTFOUND|ETIMEDOUT/i.test(raw);

  if (!transport) return raw;

  return (
    "The database is not answering, so this page cannot be built. " +
    "The platform itself is fine and nothing you did caused this — signing in " +
    "again will not help. Check status.supabase.com for an incident, and the " +
    "Supabase dashboard in case the project is paused. " +
    `/api/health reports the same thing. The driver said: ${raw}`
  );
}
