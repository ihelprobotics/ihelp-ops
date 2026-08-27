"use client";

// Approve, reject, or withdraw. One component, because the three do the same
// thing to the same route and only differ in what they are allowed to say.
//
// A rejection carries a note and the route refuses one without it. That is not
// ceremony: the person reads the note on their own leave page, and "rejected"
// with nothing after it is a decision that gets asked about in person anyway.

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Decide({ id, mine }: { id: string; mine: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [asking, setAsking] = useState(false);

  async function act(action: "approve" | "reject" | "cancel") {
    setBusy(action);
    setErr("");
    try {
      const res = await fetch(`/api/leave/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note }),
      });
      if (!res.headers.get("content-type")?.includes("json")) {
        setErr("Your session has expired. Reload the page to sign in again.");
        return;
      }
      const out = await res.json();
      if (!res.ok) { setErr(out.error); return; }
      router.refresh();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy("");
    }
  }

  if (mine) {
    return (
      <span>
        <button className="flat" disabled={!!busy} onClick={() => act("cancel")}>
          {busy ? "…" : "Withdraw"}
        </button>
        {err && <div className="error">{err}</div>}
      </span>
    );
  }

  return (
    <span>
      {!asking ? (
        <span style={{ display: "flex", gap: 6 }}>
          <button className="go" disabled={!!busy} onClick={() => act("approve")}>
            {busy === "approve" ? "…" : "Approve"}
          </button>
          <button className="flat" disabled={!!busy} onClick={() => setAsking(true)}>Reject</button>
        </span>
      ) : (
        <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why — they will read this"
            style={{ width: 240 }}
          />
          <button className="flat" disabled={!!busy || !note.trim()} onClick={() => act("reject")}>
            {busy === "reject" ? "…" : "Confirm"}
          </button>
          <button className="flat" disabled={!!busy} onClick={() => { setAsking(false); setNote(""); setErr(""); }}>
            Back
          </button>
        </span>
      )}
      {err && <div className="error">{err}</div>}
    </span>
  );
}
