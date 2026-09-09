"use client";

// The two steps, and the gap between them.
//
// Break it down, then read what came back, then open what survived reading.
// The middle step is the point: every field is editable and every task can be
// dropped, because the model proposing eight issues and a person agreeing to
// eight issues are different events and only the second one should reach a
// board other people work from.
//
// Results are reported per task, never as one verdict for the batch. Opening
// eight issues is eight calls to GitHub and the fifth can fail alone; a single
// "failed" would leave somebody unable to tell which four exist without going
// and counting, and the ones that worked are real work that must not be opened
// twice by retrying the whole set.

import { useState } from "react";

type Step = { title: string; body: string; keep: boolean };
type Result = { title: string; ok: boolean; number?: number; url?: string; error?: string };

export default function PlanForm({ repos }: { repos: string[] }) {
  const [repo, setRepo] = useState(repos[0] ?? "");
  const [prompt, setPrompt] = useState("");
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [summary, setSummary] = useState("");
  const [cost, setCost] = useState(0);
  const [busy, setBusy] = useState<"plan" | "open" | null>(null);
  const [err, setErr] = useState("");
  const [results, setResults] = useState<Result[] | null>(null);
  const [said, setSaid] = useState("");

  // An expired session comes back from the middleware as the login page, and
  // calling .json() on HTML reports a parser error instead of the problem.
  async function post(url: string, body: unknown) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.redirected || !res.headers.get("content-type")?.includes("json")) {
      throw new Error("Your session has expired. Reload the page to sign in again — nothing was created.");
    }
    const data = await res.json();
    if (!res.ok && !Array.isArray(data?.results)) {
      throw new Error(data?.error ?? `The request failed with ${res.status}.`);
    }
    return data;
  }

  async function breakItDown(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || busy) return;
    setBusy("plan"); setErr(""); setResults(null); setSaid("");
    try {
      const data = await post("/api/plan", { repo, prompt: prompt.trim() });
      setSteps(data.tasks.map((t: any) => ({ title: t.title, body: t.body, keep: true })));
      setSummary(data.summary ?? "");
      setCost(data.cost ?? 0);
    } catch (e: any) {
      setErr(e.message); setSteps(null);
    } finally {
      setBusy(null);
    }
  }

  async function openThem() {
    const keeping = (steps ?? []).filter((s) => s.keep);
    if (keeping.length === 0 || busy) return;
    setBusy("open"); setErr("");
    try {
      const data = await post("/api/plan/open", {
        repo,
        prompt: prompt.trim(),
        tasks: keeping.map((s) => ({ title: s.title, body: s.body })),
      });
      setResults(data.results ?? []);
      setSaid(data.message ?? "");
      // Whatever was opened is now on the board and must not be sent again.
      // What failed stays on screen in the results, with its reason.
      if (data.opened > 0) setSteps(null);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  const edit = (i: number, patch: Partial<Step>) =>
    setSteps((s) => (s ? s.map((x, j) => (j === i ? { ...x, ...patch } : x)) : s));

  const keeping = (steps ?? []).filter((s) => s.keep).length;

  return (
    <div className="card">
      <form className="plan-form" onSubmit={breakItDown}>
        <div className="plan-row">
          <label htmlFor="repo">Repository</label>
          <select id="repo" value={repo} disabled={busy !== null} onChange={(e) => setRepo(e.target.value)}>
            {repos.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>

        <textarea
          rows={5}
          value={prompt}
          disabled={busy !== null}
          placeholder="What do you want built? Say what it is for and how you would know it is finished — the breakdown is only as good as the sentence it starts from."
          onChange={(e) => setPrompt(e.target.value)}
        />

        <div className="plan-row">
          <button className="go" type="submit" disabled={busy !== null || !prompt.trim()}>
            {busy === "plan" ? "Breaking it down…" : steps ? "Break it down again" : "Break it down"}
          </button>
          {cost > 0 && <span className="muted small">{`$${cost.toFixed(4)}`}</span>}
          <span className="muted small">Nothing is created until you press the second button.</span>
        </div>
      </form>

      {err && <div className="error">{err}</div>}

      {summary && steps && <p className="muted">{summary}</p>}

      {steps && (
        <>
          <div className="plan-form">
            {steps.map((s, i) => (
              <div className={"step" + (s.keep ? "" : " off")} key={i}>
                <input
                  type="checkbox"
                  checked={s.keep}
                  aria-label={`Open "${s.title}"`}
                  disabled={busy !== null}
                  onChange={(e) => edit(i, { keep: e.target.checked })}
                />
                <div className="step-fields">
                  <input
                    value={s.title}
                    disabled={busy !== null || !s.keep}
                    onChange={(e) => edit(i, { title: e.target.value })}
                  />
                  <textarea
                    rows={4}
                    value={s.body}
                    disabled={busy !== null || !s.keep}
                    onChange={(e) => edit(i, { body: e.target.value })}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="plan-row" style={{ marginTop: 14 }}>
            <button className="go" type="button" disabled={busy !== null || keeping === 0} onClick={openThem}>
              {busy === "open"
                ? "Opening…"
                : `Open ${keeping} issue${keeping === 1 ? "" : "s"} in ${repo}`}
            </button>
            {keeping === 0 && <span className="muted small">Nothing is ticked, so there is nothing to open.</span>}
          </div>

          <p className="muted small" style={{ marginTop: 10 }}>
            Read these before opening them. Each becomes a GitHub issue anybody
            on the team can pick up, and an issue nobody checked costs more to
            close than it did to open.
          </p>
        </>
      )}

      {results && (
        <div style={{ marginTop: 16 }}>
          {said && <p className="ok small">{said}</p>}
          {results.map((r, i) => (
            <div className={"result " + (r.ok ? "ok" : "bad")} key={i}>
              <span className="who">
                {r.ok ? `#${r.number} ${r.title}` : `Not opened: ${r.title}`}
              </span>
              {r.ok ? (
                <a href={r.url} target="_blank" rel="noreferrer" className="small">on GitHub</a>
              ) : (
                <span className="small">{r.error}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
