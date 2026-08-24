// Module augmentation for the fields auth.ts puts on the session and the token.
//
// Google signs you in, but attribution lives in git: a commit is signed by a
// GitHub login and CODEOWNERS is a list of GitHub logins. So the session
// carries both identities, and `login` is nullable on purpose — a non-technical
// account has no GitHub identity and must not be able to own work. Typing it as
// `string | null` is what makes the check in /api/agents/run a type error to
// forget rather than a runtime surprise.

import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  /**
   * Session["user"] resolves to User & DefaultSession["user"], so augmenting
   * User here is what makes session.user.login typecheck at the call sites.
   */
  interface User {
    /** GitHub login. Null until the account is linked. The attribution key. */
    login?: string | null;
    /** member | lead | cto | founder */
    role?: string;
    /** week1 | week2 | full — gates which agents may be dispatched. */
    tier?: string;
    /** platform | eldercare-ev | spatial-apps */
    pod?: string | null;
  }

  interface Session {
    user: {
      id?: string;
    } & User &
      DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    /** app_user.id. Named uid on the token, surfaced as user.id on the session. */
    uid?: string;
    login?: string | null;
    role?: string;
    tier?: string;
    pod?: string | null;
  }
}
