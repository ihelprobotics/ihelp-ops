"use client";

import { useEffect, useState } from "react";

/* Agent grid. Tier decides who may dispatch what — the same rule the API
   enforces server-side. Locked tiles stay visible with the reason showing:
   a greyed tile that explains itself teaches, a missing tile just confuses. */
const AGENTS = [
  { id: "scribe",       name: "Scribe",        blurb: "Docs, runbooks, handovers",        tier: "week1" },
  { id: "annotator",    name: "Data Annotator",blurb: "Pre-labels for human checking",    tier: "week1" },
  { id: "qa",           name: "QA",            blurb: "Tests, eval harnesses, reports",   tier: "week1" },
  { id: "frontend",     name: "Frontend",      blurb: "Dashboards and operator UI",       tier: "week2" },
  { id: "fullstack",    name: "Full-stack",    blurb: "APIs, models, business logic",     tier: "full"  },
  { id: "ai-developer", name: "AI Developer",  blurb: "Training, eval, model integration",tier: "full"  },
  { id: "integrator",   name: "Integrator",    blurb: "Wiring, contract tests",           tier: "full"  },
  { id: "architect",    name: "Architect",     blurb: "ADRs and design review",           tier: "full"  },
];

const TIER_RANK = { week1: 1, week2: 2, full: 3 };

const OWNER_ONLY = [
  { name: "Deployer",  why: "Draft tier — the CTO triggers production" },
  { name: "Cloud",     why: "Advisory — proposes, never applies" },
  { name: "Social",    why: "Draft tier — a human publishes" },
  { name: "Outreach",  why: "Draft tier — a human sends" },
];

