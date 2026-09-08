// The first screen anybody sees, and the only one they see signed out.
//
// One sentence and one button. There is nothing to choose here — Google is the
// only way in — so anything else on this page would be decoration in front of a
// door.

import { signIn } from "@/auth";
import { BASE_CSS } from "@/app/ui/base-css";

/**
 * What a failed sign-in is allowed to say.
 *
 * Auth.js hands us a code in ?error=. Only some of these are about the person;
 * the rest are the platform failing, and telling the two apart is the whole
 * point — "Access Denied" was once shown for a database that no longer existed.
 *
 * Anything not listed here falls through to a message that still names the code
 * rather than swallowing it.
 */
const SIGNIN_ERRORS: Record<string, { title: string; detail: string }> = {
  // Ours: the signIn callback could not reach the database. Auth.js maps every
  // non-allowlisted AuthError to this code — see SignInUnavailable in auth.ts.
  Configuration: {
    title: "Sign-in is unavailable",
    detail:
      "The platform could not reach its database, so it could not check your account. This is not a problem with your account, and signing in again will not help until the database is back. Check /api/health — it names what is failing.",
  },
  AccessDenied: {
    title: "You do not have permission to sign in",
    detail:
      "Google did not return an email address for this account. Use your work Google account.",
  },
  Verification: {
    title: "That sign-in link has expired",
    detail: "Start again from this page.",
  },
  OAuthAccountNotLinked: {
    title: "That email is already here under a different provider",
    detail: "Sign in the way you did the first time.",
  },
  OAuthCallbackError: {
    title: "Google did not complete the sign-in",
    detail:
      "This is usually a redirect URI that does not match the one registered in Google Cloud Console.",
  },
};

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const failure = error
    ? SIGNIN_ERRORS[error] ?? {
        title: "Sign-in failed",
        detail: `Auth.js reported "${error}". The server logs carry the cause.`,
      }
    : null;

  return (
    <main className="signin">
      <div className="panel">
        <h1>iHelp Ops</h1>
        <p className="lede">
          Where work is started, tracked and proven.
        </p>

        {failure && (
          <div className="failure" role="alert">
            <strong>{failure.title}</strong>
            <span>{failure.detail}</span>
          </div>
        )}

        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/" });
          }}
        >
          <button className="go">Continue with Google</button>
        </form>

        <p className="foot">
          Use your work Google account. Your account is created the first time
          you sign in.
        </p>
      </div>

      <style dangerouslySetInnerHTML={{ __html: LOGIN_CSS }} />
    </main>
  );
}

const LOGIN_CSS = `
${BASE_CSS}
  .signin {
    min-height: 100vh; display: grid; place-items: center;
    padding: 24px; background: var(--ground);
  }
  .panel {
    background: var(--surface); border-radius: 18px; box-shadow: var(--shadow);
    padding: 40px 36px; width: 100%; max-width: 380px; text-align: center;
  }
  .panel h1 { font-size: 28px; margin: 0 0 6px; }
  .panel .lede { color: var(--ink-2); font-size: 15px; margin: 0 0 28px; }
  .panel .failure {
    display: grid; gap: 6px; text-align: left;
    background: var(--danger-bg); color: var(--danger);
    border-radius: var(--radius-sm); padding: 14px 16px; margin: 0 0 24px;
    font-size: 13px; line-height: 1.5;
  }
  .panel .failure strong { font-size: 14px; }
  .panel .failure span { color: var(--ink-2); }
  .panel .go { width: 100%; min-height: 46px; font-size: 16px; }
  .panel .foot {
    color: var(--ink-3); font-size: 13px; line-height: 1.45;
    margin: 20px 0 0; text-wrap: balance;
  }
`;
