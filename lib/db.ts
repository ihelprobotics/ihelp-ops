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
      max: 5,
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
    return fn(tx);
  }) as Promise<T>;
}
