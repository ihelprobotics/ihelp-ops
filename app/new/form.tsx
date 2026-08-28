"use client";

// Opening a task.
//
// The description field is the part worth getting right in the copy. It is not
// a note for a colleague — it is the specification an agent reads and the only
// thing it is given. A vague issue produces a confident, wrong pull request,
// and the person who opened it spends longer reviewing that than writing three
// clear sentences would have taken. So the field says so, once, quietly.

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Repo } from "@/app/lib/repos";

export default function NewTaskForm({
  repos, canRunAgents, defaultRepo,
}: {
  repos: Repo[];
  canRunAgents: string[];
  defaultRepo: string;
}) {
  const router = useRouter();
  const [repo, setRepo] = useState(defaultRepo);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [mine, setMine] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || busy) return;

    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo, title, body, assignToMe: mine }),
      });

      if (res.redirected || (res.headers.get("content-type") ?? "").includes("text/html")) {
        setErr("Your session has expired. Reload the page and sign in again.");
        return;
      }

      const out = await res.json().catch(() => ({ error: `The server answered with ${res.status} and no explanation.` }));
      if (!res.ok) { setErr(out.error); return; }

      // The task exists either way. If taking it failed, that is worth saying
      // on the task itself rather than swallowing here — so go there and carry
      // the reason.
      router.push(out.assignError ? `${out.href}?note=${encodeURIComponent(out.assignError)}` : out.href);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const agentsHere = canRunAgents.includes(repo);

  return (
    <form className="newtask" onSubmit={submit}>
      <div className="field">
        <label htmlFor="repo">Repository</label>
        <select id="repo" value={repo} disabled={busy} onChange={(e) => setRepo(e.target.value)}>
          {repos.map((r) => <option key={r.full} value={r.full}>{r.name}</option>)}
        </select>
        {!agentsHere && (
          <p className="muted small" style={{ margin: 0 }}>
            Agents cannot run in this repository yet — it has no{" "}
            <code>agent-run.yml</code>. The task works normally; only the Run
            button will refuse, and it says so.
          </p>
        )}
      </div>

      <div className="field">
        <label htmlFor="title">Title</label>
        <input
          id="title"
          value={title}
          disabled={busy}
          maxLength={256}
          placeholder="What should be true when this is done"
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="body">Description</label>
        <textarea
          id="body"
          value={body}
          disabled={busy}
          rows={10}
          placeholder={
            "What needs to be true when this is finished, and how somebody would know.\n\n" +
            "If an agent picks this up, this text is the whole brief it gets."
          }
          onChange={(e) => setBody(e.target.value)}
        />
      </div>

      <label className="mine">
        <input type="checkbox" checked={mine} disabled={busy} onChange={(e) => setMine(e.target.checked)} />
        <span>Put my name on it</span>
      </label>

      {err && <div className="error">{err}</div>}

      <div className="fields">
        <button className="go" disabled={busy || !title.trim()}>
          {busy ? "Opening…" : "Open the task"}
        </button>
        <span className="muted small">
          It becomes an issue in {repo.split("/")[1]} and appears on the board at 10%.
        </span>
      </div>
    </form>
  );
}
