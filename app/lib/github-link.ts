// Connecting a person's own GitHub account.
//
// The GitHub login is the attribution key: issues are assigned by it, and every
// branch, commit and pull request is counted against it. Typed by hand, a
// login can be mistyped or can name somebody else. Connected here, it is the
// login GitHub says belongs to whoever just signed in to it, so it is neither.
//
// The OAuth exchange asks for no scopes — public profile only — and the token
// it returns is used once to read the login and then dropped. Ops acts on
// GitHub with GH_DISPATCH_TOKEN, never with a person's own token.

import { sql } from "@/lib/db";

export const STATE_COOKIE = "gh_link_state";

/** What the Board says after a connect attempt, keyed by the code in ?github=. */
export const LINK_RESULT: Record<string, { ok: boolean; text: string }> = {
  linked: { ok: true, text: "Your GitHub account is connected. You can now start tasks and be assigned them." },
  unchanged: { ok: true, text: "That GitHub account was already connected to you. Nothing changed." },
  denied: { ok: false, text: "GitHub sign-in was cancelled, so nothing was connected. Press Connect GitHub to try again." },
  state: { ok: false, text: "The GitHub sign-in expired or was started in another tab, so it was not trusted. Press Connect GitHub again." },
  exchange: { ok: false, text: "GitHub did not confirm the sign-in, so nothing was connected. Try again; if it repeats, check GITHUB_CLIENT_SECRET in Vercel." },
  taken: { ok: false, text: "That GitHub account is already connected to another Ops account. Ask the founder or CTO to unlink it on the Admin page first." },
  outside: { ok: false, text: "That GitHub account is not a member of the organisation, so it can't be assigned issues. Ask an owner to invite it on GitHub, accept the invite, then connect again." },
  check: { ok: false, text: "Ops couldn't check the organisation's members on GitHub, so nothing was connected. Try again in a minute." },
  setup: { ok: false, text: "Connecting GitHub isn't set up yet: GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are not set in Vercel." },
};

export function oauthApp(): { id: string; secret: string } | null {
  const id = process.env.GITHUB_CLIENT_ID?.trim(), secret = process.env.GITHUB_CLIENT_SECRET?.trim();
  return id && secret ? { id, secret } : null;
}

/** Is `login` a member of GH_ORG? Asked with the platform's token, which an org owner holds. */
export async function inOrg(login: string): Promise<boolean> {
  const org = (process.env.GH_ORG || "").trim();
  if (!org) throw new Error("GH_ORG is not set, so membership can't be checked.");
  // redirect: manual — GitHub answers 302 to a caller it won't show private
  // membership to, and following it would quietly ask a different question
  // (public membership) and treat a private member as an outsider.
  const res = await fetch(`https://api.github.com/orgs/${org}/members/${encodeURIComponent(login)}`, {
    redirect: "manual",
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
    headers: {
      Authorization: `Bearer ${process.env.GH_DISPATCH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (res.status === 204) return true;
  if (res.status === 404) return false;
  throw new Error(`GitHub answered ${res.status} when asked whether @${login} is in ${org}.`);
}

/**
 * Sets the person's own login, with a line in role_change like any other
 * change to an account — the actor is the person themselves.
 */
export async function linkLogin(userId: string, login: string): Promise<"linked" | "unchanged" | "taken"> {
  return sql.begin(async (tx) => {
    const [me] = await tx<{ gh_login: string | null }[]>`select gh_login from app_user where id = ${userId} for update`;
    if (!me) throw new Error("This Ops account no longer exists.");
    if (me.gh_login === login) return "unchanged" as const;
    const [other] = await tx<{ id: string }[]>`
      select id from app_user where lower(gh_login) = lower(${login}) and id <> ${userId}`;
    if (other) return "taken" as const;
    await tx`update app_user set gh_login = ${login} where id = ${userId}`;
    await tx`
      insert into role_change (subject_id, actor_id, changed)
      values (${userId}, ${userId}, ${tx.json({ gh_login: { from: me.gh_login, to: login }, via: "connected on GitHub" } as any)})`;
    return "linked" as const;
  });
}
