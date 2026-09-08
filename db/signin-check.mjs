#!/usr/bin/env node
// Telling a refusal apart from a failure, on the sign-in screen.
//
//   npm run test:signin                    (against a local `npm run dev`)
//   PAGE_URL=https://<domain> npm run test:signin
//
// Two parts:
//
//   A. The mapping, against @auth/core's own error classes and allowlist.
//   B. What /login actually renders for each code Auth.js can send it.
//
// This exists because of a real morning lost: the Supabase project behind
// DATABASE_URL was deleted, and every sign-in answered "You do not have
// permission to sign in". The account was fine. Auth.js rewrites any throw from
// the signIn callback into AccessDenied, so an outage arrived wearing the
// clothes of a decision about the person — on the one screen where the reader
// is not signed in and cannot go and find a better error anywhere else.
//
// Part A asserts against the classes the application actually throws, not a
// copy: SignInUnavailable is imported from app/lib/signin-error.ts, which is
// the module auth.ts imports. A restatement here would keep passing after the
// shipped one changed.

const { AuthError, AccessDenied, isClientError } = await import("@auth/core/errors");
const { SignInUnavailable } = await import("../app/lib/signin-error.ts");
const { authConfig } = await import("../auth.config.ts");

const BASE = (process.env.PAGE_URL || "http://localhost:3000").replace(/\/$/, "");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Refusing to run: Part B renders a real page from a real server, and a check that passes without one proves nothing.");
  process.exit(1);
}

let bad = 0;
const is = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(58)} ${JSON.stringify(got)}${ok ? "" : `   expected ${JSON.stringify(want)}`}`);
};
const shows = (label, html, mustContain) => {
  const ok = typeof html === "string" && html.includes(mustContain);
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(58)} ${ok ? '"' + mustContain.slice(0, 44) + '"' : `missing "${mustContain.slice(0, 44)}"`}`);
};
const hides = (label, html, mustNotContain) => {
  const ok = typeof html === "string" && !html.includes(mustNotContain);
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(58)} ${ok ? "absent" : `present: "${mustNotContain.slice(0, 40)}"`}`);
};

// =========================================================================
console.log("\n— a failure and a refusal are different things —");
// =========================================================================

// This is @auth/core/lib/actions/callback/index.js, the branch that caused the
// bug. Reproduced rather than imported because it is not exported; the classes
// it switches on are the real ones.
const throughCallback = (fn) => {
  try {
    const authorized = fn();
    if (!authorized) return new AccessDenied("AccessDenied");
    return null;
  } catch (e) {
    if (e instanceof AuthError) return e;
    return new AccessDenied(e);
  }
};
// And @auth/core/index.js, where the code that reaches the browser is chosen.
const surfaced = (err) => (isClientError(err) ? err.type : "Configuration");

is("SignInUnavailable is an AuthError", new SignInUnavailable("x") instanceof AuthError, true);
is("so the callback re-throws it untouched",
   throughCallback(() => { throw new SignInUnavailable("db gone"); })?.constructor.name, "SignInUnavailable");
is("a bare Error is rewritten to AccessDenied",
   throughCallback(() => { throw new Error("db gone"); })?.constructor.name, "AccessDenied");
is("returning false is AccessDenied",
   throughCallback(() => false)?.constructor.name, "AccessDenied");

is("SignInUnavailable is not client-safe", isClientError(new SignInUnavailable("x")), false);
is("so the browser is told Configuration",
   surfaced(throughCallback(() => { throw new SignInUnavailable("db gone"); })), "Configuration");
is("a real refusal still says AccessDenied",
   surfaced(throughCallback(() => false)), "AccessDenied");

// The regression this whole change exists to prevent: before it, a database
// outage and a person with no email produced the identical code.
const outage = surfaced(throughCallback(() => { throw new SignInUnavailable("db gone"); }));
const refusal = surfaced(throughCallback(() => false));
is("an outage and a refusal no longer look the same", outage === refusal, false);

// Without pages.error the failure lands on Auth.js's own page, which can only
// render the code — which is how "Access Denied" was all anyone ever saw.
is("errors are sent to our own page", authConfig.pages?.error, "/login");
is("and so is signing in", authConfig.pages?.signIn, "/login");

// =========================================================================
console.log("\n— what the screen says —");
// =========================================================================

async function login(query) {
  const res = await fetch(`${BASE}/login${query}`, { redirect: "manual" });
  if (!res.ok) { bad++; console.log(`FAIL /login${query} answered ${res.status}`); return ""; }
  return res.text();
}

const clean = await login("");
hides("a first visit shows no failure at all", clean, "Sign-in is unavailable");
hides("and does not accuse anybody of anything", clean, "do not have permission");
shows("it still offers the only way in", clean, "Continue with Google");

const config = await login("?error=Configuration");
shows("a dead database says sign-in is unavailable", config, "Sign-in is unavailable");
shows("and names the database as the cause", config, "could not reach its database");
shows("and says it is not about your account", config, "not a problem with your account");
shows("and sends you where the answer is", config, "/api/health");
hides("and does not say you lack permission", config, "do not have permission to sign in");

const denied = await login("?error=AccessDenied");
shows("a real refusal still says so", denied, "do not have permission to sign in");
shows("and says what was missing", denied, "did not return an email address");

const oauth = await login("?error=OAuthCallbackError");
shows("a Google failure names Google", oauth, "Google did not complete the sign-in");
shows("and points at the redirect URI", oauth, "redirect URI");

const verification = await login("?error=Verification");
shows("an expired link says it expired", verification, "expired");

const linked = await login("?error=OAuthAccountNotLinked");
shows("a clashing account explains itself", linked, "already here under a different provider");

// A code nobody anticipated must still reach the reader. Swallowing it is the
// same bug in a different place.
const unknown = await login("?error=NotAThingAuthjsSends");
shows("an unrecognised code is still reported", unknown, "Sign-in failed");
shows("and the code itself is named", unknown, "NotAThingAuthjsSends");

console.log(bad === 0 ? "\nAll good.\n" : `\n${bad} failed.\n`);
process.exit(bad === 0 ? 0 : 1);
