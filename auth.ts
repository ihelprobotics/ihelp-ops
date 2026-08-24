// Node-runtime auth. Routes and pages import from here; middleware never does.
//
// Everything in this file that matters touches the database, which is exactly
// why it cannot be what middleware loads. The edge-safe half lives in
// auth.config.ts and is spread in below.

import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";
import { sql } from "@/lib/db";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  session: { strategy: "jwt" },
  callbacks: {
    ...authConfig.callbacks,

    // Everyone signs in with Google. But attribution lives in git — a commit is
    // signed by a GitHub login, CODEOWNERS is a list of GitHub logins. So the
    // session carries both, and the GitHub one may be null until it is linked.
    async signIn({ user }) {
      if (!user.email) return false;
      await sql`
        insert into app_user (email, name, google_sub)
        values (${user.email}, ${user.name}, ${user.id})
        on conflict (email) do update set name = excluded.name, last_seen_at = now()
      `;
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
