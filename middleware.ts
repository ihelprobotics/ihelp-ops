// Middleware runs on the edge runtime, so it builds its own NextAuth instance
// from the edge-safe config alone. It must not import "@/auth" — that module
// reaches lib/db.ts and postgres.js, and a TCP socket cannot exist here.

import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

export const { auth: middleware } = NextAuth(authConfig);

// Anything listed here is NOT behind the session check.
//   api/webhooks     — signed by GitHub, verified in the route
//   api/agents/local — Claude Code hooks from developer machines
//   api/cron         — Vercel Cron, guarded by CRON_SECRET in the route
//   api/auth         — the sign-in flow itself
// Everything else requires a signed-in user.
export const config = {
  matcher: [
    "/((?!api/webhooks|api/agents/local|api/cron|api/auth|_next/static|_next/image|favicon.ico|login).*)",
  ],
};
