// GET /api/github/connect
//
// Sends the signed-in person to GitHub to prove which account is theirs. The
// state cookie ties the answer that comes back to this person and this attempt,
// so a callback started by somebody else — or replayed — is refused.

import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { auth } from "@/auth";
import { oauthApp, STATE_COOKIE } from "@/app/lib/github-link";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await auth();
  const origin = new URL(req.url).origin;
  if (!session?.user?.id) return NextResponse.redirect(`${origin}/login`);

  const app = oauthApp();
  if (!app) return NextResponse.redirect(`${origin}/?github=setup`);

  const state = randomBytes(24).toString("hex");
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", app.id);
  url.searchParams.set("redirect_uri", `${origin}/api/github/callback`);
  url.searchParams.set("state", state);
  url.searchParams.set("allow_signup", "false");
  // No scope: the public profile is all this needs, and asking for more would
  // be a token Ops has no use for.

  const res = NextResponse.redirect(url.toString());
  res.cookies.set(STATE_COOKIE, `${state}.${session.user.id}`, {
    httpOnly: true, secure: origin.startsWith("https:"), sameSite: "lax", path: "/api/github", maxAge: 600,
  });
  return res;
}
