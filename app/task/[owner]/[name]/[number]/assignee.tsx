"use client";

// Who owns this task, and the one control that changes it.
//
// The rules live in app/lib/assign.ts and are applied by the route. This
// component asks the same functions what to offer, so a button never appears
// where the route would refuse it — and a refusal, when one happens anyway,
// arrives in the route's own words rather than being guessed at here.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { canAssign, type Actor } from "@/app/lib/assign";

type Props = {
  href: string;                                   // /api/tasks/<owner>/<name>/<n>
  current: string | null;
  actor: Actor;
  /** Everyone who could hold this task. Empty unless the viewer may assign. */
  people: { name: string | null; gh_login: string }[];
};

export default function Assignee({ href, current, actor, people }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [picking, setPicking] = useState(false);

  async function set(to: string | null) {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(href, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "assign", to }),
      });
      if (!res.headers.get("content-type")?.includes("json")) {
        setErr("Your session has expired. Reload the page to sign in again.");
        return;
      }
      const out = await res.json();
      if (!res.ok) { setErr(out.error); return; }
      setPicking(false);
      router.refresh();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const mine = !!actor.login && current?.toLowerCase() === actor.login.toLowerCase();
  const canTake = !canAssign(actor, current, actor.login);
  const canHandBack = !canAssign(actor, current, null);
  const canGive = people.length > 0;

  return (
    <div className="assignee">
      <div className="who-has">
        <span className="muted small">Owner</span>
        <b>{current ? `@${current}` : "nobody yet"}</b>
        {mine && <span className="tag on">you</span>}
      </div>

      <div className="acts">
        {canTake && !mine && (
          <button className="go" disabled={busy} onClick={() => set(actor.login)}>
            {busy ? "…" : "Take it"}
          </button>
        )}
        {canHandBack && current && (
          <button className="flat" disabled={busy} onClick={() => set(null)}>
            {mine ? "Hand it back" : "Unassign"}
          </button>
        )}
        {canGive && !picking && (
          <button className="flat" disabled={busy} onClick={() => setPicking(true)}>
            {current ? "Reassign" : "Assign to…"}
          </button>
        )}
        {canGive && picking && (
          <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <select
              defaultValue=""
              disabled={busy}
              onChange={(e) => e.target.value && set(e.target.value)}
            >
              <option value="" disabled>Choose a person</option>
              {people.map((p) => (
                <option key={p.gh_login} value={p.gh_login}>
                  {p.name ? `${p.name} — @${p.gh_login}` : `@${p.gh_login}`}
                </option>
              ))}
            </select>
            <button className="flat" disabled={busy} onClick={() => setPicking(false)}>Back</button>
          </span>
        )}
      </div>

      {!actor.login && (
        <p className="muted small" style={{ margin: 0 }}>
          Link your GitHub account to take work. A task is owned by a git
          identity — commits, reviews and CODEOWNERS all match on it.
        </p>
      )}
      {err && <div className="error">{err}</div>}
    </div>
  );
}
