"use client";

// One person, editable. Nothing is saved until Save is pressed, and the row
// says plainly when it has unsaved changes — a control that writes on every
// keystroke turns a mistyped GitHub login into a live one.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ROLES, TIERS } from "@/app/lib/roles";

export type Person = {
  id: string;
  name: string | null;
  email: string | null;
  gh_login: string | null;
  role: string;
  agent_tier: string;
  pod: string | null;
  lead_email: string | null;
  active: boolean;
};

export default function PersonRow({ person, isSelf }: { person: Person; isSelf: boolean }) {
  const router = useRouter();
  const [draft, setDraft] = useState({
    role: person.role,
    agent_tier: person.agent_tier,
    pod: person.pod ?? "",
    lead_email: person.lead_email ?? "",
    gh_login: person.gh_login ?? "",
    active: person.active,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const dirty =
    draft.role !== person.role ||
    draft.agent_tier !== person.agent_tier ||
    draft.pod !== (person.pod ?? "") ||
    draft.lead_email !== (person.lead_email ?? "") ||
    draft.gh_login !== (person.gh_login ?? "") ||
    draft.active !== person.active;

  const set = (k: string, v: any) => { setDraft((d) => ({ ...d, [k]: v })); setOk(""); setErr(""); };

  async function save() {
    setBusy(true); setErr(""); setOk("");
    try {
      const res = await fetch(`/api/admin/people/${person.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.headers.get("content-type")?.includes("json")) {
        setErr("Your session has expired. Reload the page to sign in again.");
        return;
      }
      const out = await res.json();
      if (!res.ok) { setErr(out.error); return; }
      setOk(out.message);
      router.refresh();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={"prow" + (person.active ? "" : " off")}>
      <div className="pid">
        <b>{person.name ?? person.email ?? "unnamed"}</b>
        <span>{person.email}</span>
        {isSelf && <span className="tag on">you</span>}
      </div>

      {isSelf ? (
        <p className="muted small" style={{ margin: 0, gridColumn: "2 / -1" }}>
          You cannot change your own row. Another admin can — which is the point:
          a role change should be something somebody else agreed to.
        </p>
      ) : (
        <>
          <div className="fields">
            <span className="field">
              <label>Role</label>
              <select value={draft.role} disabled={busy} onChange={(e) => set("role", e.target.value)}>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </span>
            <span className="field">
              <label>Agent tier</label>
              <select value={draft.agent_tier} disabled={busy} onChange={(e) => set("agent_tier", e.target.value)}>
                {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </span>
            <span className="field">
              <label>GitHub login</label>
              <input value={draft.gh_login} disabled={busy} placeholder="none — cannot own work"
                     onChange={(e) => set("gh_login", e.target.value)} style={{ width: 150 }} />
            </span>
            <span className="field">
              <label>Pod</label>
              <input value={draft.pod} disabled={busy} placeholder="none"
                     onChange={(e) => set("pod", e.target.value)} style={{ width: 130 }} />
            </span>
            <span className="field">
              <label>Lead&apos;s email</label>
              <input value={draft.lead_email} disabled={busy} placeholder="the CTO decides"
                     onChange={(e) => set("lead_email", e.target.value)} style={{ width: 200 }} />
            </span>
            <span className="field">
              <label>Active</label>
              <input type="checkbox" checked={draft.active} disabled={busy}
                     onChange={(e) => set("active", e.target.checked)} style={{ width: 16, height: 16 }} />
            </span>
            <button className="go" disabled={busy || !dirty} onClick={save}>
              {busy ? "Saving…" : dirty ? "Save" : "Saved"}
            </button>
          </div>
          {err && <div className="error" style={{ gridColumn: "2 / -1" }}>{err}</div>}
          {ok && <div className="ok" style={{ gridColumn: "2 / -1" }}>{ok}</div>}
        </>
      )}
    </div>
  );
}
