"use client";

// Turning a conversation into a run.
//
// The chat beside this can read the repository and nothing else — it cannot
// edit, commit or open a pull request, and docs/01 explains why: an agent that
// believes it can write code describes edits as though it has made them, and
// the reader believes it. So the conversation is where you work out what should
// change, and this is where you ask for it to actually happen: a real dispatch
// of agent-run.yml, on a throwaway VM, ending in a pull request a human reviews.
//
// The box exists because of a privacy line. The conversation is private — one
// policy clause in db/schema-chat.sql, no admin escape, and test:chat proves a
// founder cannot read an engineer's thread. A run is the opposite: the brief
// lands in the Actions log and the pull request body, where the organisation
// reads it. Sending the transcript automatically would quietly undo the trade
// that lets the platform store what somebody typed at all. So the person writes
// the sentence that gets published, sees that it will be published, and confirms
// it. The conversation itself never leaves.

import { useState } from "react";
import { BRIEF_LIMIT, agentName, canDispatch } from "@/app/lib/agents";

export type Me = { login: string | null; role: string | null; tier: string | null } | null;

export default function Dispatch({
  owner, name, issue, agent, suggested, me, onDispatched,
}: {
  owner: string;
  name: string;
  issue: number;
  agent: string;
  /** The last thing the person asked the agent, used as a starting point. */
  suggested: string;
  me: Me;
  onDispatched: (line: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const allowed = canDispatch(agent, me);

  // A linked GitHub login is required to run an agent — the same rule that
  // gates starting a task. Checked here so the reason appears before the click
  // rather than as a 401 after it.
  const unlinked = me && !me.login;

  function begin() {
    setBrief(suggested.slice(0, BRIEF_LIMIT));
    setErr("");
    setOpen(true);
  }

  async function go() {
    const text = brief.trim();
    if (!text || busy) return;
    setBusy(true);
    setErr("");

    try {
      const res = await fetch("/api/agents/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent, repo: `${owner}/${name}`, issue, brief: text }),
      });

      // Same expired-session shape as the chat and the task buttons: the
      // middleware answers with the login page, and calling .json() on HTML
      // reports a parser error instead of the real problem.
      if (res.redirected || !res.headers.get("content-type")?.includes("json")) {
        setErr("Your session has expired. Reload the page to sign in again — nothing was dispatched.");
        return;
      }

      const data = await res.json();
      if (!res.ok) { setErr(data.error ?? `The dispatch failed with ${res.status}.`); return; }

      setOpen(false);
      setBrief("");
      onDispatched(text);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  if (unlinked) {
    return (
      <p className="muted small dispatch-why">
        Link your GitHub account to dispatch an agent. Runs are attributed by
        GitHub login, and the pull request is opened in your name.
      </p>
    );
  }

  if (!allowed.ok) {
    return <p className="muted small dispatch-why">{allowed.why}</p>;
  }

  if (!open) {
    return (
      <div className="dispatch">
        <button className="go" type="button" onClick={begin} disabled={!suggested.trim()}>
          {`Have ${agentName(agent)} do this`}
        </button>
        {!suggested.trim() && (
          <span className="muted small">Ask for something first, then this sends it to a real run.</span>
        )}
      </div>
    );
  }

  const over = brief.length > BRIEF_LIMIT;

  return (
    <div className="dispatch-box">
      <p className="warn small">
        <strong>This is published.</strong> It goes into the run&rsquo;s log and
        the pull request, where anyone in the organisation can read it. The rest
        of this conversation stays private.
      </p>

      <textarea
        rows={3}
        value={brief}
        disabled={busy}
        autoFocus
        placeholder={`What should ${agentName(agent)} change?`}
        onChange={(e) => setBrief(e.target.value)}
      />

      <div className="dispatch-foot">
        <span className={over ? "over small" : "muted small"}>
          {`${brief.length} / ${BRIEF_LIMIT}`}
        </span>
        <div className="row">
          <button type="button" className="flat" disabled={busy} onClick={() => setOpen(false)}>
            Cancel
          </button>
          <button type="button" className="go" disabled={busy || !brief.trim() || over} onClick={go}>
            {busy ? "Dispatching…" : "Dispatch"}
          </button>
        </div>
      </div>

      <p className="muted small">
        The issue is still the task. This narrows it — it cannot authorise work
        the issue does not cover.
      </p>

      {err && <div className="error">{err}</div>}
    </div>
  );
}
