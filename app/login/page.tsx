// The first screen anybody sees, and the only one they see signed out.
//
// One sentence and one button. There is nothing to choose here — Google is the
// only way in — so anything else on this page would be decoration in front of a
// door.

import { signIn } from "@/auth";
import { BASE_CSS } from "@/app/ui/base-css";

export default function Login() {
  return (
    <main className="signin">
      <div className="panel">
        <h1>iHelp Ops</h1>
        <p className="lede">
          Where work is started, tracked and proven.
        </p>

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
  .panel .go { width: 100%; min-height: 46px; font-size: 16px; }
  .panel .foot {
    color: var(--ink-3); font-size: 13px; line-height: 1.45;
    margin: 20px 0 0; text-wrap: balance;
  }
`;
