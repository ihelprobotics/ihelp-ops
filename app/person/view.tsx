// One person, rendered. Used by /me and by /person/[id] — the same page, and
// deliberately so: what you can see about yourself and what a colleague can see
// about you differ only in what row-level security returns, never in what the
// screen is willing to draw. Two components would be two places for that to
// drift apart.
//
// There is no score anywhere on this page. Goals report evidence linked and
// evidence landed as counts, because docs/06 is explicit: a percentage against
// a person's name is the completion meter again, attached to a human, and
// people optimise it far harder than they optimise a task.

import Link from "next/link";
import Nav from "@/app/ui/nav";
import { PEOPLE_CSS } from "@/app/ui/people-css";
import type { PersonView } from "@/app/lib/person";

export default function Person({ view, self, admin = false }: { view: PersonView; self: boolean; admin?: boolean }) {
  const s = view.subject;
  const d = view.delivered;

  return (
    <main className="wrap">
      <header className="top">
        <div>
          {!self && <Link className="back muted" href="/team">&larr; Team</Link>}
          <h1>{s.name ?? s.email ?? "unnamed"}</h1>
          <p className="sub">
            {s.gh_login ? `@${s.gh_login}` : "GitHub not linked"} · {s.role} · {s.agent_tier}
            {s.pod ? ` · ${s.pod}` : ""}
          </p>
          <Nav current={self ? "me" : "team"} admin={admin} />
        </div>
      </header>

      <section>
        <h2>Delivered</h2>
        <div className="card">
          {!d ? (
            <p className="body">{view.deliveredMissing}</p>
          ) : (
            <>
              <div className="nums">
                <span className="num"><b>{d.merged}</b><span>pull requests merged</span></span>
                <span className="num"><b>{d.opened}</b><span>opened</span></span>
                <span className="num"><b>{d.commits}</b><span>commits</span></span>
                <span className="num"><b>{d.reviews}</b><span>reviews given</span></span>
                <span className="num">
                  <b>{d.merged === 0 ? "—" : `${Math.round((d.mergedAgentAuthored / d.merged) * 100)}%`}</b>
                  <span>agent-authored</span>
                </span>
                <span className="num">
                  <b>{d.cycleHours === null ? "—" : `${d.cycleHours}h`}</b>
                  <span>median-ish cycle, {d.cycleSample} merged</span>
                </span>
              </div>
              <p className="muted small" style={{ marginTop: 10 }}>
                Every number here is a count of artifacts in GitHub. A merged
                pull request is credited to whoever opened it, not to whoever
                pressed merge — that person is the reviewer.
              </p>
            </>
          )}

          {view.eventsRecorded === 0 && (
            <div className="notice">
              These are all zero because the platform has no GitHub events on
              record at all — not because nothing has been delivered. The webhook
              at <code>/api/webhooks/github</code> has never been connected, so
              nothing has ever been reported to it.
            </div>
          )}
        </div>
      </section>

      <section>
        <h2>Goals</h2>
        <div className="card">
          {view.goals.length === 0 ? (
            <p className="muted small">
              No goals on record for this person. Goals are 30/60/90 day and are
              set by a lead; an empty list means none have been written, not that
              none were met.
            </p>
          ) : (
            view.goals.map((g) => (
              <div className="goal" key={g.id}>
                <header>
                  <span className="cyc">{g.cycle}</span>
                  <b>{g.statement}</b>
                  <span className="due">due {g.due_on}</span>
                </header>
                {/* One string, not five expressions. React separates adjacent
                    text nodes in server-rendered HTML, so "{a} of {b} linked"
                    arrives as 1<!-- --> of <!-- -->2 — which reads correctly
                    and cannot be found by anything looking at the markup. */}
                <p className="muted small" style={{ margin: "4px 0 0" }}>
                  {`${g.status} · ${g.evidence_landed} of ${g.evidence_linked} linked ${
                    g.evidence_linked === 1 ? "artifact" : "artifacts"
                  } landed`}
                </p>
                {g.evidence.length > 0 && (
                  <div className="ev">
                    {g.evidence.map((e) => (
                      <a key={e.url} href={e.url} target="_blank" rel="noreferrer">
                        {e.landed ? "✓" : "·"} {e.kind} — {e.label ?? e.url}
                      </a>
                    ))}
                  </div>
                )}
                {g.closing_note && <p className="body">{g.closing_note}</p>}
              </div>
            ))
          )}
        </div>
      </section>

      <section>
        <h2>One to ones</h2>
        <div className="card">
          {view.notesGate && <p className="body">{view.notesGate}</p>}
          {view.oneOnOnes.length === 0 ? (
            <p className="muted small">
              {view.notesGate ? "Nothing here that you wrote." : "No 1:1s recorded."}
            </p>
          ) : (
            view.oneOnOnes.map((n) => (
              <div className="row" key={n.id}>
                <span className="when">{n.held_on}</span>
                <span className="what">
                  <span className="muted small">
                    with {n.author ?? "unknown"}{n.authoredByViewer ? " · you wrote this" : ""}
                  </span>
                  {n.agreed_actions && <p className="body"><b>Agreed:</b> {n.agreed_actions}</p>}
                  {n.notes && <p className="body">{n.notes}</p>}
                </span>
              </div>
            ))
          )}
          <p className="muted small" style={{ marginTop: 10 }}>
            Notes stay with the pair; what was agreed becomes a goal or a task
            and travels normally. Nothing is written about a person that the
            person cannot read.
          </p>
        </div>
      </section>

      <section>
        <h2>Feedback</h2>
        <div className="card">
          {view.feedback.length === 0 ? (
            <p className="muted small">
              {view.notesGate ? "Nothing here that you wrote." : "No feedback notes recorded."}
            </p>
          ) : (
            view.feedback.map((f) => (
              <div className="row" key={f.id}>
                <span className="when">{new Date(f.shared_at).toISOString().slice(0, 10)}</span>
                <span className="what">
                  <span className="muted small">{f.author ?? "unknown"}</span>
                  <p className="body">{f.body}</p>
                </span>
              </div>
            ))
          )}
        </div>
      </section>

      {view.accessLog && (
        <section>
          <h2>Who has read notes about you</h2>
          <div className="card">
            {view.accessLog.length === 0 ? (
              <p className="muted small">
                Nobody who is neither the author nor you has opened a note about
                you.
              </p>
            ) : (
              view.accessLog.map((a, i) => (
                <div className="row" key={i}>
                  <span className="when">{new Date(a.read_at).toLocaleString()}</span>
                  <span className="what">{a.reader ?? "unknown"}</span>
                </div>
              ))
            )}
            <p className="muted small" style={{ marginTop: 10 }}>
              The CTO can read every 1:1. This log is what makes that acceptable
              rather than quietly corrosive — it is not surveillance of the
              reader, it is your record of who looked.
            </p>
          </div>
        </section>
      )}

      <style dangerouslySetInnerHTML={{ __html: PEOPLE_CSS }} />
    </main>
  );
}
