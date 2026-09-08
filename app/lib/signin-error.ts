// The one sign-in failure that is not about the person.
//
// This lives in its own file, and imports AuthError from `@auth/core/errors`
// rather than from `next-auth`, for one reason: `next-auth` reaches
// `next/server`, so anything importing it cannot be loaded outside a Next
// runtime. db/signin-check.mjs has to assert on the class the application
// actually throws — a copy of it in the check would keep passing after the
// shipped one changed, which is the failure mode this repository already found
// once in test:people.
//
// `next-auth` re-exports this exact class from `@auth/core/errors`, so the
// `e instanceof AuthError` branch in @auth/core's callback handler matches it.

import { AuthError } from "@auth/core/errors";

/**
 * We could not find out whether this person is allowed in.
 *
 * Auth.js turns *any* throw from the signIn callback into AccessDenied —
 * @auth/core/lib/actions/callback/index.js:
 *
 *     try { authorized = await signIn(params) }
 *     catch (e) {
 *       if (e instanceof AuthError) throw e
 *       throw new AccessDenied(e)
 *     }
 *
 * So when the Supabase project behind DATABASE_URL was deleted, signing in
 * reported "You do not have permission to sign in" — an outage rendered as a
 * decision about the person. That is the confusion CLAUDE.md rules out: a
 * refusal and a failure are different situations, and reporting them
 * identically sends people to ask for access they already have instead of to
 * the database.
 *
 * Being an AuthError is what stops the rewrite: the branch above re-throws it
 * untouched. The type is deliberately NOT in @auth/core's `clientErrors`
 * allowlist, so the browser is told `Configuration` — the app is broken, not
 * the person — while the real cause, tenant name and all, is logged
 * server-side by Auth.js's own logger.error.
 */
export class SignInUnavailable extends AuthError {
  static type = "SignInUnavailable";
}
