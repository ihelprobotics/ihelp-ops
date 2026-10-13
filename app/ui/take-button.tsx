"use client";

// Taking a task from the board, without opening it first.
//
// The same POST the task page's owner control sends. On success the server
// component re-renders — the route drops the cached read of this repository, so
// the card comes back with your name on it rather than saying nobody has it for
// another thirty seconds, which reads as the button not working.

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function TakeButton({ repo, number, login }: { repo: string; number: number; login: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function take() {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(`/api/tasks/${repo}/${number}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "assign", to: login }),
      });
      // An expired session is answered with the sign-in page, not JSON.
      if (res.redirected || !res.headers.get("content-type")?.includes("json")) {
        setErr("Your session has expired. Reload the page to sign in again.");
        return;
      }
      const out = await res.json();
      if (!res.ok) {
        setErr(out.error ?? `Taking it failed with ${res.status}.`);
        return;
      }
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="take" disabled={busy} onClick={take}>
        {busy ? "Taking…" : "Take it"}
      </button>
      {err && <p className="take-err">{err}</p>}
    </>
  );
}
