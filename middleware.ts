export { auth as middleware } from "@/auth";

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
