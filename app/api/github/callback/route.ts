// GET /api/github/callback
//
// Where GitHub sends the person back. Checks the attempt is theirs, asks GitHub
// which account signed in, checks that account is in the organisation, and
// saves it. Every outcome lands on the Board with a message that says what
// happened (LINK_RESULT), never a bare error page.

import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { auth } from "@/auth";
import { inOrg, linkLogin, oauthApp, STATE_COOKIE } from "@/app/lib/github-link";

export const dynamic = "force-dynamic";

const same = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function GET(req: Request) {
  const url = new URL(req.url), origin = url.origin;
  const done = (code: string) => {
    const res = NextResponse.redirect(`${origin}/?github=${code}`);
    res.cookies.set(STATE_COOKIE, "", { path: "/api/github", maxAge: 0 });
    return res;
  };

  const session = await auth();
  if (!session?.user?.id) return NextResponse.redirect(`${origin}/login`);
  if (url.searchParams.get("error")) return done("denied");

  const [want, uid] = (req.headers.get("cookie") || "")
    .split(/;\s*/).find((c) => c.startsWith(`${STATE_COOKIE}=`))?.slice(STATE_COOKIE.length + 1).split(".") ?? [];
  const got = url.searchParams.get("state") || "", code = url.searchParams.get("code") || "";
  if (!want || !got || !code || !same(want, got) || uid !== session.user.id) return done("state");

  const app = oauthApp();
  if (!app) return done("setup");

  // The person's token is used for this one read and never stored.
  let login: string;
  try {
    const tok = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: app.id, client_secret: app.secret, code, redirect_uri: `${origin}/api/github/callback` }),
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    }).then((r) => r.json());
    if (!tok?.access_token) {
      console.error("github connect: token exchange refused", tok?.error, tok?.error_description);
      return done("exchange");
    }
    const me = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${tok.access_token}`, Accept: "application/vnd.github+json" },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    }).then((r) => r.json());
    if (typeof me?.login !== "string") return done("exchange");
    login = me.login;
  } catch (e: any) {
    console.error("github connect: GitHub unreachable", e?.message);
    return done("exchange");
  }

  try {
    if (!(await inOrg(login))) return done("outside");
  } catch (e: any) {
    console.error("github connect: membership check failed", e?.message);
    return done("check");
  }

  return done(await linkLogin(session.user.id, login));
}
