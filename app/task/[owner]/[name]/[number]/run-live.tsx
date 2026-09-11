"use client";

// A run through the Claude API, watched while it happens.
//
// What streams here is what the agent does — each file it lists, reads, writes
// or deletes — then the commit and the pull request. Not a percentage: the task
// moves when GitHub reports the branch and the pull request, exactly as it does
// for work from any other path.

import { useEffect, useRef, useState } from "react";
import { agentName } from "@/app/lib/agents";

type Line = { kind: "status" | "tool"; text: string; failed?: boolean };

const VERB: Record<string, string> = {
  list_files: "Listed", read_file: "Read", write_file: "Wrote", delete_file: "Deleted",
};

export default function RunLive({
  owner, name, issue, agent, brief, onFinished,
}: {
  owner: string;
  name: string;
  issue: number;
  agent: string;
  brief: string;
  onFinished: (receipt: string) => void;
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [said, setSaid] = useState("");
  const [landed, setLanded] = useState<any>(null);
  const [done, setDone] = useState<any>(null);
  const [err, setErr] = useState("");
  const [secs, setSecs] = useState(0);
  const began = useRef(false);

  useEffect(() => {
    // Once. A second request here is a second paid run, not a re-render.
    if (began.current) return;
    began.current = true;
    const t0 = Date.now();
    const tick = setInterval(() => setSecs(Math.round((Date.now() - t0) / 1000)), 1000);
    run().finally(() => clearInterval(tick));
  }, []);

  const add = (l: Line) => setLines((ls) => [...ls, l]);
  const addErr = (m: string) => setErr((e) => (e ? `${e}\n\n${m}` : m));

  function handle(ev: string, d: any) {
    if (ev === "started") add({ kind: "status", text: `Started on ${d.branch}.` });
    else if (ev === "status") add({ kind: "status", text: d.line });
    else if (ev === "tool") {
      const verb = VERB[d.name] ?? d.name;
      add({ kind: "tool", failed: !d.ok, text: d.ok ? `${verb} ${d.path || "the repository"}` : `${verb} ${d.path || ""} — ${d.note}` });
      setSaid((s) => (s && !s.endsWith("\n\n") ? `${s}\n\n` : s));
    } else if (ev === "text") setSaid((s) => s + d.delta);
    else if (ev === "landed") setLanded(d);
    else if (ev === "error") addErr(d.error);
    else if (ev === "done") {
      setDone(d);
      const spent = `$${Number(d.cost).toFixed(4)}`;
      onFinished(
        d.pr_url
          ? `${agentName(agent)} ${d.status === "success" ? "finished" : "stopped before finishing"} and opened ${d.pr_url} (${spent}).`
          : `${agentName(agent)} ran through the Claude API and opened no pull request — ${d.status === "no_changes" ? "it changed nothing, and said so on the issue" : "see the errors above"} (${spent}).`
      );
    }
  }

  async function run() {
    try {
      const res = await fetch("/api/agents/direct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner, name, issue, agent, brief }),
      });
      const type = res.headers.get("content-type") ?? "";

      if (res.redirected || type.includes("text/html")) {
        addErr("Your session has expired. Reload the page and sign in again — nothing was run.");
        return;
      }
      // A refusal arrives as JSON before any run exists.
      if (!type.includes("text/event-stream")) {
        const out = await res.json().catch(() => ({ error: `The server answered ${res.status} without starting the run.` }));
        addErr(out.error ?? `The run did not start (${res.status}).`);
        setDone({ status: "refused", cost: 0 });
        return;
      }

      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done: end, value } = await reader.read();
        if (end) break;
        buf += dec.decode(value, { stream: true });
        const frames = buf.split("\n\n");
        buf = frames.pop() ?? "";
        for (const f of frames) {
          const ev = /^event: (.+)$/m.exec(f)?.[1];
          const raw = /^data: (.+)$/m.exec(f)?.[1];
          if (ev && raw) handle(ev, JSON.parse(raw));
        }
      }
    } catch (e: any) {
      addErr(`The connection to the run was lost (${e?.message ?? String(e)}). It may still finish; if it does, its row appears under Agent runs.`);
    }
  }

  const title = !done
    ? `${agentName(agent)} is working`
    : done.status === "success" ? "Done — pull request opened"
    : done.status === "no_changes" ? "Finished without changing anything"
    : done.status === "refused" ? "Not started"
    : "Stopped";

  return (
    <div className="live" aria-live="polite">
      <div className="live-head">
        <b>{title}</b>
        <span className="muted small">{done && done.status !== "refused" ? `$${Number(done.cost).toFixed(4)} · ${secs}s` : `${secs}s`}</span>
      </div>

      {lines.length > 0 && (
        <ol className="live-log">
          {lines.map((l, i) => <li key={i} className={l.kind + (l.failed ? " failed" : "")}>{l.text}</li>)}
          {!done && <li className="pending">…</li>}
        </ol>
      )}

      {landed && (
        <div className="ok">
          {landed.opened ? "Opened " : "Added a commit to "}
          <a href={landed.url} target="_blank" rel="noreferrer">{`pull request #${landed.number}`}</a>
          {` — commit `}<code>{landed.commit}</code>{`, ${landed.files.length} ${landed.files.length === 1 ? "file" : "files"}: ${landed.files.join(", ")}.`}
        </div>
      )}

      {said.trim() && (
        <details className="live-said" open={!!done}>
          <summary className="muted small">What the agent wrote while working</summary>
          <p className="body">{said.trim()}</p>
        </details>
      )}

      {err && <div className="error" style={{ whiteSpace: "pre-wrap" }}>{err}</div>}

      <p className="muted small" style={{ margin: 0 }}>
        {!done
          ? "Keep this page open until it finishes — usually one to four minutes. Closing it can cut the run off before it commits."
          : done.status === "refused"
          ? "Nothing was run and nothing was charged."
          : "The task moves when GitHub reports the branch and the pull request, not because this run said it finished. You own the result: read it before anyone merges it."}
      </p>
    </div>
  );
}
