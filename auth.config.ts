// Edge-safe auth configuration.
//
// This file must never import lib/db.ts, or anything that reaches it. Next.js
// compiles middleware for the edge runtime, where Node's `net` module does not
// exist — and postgres.js opens a TCP socket. Importing the database here is
// what produced "the edge runtime does not support Node.js 'net'": the error
// surfaced at sign-in, but the cause was the import graph, not the sign-in.
//
// So the config splits in two. What middleware needs to decide "is this request
// allowed" lives here and touches nothing. What needs the database — looking a
// person up, putting their role and tier on the token — lives in auth.ts, which
// only ever runs in the Node runtime.

import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

export const authConfig = {
  providers: [Google],
  // Ours, not NextAuth's built-in sign-in page.
  pages: { signIn: "/login" },
  callbacks: {
    // The callback middleware consults. Returning false redirects to
    // pages.signIn. Without it the middleware authenticates a request and then
    // permits it either way, so a signed-out visitor gets the dashboard shell
    // with every fetch inside it failing.
    authorized({ auth }) {
      return !!auth?.user;
    },
  },
} satisfies NextAuthConfig;
