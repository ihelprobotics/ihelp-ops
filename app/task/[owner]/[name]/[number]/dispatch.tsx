"use client";

// Putting an agent to work on this task.
//
// Two ways to run it, both ending in a pull request a human reviews (docs/01):
//
//   Run now                 Path D. The platform runs the agent through the
//                           Claude API, here, in a few minutes. It reads and
//                           writes files through GitHub and cannot run anything,
//                           so nothing is tested until CI runs on the pull request.
//   Run in GitHub Actions   Path A. agent-run.yml runs Claude Code on a throwaway
//                           VM that can install, build and test. Slower; it
//                           reports back when it is done.
//
// The box exists because of a privacy line. The conversation beside this is
// private — one policy clause in db/schema-chat.sql, no admin escape, and
// test:chat proves a founder cannot read an engineer's thread. A run is the
// opposite: the brief lands in the pull request body, where the organisation
// reads it. Sending the transcript automatically would quietly undo the trade
// that lets the platform store what somebody typed at all. So the person writes
// the sentence that gets published, sees that it will be published, and confirms
// it. The conversation itself never leaves.
//
// The brief is optional. The issue is the task; the box only narrows it. It used
// to be required, which meant an agent could not be put on a task until you had
// talked to it first.

import { useState } from "react";
import { BRIEF_LIMIT, agentName, canDispatch } from "@/app/lib/agents";
import RunLive from "./run-live";

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
  /** A receipt line for the conversation. */
  onDispatched: (line: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // The run happening on this page, if any. Holds its own agent, so picking a
  // different tile mid-run does not relabel — or unmount — the run in progress.
  const [live, setLive] = useState<{ agent: string; brief: string } | null>(null);
  const [liveDone, setLiveDone] = useState(false);

  const who = agentName(agent);
  const allowed = canDispatch(agent, me);
  // A linked GitHub login is required to run an agent — the same rule that
  // gates starting a task. Checked here so the reason appears before the click
  // rather than as a refusal after it.
  const unlinked = me && !me.login;

  if (live) {
    return (
      <div className="dispatch-live">
        <RunLive
          owner={owner}
          name={name}
          issue={issue}
          agent={live.agent}
          brief={live.brief}
          onFinished={(receipt) => { setLiveDone(true); onDispatched(receipt); }}
        />
        {liveDone && (
          <button type="button" className="flat" onClick={() => { setLive(null); setBrief(""); }}>
            Close
          </button>
        )}
      </div>
    );
  }

  async function viaActions() {
    if (busy) return;
    const text = brief.trim();
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/agents/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent, repo: `${owner}/${name}`, issue, brief: text }),
      });
      // The middleware answers an expired session with the login page, and
      // calling .json() on HTML reports a parser error instead of the problem.
      if (res.redirected || !res.headers.get("content-type")?.includes("json")) {
        setErr("Your session has expired. Reload the page to sign in again — nothing was dispatched.");
        return;
      }
      const data = await res.json();
      if (!res.ok) { setErr(data.error ?? `The dispatch failed with ${res.status}.`); return; }

      setOpen(false);
      setBrief("");
      onDispatched(
        `Dispatched ${who} to GitHub Actions${text ? `: “${text}”` : ""}. The run and its pull request appear under “Agent runs” when it reports back.`
      );
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  if (unlinked) {
    return (
      <p className="muted small dispatch-why">
        Link your GitHub account to run an agent. Runs are attributed by GitHub
        login, and the pull request is opened in your name.
      </p>
    );
  }

  if (!allowed.ok) {
    return <p className="muted small dispatch-why">{allowed.why}</p>;
  }

  if (!open) {
    return (
      <div className="dispatch">
        <button
          className="go"
          type="button"
          onClick={() => { setBrief(suggested.slice(0, BRIEF_LIMIT)); setErr(""); setOpen(true); }}
        >
          {`Have ${who} do this`}
        </button>
        <span className="muted small">Runs it on this task and opens a pull request for you to review.</span>
      </div>
    );
  }

  const over = brief.length > BRIEF_LIMIT;

  return (
    <div className="dispatch-box">
      <p className="warn small">
        <strong>What you write here is published.</strong> It is quoted in the
        pull request, where anyone in the organisation can read it. The rest of
        your conversation stays private.
      </p>

      <textarea
        rows={3}
        value={brief}
        disabled={busy}
        autoFocus
        placeholder={`Optional — narrow what ${who} should do. Leave it empty to work from the issue as written.`}
        onChange={(e) => setBrief(e.target.value)}
      />

      <div className="dispatch-foot">
        <span className={over ? "over small" : "muted small"}>{`${brief.length} / ${BRIEF_LIMIT}`}</span>
        <div className="dispatch-go">
          <button type="button" className="flat" disabled={busy} onClick={() => setOpen(false)}>
            Cancel
          </button>
          <button type="button" className="flat" disabled={busy || over} onClick={viaActions}>
            {busy ? "Dispatching…" : "Run in GitHub Actions"}
          </button>
          <button
            type="button"
            className="go"
            disabled={busy || over}
            onClick={() => { setLiveDone(false); setLive({ agent, brief: brief.trim() }); setOpen(false); }}
          >
            Run now
          </button>
        </div>
      </div>

      <p className="muted small">
        <strong>Run now</strong> works here through the Claude API, usually in one
        to four minutes; it reads and writes files but cannot run tests.{" "}
        <strong>GitHub Actions</strong> runs Claude Code on a machine that can
        build and test, takes longer, and reports back under Agent runs. Either
        way the issue is still the task — this box narrows it and cannot
        authorise work the issue does not cover.
      </p>

      {err && <div className="error">{err}</div>}
    </div>
  );
}
