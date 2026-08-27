"use client";

// The buttons. Everything else on this page is a server component, because
// everything else is a fact being read rather than an action being taken.
//
// Each action posts to /api/tasks/[number] and then calls router.refresh(),
// which re-runs the server component against GitHub. Nothing here keeps its own
// idea of the task's state: the state is what GitHub says a moment after the
// call, not what this component hoped would happen.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Props = {
  number: number;
  hasBranch: boolean;
  branch: string | null;
  prNumber: number | null;
  prState: "no-pr" | "open" | "merged" | null;
  canAct: boolean;
  whyNot: string | null;
};

export default function TaskActions(props: Props) {
  const { number, hasBranch, branch, prNumber, prState, canAct, whyNot } = props;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [said, setSaid] = useState("");
  const [comment, setComment] = useState("");

  async function post(action: string, extra: Record<string, unknown> = {}) {
    setErr(""); setSaid(""); setBusy(action);
    try {
      const res = await fetch(`/api/tasks/${number}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      // A session that expired while this tab was open is answered by the
      // middleware with the login page. Calling .json() on HTML throws
      // "Unexpected token '<'", which describes a parser and not the problem.
      if (res.redirected || !res.headers.get("content-type")?.includes("json")) {
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
