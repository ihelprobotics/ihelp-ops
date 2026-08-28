// GET /api/health
//
// What an uptime monitor polls, and the first thing to open when somebody says
// "the platform is down".
//
// It checks the three things that can be down independently — Postgres, GitHub,
// and the environment the deployment was built with — and reports each
// separately. "The platform is down" is four different incidents with four
// different fixes, and a single green tick tells you which one it is not.
//
// Deliberately outside the session check in middleware.ts, because a monitor
// has no session and a health endpoint that requires one only ever reports that
// authentication works. It returns no secrets: the presence of a variable, not
// its value; the name of a repository, never a token.
//
// 200 when everything a person needs is working, 503 when it is not, so a
// monitor can alert on the status code alone.

import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { repos } from "@/app/lib/repos";
import { cacheSize } from "@/app/lib/cache";
import { githubRequestsSent } from "@/app/lib/github";

export const dynamic = "force-dynamic";

type Check = { ok: boolean; detail: string };

const REQUIRED = [
  "DATABASE_URL", "AUTH_SECRET", "AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET",
  "GH_DISPATCH_TOKEN", "GH_WEBHOOK_SECRET",
];

export async function GET() {
  const checks: Record<string, Check> = {};

  // ---- the environment ---------------------------------------------------
  const missing = REQUIRED.filter((k) => !process.env[k]);
  checks.environment = {
    ok: missing.length === 0,
    detail: missing.length ? `not set: ${missing.join(", ")}` : `all ${REQUIRED.length} required variables are set`,
  };

  // ---- Postgres ----------------------------------------------------------
  try {
    const started = Date.now();
    const [row] = await sql<{ n: number }[]>`select count(*)::int as n from app_user where active`;
    checks.database = { ok: true, detail: `${row.n} active accounts, answered in ${Date.now() - started}ms` };
  } catch (e: any) {
    checks.database = { ok: false, detail: e?.message ?? String(e) };
  }

  // ---- GitHub, and how much of the hour is left --------------------------
  // The rate limit endpoint does not itself count against the limit, so this
  // can be polled as often as a monitor likes.
  try {
    const res = await fetch("https://api.github.com/rate_limit", {
      headers: {
        Authorization: `Bearer ${process.env.GH_DISPATCH_TOKEN}`,
        Accept: "application/vnd.github+json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      checks.github = { ok: false, detail: `GitHub answered ${res.status} — the token is invalid, expired, or revoked` };
    } else {
      const core = (await res.json()).resources.core;
      const mins = Math.max(0, Math.ceil((core.reset * 1000 - Date.now()) / 60000));
      // Below a tenth of the hour's budget the board is minutes from failing,
      // and a monitor should say so before a person does.
      const ok = core.remaining > core.limit * 0.1;
      checks.github = {
        ok,
        detail: `${core.remaining} of ${core.limit} requests left, resets in ${mins}m`,
      };
    }
  } catch (e: any) {
    checks.github = { ok: false, detail: `could not reach GitHub: ${e?.message ?? String(e)}` };
  }

  // ---- what it is configured to watch ------------------------------------
  try {
    const list = await repos();
    checks.repositories = { ok: list.length > 0, detail: `${list.length} configured` };
  } catch (e: any) {
    checks.repositories = { ok: false, detail: e?.message ?? String(e) };
  }

  // ---- has anything ever arrived from GitHub -----------------------------
  // Not a failure — a new installation has none — but it is the single most
  // common reason for "the board is not moving", so it is on the page a person
  // opens first.
  try {
    const [row] = await sql<{ n: number; last: string | null }[]>`
      select count(*)::int as n, max(occurred_at)::text as last from gh_event`;
    checks.webhook = {
      ok: true,
      detail: row.n === 0
        ? "no events ever received — the repository or organisation webhook has never delivered"
        : `${row.n} events, most recent ${row.last}`,
    };
  } catch (e: any) {
    checks.webhook = { ok: false, detail: e?.message ?? String(e) };
  }

  const healthy = Object.values(checks).every((c) => c.ok);

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      checks,
      cachedReads: cacheSize(),
      githubRequestsSent: githubRequestsSent(),
      at: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503 }
  );
}
