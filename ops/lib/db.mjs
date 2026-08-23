import { neon } from "@neondatabase/serverless";

// Lazy on purpose. This module is imported by the Vercel cron route as well as
// the CLI, and a process.exit() at module load would kill the function before
// its error handler could report which variable was missing — which is exactly
// the "name the missing thing" rule this codebase is built on.

let _sql;

export const sql = (...args) => {
  if (!_sql) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set. The digest cannot run without it — an empty result would be reported as a quiet team.");
    }
    _sql = neon(process.env.DATABASE_URL);
  }
  return _sql(...args);
};
