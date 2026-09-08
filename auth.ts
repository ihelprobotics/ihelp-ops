// Node-runtime auth. Routes and pages import from here; middleware never does.
//
// Everything in this file that matters touches the database, which is exactly
// why it cannot be what middleware loads. The edge-safe half lives in
// auth.config.ts and is spread in below.

import NextAuth, { AuthError } from "next-auth";
import { authConfig } from "@/auth.config";
import { sql } from "@/lib/db";

/**
 * We could not find out whether this person is allowed in.
 *
 * This exists because Auth.js turns *any* throw from the signIn callback into
 * AccessDenied — @auth/core/lib/actions/callback/index.js:
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
 * untouched. "SignInUnavailable" is deliberately not in @auth/core's
 * `clientErrors` allowlist, so the browser is told `Configuration` — the app
 * is broken, not the person — while the real cause, tenant name and all, is
 * logged server-side by Auth.js's own logger.error.
 */
class SignInUnavailable extends AuthError {
  static type = "SignInUnavailable";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  session: { strategy: "jwt" },
  callbacks: {
    ...authConfig.callbacks,

    // Everyone signs in with Google. But attribution lives in git — a commit is
    // signed by a GitHub login, CODEOWNERS is a list of GitHub logins. So the
    // session carries both, and the GitHub one may be null until it is linked.
    async signIn({ user }) {
      // A real refusal: Google returned nobody we can key a person on. This is
      // the only thing on this path that is a decision about the person, and so
      // the only thing that may become AccessDenied.
      if (!user.email) return false;

      try {
        await sql`
          insert into app_user (email, name, google_sub)
          values (${user.email}, ${user.name}, ${user.id})
          on conflict (email) do update set name = excluded.name, last_seen_at = now()
        `;
      } catch (cause) {
        // Not a refusal. We never got as far as deciding.
        //
        // The cause travels in ErrorOptions rather than as the first argument:
        // @auth/core's d.ts declares no constructor of its own, so this is
        // Error's, and Auth.js's logger prints the chain either way.
        throw new SignInUnavailable(
          `Could not reach the database to record the sign-in for ${user.email}.`,
          { cause }
        );
      }

      return true;
    },

    async jwt({ token }) {
      if (!token.email) return token;
      const [u] = await sql`
        select id, gh_login, role, agent_tier, pod from app_user where email = ${token.email}
      `;
      if (u) Object.assign(token, {
        uid: u.id, login: u.gh_login, role: u.role, tier: u.agent_tier, pod: u.pod,
      });
      return token;
    },

    async session({ session, token }) {
      Object.assign(session.user, {
        id: token.uid, login: token.login, role: token.role,
        tier: token.tier, pod: token.pod,
      });
      return session;
    },
  },
});
