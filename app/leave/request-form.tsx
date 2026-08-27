"use client";

// The booking form. Client-side because it is the one genuinely interactive
// thing on the page — everything else is a fact being read.
//
// It does not validate the dates itself. app/lib/leave.ts holds those rules and
// the route applies them, so a second copy here would be a second opinion, and
// the two would disagree the first time one of them changed. What this does is
// show the answer the server gave, in the server's own words.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LEAVE_KINDS } from "@/app/lib/leave";

const KIND_LABEL: Record<string, string> = {
  planned: "Planned",
  sick: "Sick",
  unpaid: "Unpaid",
  comp_off: "Comp off",
};

export default function RequestForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setErr("");
    setOk("");

    try {
      const res = await fetch("/api/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: data.get("kind"),
          starts_on: data.get("starts_on"),
          ends_on: data.get("ends_on"),
          half_day: data.get("half_day") === "on",
          reason: data.get("reason"),
        }),
      });

      // A session that expired while this tab was open is answered with the
      // sign-in page, and calling .json() on HTML throws about a token at
      // position 0 — which describes a parser, not anything the reader can act on.
      if (!res.headers.get("content-type")?.includes("json")) {
        setErr("Your session has expired. Reload the page to sign in again.");
        return;
      }

      const out = await res.json();
      if (!res.ok) { setErr(out.error); return; }

      setOk(out.message);
      form.reset();
      router.refresh();     // the history list below is server-rendered
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <div className="fields">
        <span className="field">
          <label htmlFor="kind">Kind</label>
          <select id="kind" name="kind" defaultValue="planned">
            {LEAVE_KINDS.map((k) => (
              <option key={k} value={k}>{KIND_LABEL[k] ?? k}</option>
            ))}
          </select>
        </span>
        <span className="field">
          <label htmlFor="starts_on">From</label>
          <input id="starts_on" name="starts_on" type="date" required />
        </span>
        <span className="field">
          <label htmlFor="ends_on">To</label>
          <input id="ends_on" name="ends_on" type="date" required />
        </span>
        <span className="field">
          <label htmlFor="half_day">Half day</label>
          <input id="half_day" name="half_day" type="checkbox" style={{ width: 16, height: 16 }} />
        </span>
        <button className="go" disabled={busy}>{busy ? "Sending…" : "Request"}</button>
      </div>

      <span className="field">
        <label htmlFor="reason">Reason (optional)</label>
        <textarea id="reason" name="reason" placeholder="Only if it helps whoever decides." />
      </span>

      {err && <div className="error">{err}</div>}
      {ok && <div className="ok">{ok}</div>}
    </form>
  );
}