export default function Dashboard() {
  const [me, setMe] = useState<any>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [repo, setRepo] = useState("");
  // How many GitHub events the platform has on record for these tasks. Zero and
  // "nothing has happened yet" look identical on the board — a wall of 10% bars
  // — so the count is read rather than inferred.
  const [events, setEvents] = useState<number | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [runs, setRuns] = useState<Record<string, any>>({});
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const s = await fetch("/api/auth/session").then((r) => r.json());
      setMe(s?.user ?? null);

      const res = await fetch("/api/tasks");
      // The middleware sends an unauthenticated request to /login, so a session
      // that expired while this tab was open answers with an HTML page, not
      // JSON. Calling .json() on it throws "Unexpected token '<'" — an error
      // about a parser, describing nothing the reader can do anything about.
      if (res.redirected || !res.headers.get("content-type")?.includes("json")) {
        setErr("Your session has expired. Reload the page to sign in again.");
        return;
      }

      const t = await res.json();
      if (t.error) setErr(t.error);
      else { setTasks(t.tasks); setRepo(t.repo); setEvents(t.events_recorded ?? null); }
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function run(agent: string) {
    if (picked == null) { setErr("Pick a task first — an agent with no issue has nothing to work from."); return; }
    setErr("");
    const key = `${agent}-${picked}`;
    setRuns((r) => ({ ...r, [key]: { status: "starting" } }));

    const res = await fetch("/api/agents/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent, repo, issue: picked }),
    });
    const data = await res.json();

    if (!res.ok) {
      setErr(data.error);
      setRuns((r) => { const n = { ...r }; delete n[key]; return n; });
      return;
    }
    setRuns((r) => ({ ...r, [key]: { status: "running", id: data.run_id, message: data.message } }));
  }

  // No session is not "the lowest tier". Falling back to week1 would offer a
  // signed-out visitor three working Run buttons, and the refusal would come
  // from the API after the click instead of from the tile before it.
  const signedIn = !!me;
  const rank = signedIn ? TIER_RANK[me.tier as keyof typeof TIER_RANK] ?? 1 : 0;
  const isLead = signedIn && (me.role === "cto" || me.role === "founder");

  return (
    <main className="wrap">
      <header className="top">
        <div>
          <h1>iHelp Ops</h1>
          <p className="sub">{repo || "—"}</p>
        </div>
        {me && (
          <div className="who">
            <b>{me.name}</b>
            <span>
              {me.login ? `@${me.login}` : <em className="warn">GitHub not linked</em>}
              {me.pod ? ` · ${me.pod}` : ""}
            </span>
          </div>
        )}
      </header>

      {!me?.login && me && (
        <div className="notice">
          Link your GitHub account before running an agent. Work is attributed by
          GitHub login — commits, reviews and CODEOWNERS all use it, so an
          unlinked account cannot own anything.
        </div>
      )}

      {!loading && events === 0 && tasks.length > 0 && (
        <div className="notice">
          Every task is showing 10% because the platform has no GitHub events on
          record for this repository — not because nothing has happened. Until
          the webhook at <code>/api/webhooks/github</code> is connected in the
          repository settings, progress cannot move: branches, commits, pull
          requests, reviews and merges all arrive through it.
          <span className="muted small"> See docs/05-step2-golive.md §4.</span>
        </div>
      )}

      {err && <div className="error">{err}</div>}

      <section>
        <h2>Your tasks</h2>
        {loading && <p className="muted">Loading from GitHub…</p>}
        {/* Only after a load that actually succeeded. When err is set the list
            is empty because the read failed, not because the repo is quiet —
            saying "no open issues" there sends people to GitHub to look for
            work that is sitting right in front of them. The error is the
            answer, and it is rendered above. */}
        {!loading && !err && tasks.length === 0 && (
          <p className="muted">
            {repo ? `No open issues in ${repo}.` : "No open issues."}{" "}
            Open one on GitHub and it appears here.
          </p>
        )}
        <div className="tasks">
          {tasks.map((t) => (
            <button
              key={t.number}
              className={"task" + (picked === t.number ? " on" : "")}
              onClick={() => setPicked(picked === t.number ? null : t.number)}
            >
              <div className="trow">
                <span className="num">#{t.number}</span>
                <span className="title">{t.title}</span>
                <span className="pct">{t.progress}%</span>
              </div>
              <div className="bar"><i style={{ width: `${t.progress}%` }} /></div>
              <div className="meta">
                {t.assignee ? `@${t.assignee}` : "unassigned"}
                {t.labels.length ? " · " + t.labels.join(", ") : ""}
              </div>
            </button>
          ))}
        </div>
        <p className="muted small">
          Progress is derived from GitHub events — branch, commits, PR, review, merge.
          Nobody types a percentage.
        </p>
      </section>

      <section>
        <h2>Agents {picked != null && <span className="on-task">→ working on #{picked}</span>}</h2>
        <div className="grid">
          {AGENTS.map((a) => {
            // A linked GitHub login is required, not merely encouraged. Work
            // dispatched by an account with no git identity cannot be
            // attributed to anyone — the API refuses it, and the tile must
            // refuse it too rather than inviting a click that will fail.
            const allowed =
              signedIn && !!me.login &&
              (isLead || TIER_RANK[a.tier as keyof typeof TIER_RANK] <= rank);
            const key = `${a.id}-${picked}`;
            const r = runs[key];
            return (
              <div key={a.id} className={"agent" + (allowed ? "" : " off")}>
                <b>{a.name}</b>
                <span>{a.blurb}</span>
                {allowed ? (
                  <button className="go" onClick={() => run(a.id)} disabled={r?.status === "running"}>
                    {r?.status === "running" ? "Running…" : "Run"}
                  </button>
                ) : (
                  <span className="lock">
                    {!signedIn
                      ? "Sign in to run agents"
                      : !me.login
                      ? "Link GitHub to run"
                      : `Unlocks at ${a.tier}`}
                  </span>
                )}
              </div>
            );
          })}
          {OWNER_ONLY.map((a) => (
            <div key={a.name} className="agent off">
              <b>{a.name}</b>
              <span>{a.why}</span>
              <span className="lock">Human owner only</span>
            </div>
          ))}
        </div>
      </section>

      {Object.entries(runs).length > 0 && (
        <section>
          <h2>Runs</h2>
          {Object.entries(runs).map(([k, r]: any) => (
            <div className="run" key={k}>
              <b>{k}</b>
              <p>{r.message || r.status}</p>
              <p className="muted small">
                It will open a pull request. You own what it produces — read it,
                run it, be ready to explain any line of it.
              </p>
            </div>
          ))}
        </section>
      )}

      <style jsx global>{`
        * { box-sizing: border-box; }
        body {
          margin: 0; background: #0E1620; color: #DCE6ED;
          font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
          font-size: 14px; line-height: 1.5;
        }
        .wrap { max-width: 1100px; margin: 0 auto; padding: 24px; }
        .top { display: flex; align-items: flex-start; gap: 16px; border-bottom: 1px solid #26343F; padding-bottom: 16px; }
        h1 { font-size: 17px; margin: 0; font-weight: 600; }
        h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .09em; color: #78909F; margin: 30px 0 12px; font-weight: 500; }
        .sub { color: #4E6472; margin: 2px 0 0; font-size: 12px; font-family: ui-monospace, monospace; }
        .who { margin-left: auto; text-align: right; font-size: 12px; }
        .who b { display: block; }
        .who span { color: #78909F; font-family: ui-monospace, monospace; font-size: 11px; }
        .warn { color: #F2A03D; font-style: normal; }
        .notice { background: #1B2733; border-left: 3px solid #F2A03D; padding: 11px 13px; margin-top: 18px; border-radius: 2px; font-size: 13px; }
        .notice code { font-family: ui-monospace, monospace; font-size: 12px; color: #DCE6ED; }
        .error { background: #1B2733; border-left: 3px solid #E0555F; padding: 11px 13px; margin-top: 18px; border-radius: 2px; font-size: 13px; }
        .tasks { display: flex; flex-direction: column; gap: 8px; }
        .task { text-align: left; background: #151F2A; border: 1px solid #26343F; border-left: 3px solid #26343F; border-radius: 2px; padding: 11px 13px; cursor: pointer; color: inherit; font: inherit; }
        .task:hover { border-color: #4FD1C5; }
        .task.on { border-left-color: #4FD1C5; background: #1B2733; }
        .trow { display: flex; gap: 10px; align-items: baseline; }
        .num { font-family: ui-monospace, monospace; color: #78909F; font-size: 12px; }
        .title { flex: 1; font-weight: 500; }
        .pct { font-family: ui-monospace, monospace; font-size: 12px; color: #4FD1C5; }
        .bar { height: 3px; background: #26343F; border-radius: 2px; margin: 8px 0 6px; overflow: hidden; }
        .bar i { display: block; height: 100%; background: #4FD1C5; }
        .meta { font-size: 11px; color: #4E6472; font-family: ui-monospace, monospace; }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
        .agent { background: #151F2A; border: 1px solid #26343F; border-radius: 2px; padding: 12px; display: flex; flex-direction: column; gap: 6px; }
        .agent b { font-size: 13px; }
        .agent span { font-size: 11px; color: #78909F; }
        .agent.off { opacity: .5; }
        .go { margin-top: 4px; background: #4FD1C5; color: #06231F; border: 0; border-radius: 2px; padding: 7px; font-weight: 600; font-size: 12px; cursor: pointer; font-family: inherit; }
        .go:disabled { opacity: .5; cursor: not-allowed; }
        .lock { color: #4E6472 !important; font-family: ui-monospace, monospace; }
        .on-task { color: #4FD1C5; text-transform: none; letter-spacing: 0; }
        .run { background: #151F2A; border-left: 3px solid #4FD1C5; padding: 11px 13px; margin-bottom: 8px; border-radius: 2px; }
        .run b { font-family: ui-monospace, monospace; font-size: 12px; }
        .run p { margin: 5px 0 0; font-size: 13px; }
        .muted { color: #4E6472; }
        .small { font-size: 11px; }
      `}</style>
    </main>
  );
}
