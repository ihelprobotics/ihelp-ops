"use client";

// The buttons. Everything else on this page is a server component, because
// everything else is a fact being read rather than an action being taken.
//
// Each action posts to `href` and then calls router.refresh(),
// which re-runs the server component against GitHub. Nothing here keeps its own
// idea of the task's state: the state is what GitHub says a moment after the
// call, not what this component hoped would happen.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Props = {
  /**
   * Where the actions post — `/api/tasks/<owner>/<name>/<n>`, built by the page
   * that already knows all three.
   *
   * This was `/api/tasks/${number}` until it was not. The route moved under
   * [owner]/[name] when the platform grew past one repository, and the board
   * and the assignee picker were both updated; this component was missed, so
   * every button in this card posted to a path matching no route. Next answered
   * with its HTML 404 page, the non-JSON branch below read that as a login
   * page, and the card reported "Your session has expired" — which sent people
   * to sign in again, repeatedly, on a session that was never the problem.
   *
   * The path is handed in rather than assembled here for the same reason
   * assignee.tsx takes one: two components deriving the same URL is two places
   * for it to drift, and this is what that drift looks like.
   */
  href: string;
  number: number;
  hasBranch: boolean;
  branch: string | null;
  prNumber: number | null;
  prState: "no-pr" | "open" | "merged" | null;
  canAct: boolean;
  whyNot: string | null;
};

export default function TaskActions(props: Props) {
  const { href, number, hasBranch, branch, prNumber, prState, canAct, whyNot } = props;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [said, setSaid] = useState("");
  const [comment, setComment] = useState("");

  async function post(action: string, extra: Record<string, unknown> = {}) {
    setErr(""); setSaid(""); setBusy(action);
    try {
      const res = await fetch(href, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });

      const json = res.headers.get("content-type")?.includes("json");

      // An expired session is answered by the middleware with the login page,
      // and calling .json() on HTML throws "Unexpected token '<'" — a parser
      // error that describes nothing anybody can act on. So HTML is caught. But
      // it is only an expired session when the server is *redirecting*: a 404
      // is also HTML, and reading one as a login page is how a route that had
      // moved spent weeks telling people to sign in again.
      if (!json && res.status === 404) {
        setErr(`No route answered ${href}. That is a bug in this page, not something you can fix by signing in again — the address it posts to does not exist on the server.`);
        return;
      }
      if (res.redirected || !json) {
        setErr("Your session has expired. Reload the page to sign in again.");
        return;
      }
      const data = await res.json();
      if (!res.ok) { setErr(data.error ?? `The request failed with ${res.status}.`); return; }
      setSaid(data.message ?? "Done.");
      if (action === "comment") setComment("");
      startTransition(() => router.refresh());
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }

  const working = busy !== null || pending;

  return (
    <div className="acts">
      {!canAct && <p className="muted small">{whyNot}</p>}

      {canAct && (
        <div className="row">
          {!hasBranch && (
            <button className="go" disabled={working} onClick={() => post("start")}>
              {busy === "start" ? "Creating the branch…" : "Start task"}
            </button>
          )}
          {hasBranch && prState === "no-pr" && (
            <button className="go" disabled={working} onClick={() => post("pr", { branch })}>
              {busy === "pr" ? "Opening…" : "Open pull request"}
            </button>
          )}
          {prState === "open" && prNumber != null && (
            <button className="go" disabled={working} onClick={() => post("merge", { pr_number: prNumber })}>
              {busy === "merge" ? "Merging…" : `Merge #${prNumber}`}
            </button>
          )}
          {prState === "merged" && <span className="muted small">Merged. Nothing left to do here.</span>}
        </div>
      )}

      {prState === "open" && canAct && (
        <p className="muted small">
          Merge calls the GitHub API and can be refused. A refusal is branch
          protection doing its job — a required review or check is missing.
        </p>
      )}

      {canAct && (
        <form
          className="say"
          onSubmit={(e) => { e.preventDefault(); post("comment", { body: comment }); }}
        >
          <textarea
            rows={3}
            value={comment}
            placeholder="Comment. It is posted to the GitHub issue, signed with your login — this page does not keep a second copy."
            onChange={(e) => setComment(e.target.value)}
          />
          <button className="go" type="submit" disabled={working || !comment.trim()}>
            {busy === "comment" ? "Posting…" : "Comment on the issue"}
          </button>
        </form>
      )}

      {err && <div className="error">{err}</div>}
      {said && <p className="ok small">{said}</p>}

      {/* Layout only. Buttons, inputs and messages take their appearance from
          the shell in app/ui/base-css.ts — this component used to restate all
          three in the old dark palette, which is how it ended up with a black
          textarea on a white page after the redesign. A component that repaints
          a shared control is a component that will be missed next time. */}
      <style jsx>{`
        .acts { display: flex; flex-direction: column; gap: 12px; align-items: flex-start; }
        .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
        .say { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; width: 100%; }
      `}</style>
    </div>
  );
}
