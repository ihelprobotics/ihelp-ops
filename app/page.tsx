"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BASE_CSS } from "@/app/ui/base-css";
import Nav from "@/app/ui/nav";
import { isAdmin } from "@/app/lib/roles";

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
  const [repos, setRepos] = useState<any[]>([]);
  // How many GitHub events the platform has on record for these tasks. Zero and
  // "nothing has happened yet" look identical on the board — a wall of 10% bars
  // — so the count is read rather than inferred.
  const [events, setEvents] = useState<number | null>(null);
  // The whole task, not just its number: issue #1 exists in every repository,
  // so a number alone cannot say which one an agent should be sent to.
  const [picked, setPicked] = useState<any>(null);
  const [runs, setRuns] = useState<Record<string, any>>({});
  const [taking, setTaking] = useState("");
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
      else { setTasks(t.tasks); setRepos(t.repos ?? []); setEvents(t.events_recorded ?? null); }
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  // Taking a task from the board, without opening it first. This is the normal
  // way work starts: you see something nobody has, and you put your name on it.
  async function take(t: any) {
    setTaking(`${t.repo}#${t.number}`);
    setErr("");
    try {
      const res = await fetch(`/api/tasks/${t.repo}/${t.number}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "assign", to: me?.login ?? null }),
      });
      if (!res.headers.get("content-type")?.includes("json")) {
        setErr("Your session has expired. Reload the page to sign in again.");
        return;
      }
      const out = await res.json();
      if (!res.ok) { setErr(out.error); return; }
      await load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setTaking("");
    }
  }

  async function run(agent: string) {
    if (!picked) { setErr("Pick a task first — an agent with no issue has nothing to work from."); return; }
    setErr("");
    const key = `${agent}-${picked.repo}#${picked.number}`;
    setRuns((r) => ({ ...r, [key]: { status: "starting" } }));

    const res = await fetch("/api/agents/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent, repo: picked.repo, issue: picked.number }),
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
          <p className="sub">
            {repos.length === 0
              ? "—"
              : repos.length === 1
              ? repos[0].repo
              : `${repos.length} repositories · ${tasks.length} open`}
          </p>
          <Nav current="board" admin={isAdmin(me?.role ?? "")} />
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
            No open issues in {repos.length === 1 ? repos[0].repo : "any configured repository"}.
            {" "}Open one on GitHub and it appears here.
          </p>
        )}

        {/* A repository that could not be read says so beside its own name.
            Folding it into the list would show an empty repo as a quiet one. */}
        {repos.filter((r) => r.error).map((r) => (
          <div className="notice" key={r.repo}>
            <b>{r.repo}</b> could not be read, so its tasks are missing from this
            board — that is a failure to reach GitHub, not an empty backlog.{" "}
            <span className="muted small">{r.error}</span>
          </div>
        ))}

        {/* Only repositories with work in them get a section. Thirteen headings
            with "nothing open here" under eleven of them buries the two tasks
            that matter — the empty ones are one quiet line at the bottom, which
            is still an honest account of what was read. */}
        {repos.filter((r) => !r.error && tasks.some((t) => t.repo === r.repo)).map((r) => {
          const mine = tasks.filter((t) => t.repo === r.repo);
          return (
            <div key={r.repo}>
              {repos.length > 1 && (
                <p className="repo-head">{`${r.repo} · ${mine.length} open`}</p>
              )}
              <div className="tasks">
                {mine.map((t) => {
                  const on = picked?.repo === t.repo && picked?.number === t.number;
                  const isMine = me?.login && t.assignee?.toLowerCase() === me.login.toLowerCase();
                  return (
                    /* Two separate targets, deliberately. Clicking the row picks
                       the task for an agent to work on; the link opens it. One
                       control doing both would mean you could not select a task
                       without leaving the page you were selecting it on. */
                    <div key={`${t.repo}#${t.number}`} className={"task" + (on ? " on" : "")}>
                      <button className="tsel" onClick={() => setPicked(on ? null : t)}>
                        <div className="trow">
                          <span className="num">{`#${t.number}`}</span>
                          <span className="title">{t.title}</span>
                          <span className="pct">{`${t.progress}%`}</span>
                        </div>
                        <div className="bar"><i style={{ width: `${t.progress}%` }} /></div>
                        <div className="meta">
                          {t.assignee ? `@${t.assignee}${isMine ? " · you" : ""}` : "nobody has taken this"}
                          {t.labels.length ? " · " + t.labels.join(", ") : ""}
                        </div>
                      </button>
                      {!t.assignee && me?.login && (
                        <button className="take" disabled={!!taking} onClick={() => take(t)}>
                          {taking === `${t.repo}#${t.number}` ? "…" : "Take it"}
                        </button>
                      )}
                      <Link className="open" href={t.href}>Open</Link>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        <p className="muted small">
          Progress is derived from GitHub events — branch, commits, PR, review, merge.
          Nobody types a percentage.
        </p>

        {/* Named rather than merely omitted. "We read eleven repositories and
            they were empty" and "we did not look" are different facts, and the
            second is the one worth catching. */}
        {(() => {
          const quiet = repos.filter((r) => !r.error && !tasks.some((t) => t.repo === r.repo));
          if (quiet.length === 0) return null;
          return (
            <details className="quiet">
              <summary>
                {`${quiet.length} other ${quiet.length === 1 ? "repository has" : "repositories have"} nothing open`}
              </summary>
              <p className="muted small">{quiet.map((r) => r.repo).join(" · ")}</p>
            </details>
          );
        })()}
      </section>

      <section>
        <h2>Agents {picked && <span className="on-task">{` → working on ${picked.repo}#${picked.number}`}</span>}</h2>
        <div className="grid">
          {AGENTS.map((a) => {
            // A linked GitHub login is required, not merely encouraged. Work
            // dispatched by an account with no git identity cannot be
            // attributed to anyone — the API refuses it, and the tile must
            // refuse it too rather than inviting a click that will fail.
            const allowed =
              signedIn && !!me.login &&
              (isLead || TIER_RANK[a.tier as keyof typeof TIER_RANK] <= rank);
            const key = `${a.id}-${picked ? picked.repo + "#" + picked.number : ""}`;
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
        ${BASE_CSS}

        /* A repository heading. Only shown when there is more than one, so it
           never labels a list of one thing. */
        .repo-head {
          font-size: 12px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase;
          color: var(--ink-3); margin: 26px 0 8px; padding: 0 4px;
        }

        /* The task list is one card, rows inside it — the same grouped-list
           shape as every other screen, so the board is not its own dialect. */
        .tasks {
          background: var(--surface); border-radius: var(--radius);
          box-shadow: var(--shadow); overflow: hidden;
        }
        .tasks > p { margin: 0; padding: 14px 16px; }

        .task {
          display: flex; align-items: center; gap: 10px;
          padding: 12px 16px; border-top: 1px solid var(--line-soft);
          transition: background .15s ease;
        }
        .task:first-child { border-top: 0; }
        .task:hover { background: var(--sunken); }
        .task.on { background: var(--accent-bg); }

        .tsel {
          flex: 1; min-width: 0; text-align: left; background: none; border: 0;
          padding: 0; cursor: pointer; color: inherit; font: inherit;
        }
        .trow { display: flex; gap: 10px; align-items: baseline; }
        .num { font-size: 13px; color: var(--ink-3); font-variant-numeric: tabular-nums; flex: none; }
        .title { flex: 1; min-width: 0; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .pct { font-size: 13px; font-weight: 600; color: var(--accent); font-variant-numeric: tabular-nums; flex: none; }
        .meta { font-size: 13px; color: var(--ink-2); margin-top: 2px; }

        .take {
          flex: none; background: var(--accent); color: #fff; border: 0;
          border-radius: 100px; padding: 7px 14px; min-height: 34px;
          font-size: 13px; font-weight: 600; cursor: pointer;
          transition: background .15s ease, transform .1s ease;
        }
        .take:hover:not(:disabled) { background: var(--accent-ink); }
        .take:active:not(:disabled) { transform: scale(.97); }
        .take:disabled { opacity: .4; cursor: not-allowed; }

        .open {
          flex: none; font-size: 14px; color: var(--accent); text-decoration: none;
          padding: 6px 2px 6px 8px; display: flex; align-items: center;
        }
        .open:hover { text-decoration: none; }
        /* The chevron a phone puts on a row that opens something. */
        .open::after {
          content: ""; width: 7px; height: 7px; margin-left: 8px;
          border-right: 1.5px solid var(--ink-3); border-bottom: 1.5px solid var(--ink-3);
          transform: rotate(-45deg);
        }

        /* A disclosure, closed by default. Native <details>, so it needs no
           JavaScript and behaves the way the reader's browser already does. */
        .quiet { margin-top: 14px; }
        .quiet summary {
          font-size: 13px; color: var(--ink-2); cursor: pointer; padding: 6px 4px;
          list-style: none; min-height: 32px; display: flex; align-items: center; gap: 6px;
        }
        .quiet summary::-webkit-details-marker { display: none; }
        .quiet summary::before {
          content: ; width: 6px; height: 6px; flex: none;
          border-right: 1.5px solid var(--ink-3); border-bottom: 1.5px solid var(--ink-3);
          transform: rotate(-45deg); transition: transform .15s ease;
        }
        .quiet[open] summary::before { transform: rotate(45deg); }
        .quiet summary:hover { color: var(--ink); }
        .quiet p { margin: 2px 0 0 16px; line-height: 1.7; }

        /* ---- agents ---- */
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 10px; }
        .agent {
          background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow);
          padding: 14px; display: flex; flex-direction: column; gap: 5px;
          transition: box-shadow .15s ease;
        }
        .agent:hover { box-shadow: 0 2px 8px rgba(0,0,0,.07); }
        .agent b { font-size: 15px; font-weight: 600; }
        .agent > span { font-size: 13px; color: var(--ink-2); }
        .agent.off { opacity: .55; box-shadow: none; background: transparent; border: 1px solid var(--line); }
        .agent.off:hover { box-shadow: none; }
        .agent .go { margin-top: 6px; }
        .lock { color: var(--ink-3) !important; font-size: 12px !important; }
        .on-task { color: var(--accent); font-weight: 500; }

        /* ---- runs ---- */
        .run {
          background: var(--accent-bg); border-radius: var(--radius);
          padding: 13px 15px; margin-bottom: 8px;
        }
        .run b { font-size: 14px; font-weight: 600; }
        .run p { margin: 4px 0 0; font-size: 14px; color: var(--ink-2); }

        @media (max-width: 640px) {
          .task { flex-wrap: wrap; }
          .tsel { flex-basis: 100%; }
        }
      `}</style>
    </main>
  );
}
