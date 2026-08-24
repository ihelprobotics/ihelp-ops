// ops/lib/db.mjs — Supabase variant
//
// Lazy on purpose: this module is imported by the Vercel cron route as well as
// the CLI, so a hard failure at import time would kill the function before its
// error handler could name the missing variable.

import postgres from "postgres";

let _sql;

export const sql = (...args) => {
  if (!_sql) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set. The digest cannot run without it — an empty result would be reported as a quiet team.");
    }
    _sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 3 });
  }
  return _sql(...args);
};
