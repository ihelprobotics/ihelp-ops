// /analytics — how the work is actually moving.
//
// There is no leaderboard here. Merged counts appear next to agent-authored
// share because the two are only meaningful together, and neither is sorted
// into a ranking with a winner at the top. docs/07: the Friday demo shows what
// shipped, it is not a gate — and this page is the same idea in numbers.
//
// The one number worth arguing with is "claimed, not proven". Everything else
// describes the system; that one describes a gap between what somebody's name
// is on and what exists.

import Link from "next/link";
import { auth } from "@/auth";
import { loadAnalytics, STALL_DAYS } from "@/app/lib/analytics";
import { repos } from "@/app/lib/repos";
import { stageLabel } from "@/app/lib/progress";
import { PEOPLE_CSS } from "@/app/ui/people-css";
import Nav from "@/app/ui/nav";
import { isAdmin } from "@/app/lib/roles";

export const dynamic = "force-dynamic";

const hrs = (h: number | null) => (h === null ? "—" : h < 48 ? `${h}h` : `${Math.round(h / 24)}d`);
const usd = (n: number) => `$${n.toFixed(2)}`;
const pct = (part: number, whole: number) => (whole === 0 ? "—" : `${Math.round((part / whole) * 100)}%`);

export default async function AnalyticsPage() {
  const session = await auth();
  // The Admin link, shown only to those it is for. The page itself checks too.
  const admin = isAdmin(session?.user?.role ?? "");
  let list: string[] = [];
  let a: Awaited<ReturnType<typeof loadAnalytics>> | null = null;
  let error = "";
  try {
    list = (await repos()).map((r) => r.full);
    a = await loadAnalytics(list);
  } catch (e: any) {
    error = e?.message ?? String(e);
  }

  return (
    <main className="wrap">
      <header className="top">
        <div>
          <h1>Analytics</h1>
          <p className="sub">{list.length ? list.join(" · ") : "no repositories configured"}</p>
          <Nav current="analytics" admin={admin} />
        </div>
        {session?.user && (
          <div className="who">
            <b>{session.user.name}</b>
            <span>{a ? `${a.spend.runs} agent runs · ${usd(a.spend.total)}` : ""}</span>
          </div>
        )}
      </header>

      {error && <div className="error">{error}</div>}

      {a?.eventsRecorded === 0 && (
        <div className="notice">
          Every number below is zero because the platform has no GitHub events on
          record — not because nothing shipped. The webhook
          at <code>/api/webhooks/github</code> has never delivered. Until it
          does, cycle time and review latency have nothing to be computed from.
        </div>
      )}

      {a?.liveError && (
        <div className="notice">
          Stalled work and claimed-versus-proven could not be worked out, because
          the open issues could not be read from GitHub. That is a failure to
          read, not an empty backlog. {a.liveError}
        </div>
      )}

      {a && (
        <>
          <section>
            <h2>Flow</h2>
            <div className="card">
              <div className="nums">
                <span className="num"><b>{hrs(a.cycle.median)}</b><span>median cycle time, {a.cycle.n} merged</span></span>
                <span className="num"><b>{hrs(a.cycle.slowest)}</b><span>slowest</span></span>
                <span className="num"><b>{hrs(a.review.median)}</b><span>median review wait</span></span>
                <span className="num"><b>{a.review.waiting}</b><span>open, not yet approved</span></span>
                <span className="num">
                  <b>{pct(a.rework.reworked, a.rework.merged)}</b>
                  <span>needed more commits after merge</span>
                </span>
              </div>
              <p className="muted small" style={{ marginTop: 10 }}>
                Issue opened to pull request merged, and pull request opened to
                first human approval. These are elapsed hours — how long the work
                waited, not how long anyone sat at a desk. There is no such
                number in this platform and there is not going to be one.
              </p>
            </div>
          </section>

          <section>
            <h2>Claimed, and proven</h2>
            <div className="card">
              {!a.claimed ? (
                <p className="muted small">Not available — see above.</p>
              ) : (
                <>
                  <div className="nums">
                    <span className="num"><b>{a.claimed.open}</b><span>open tasks</span></span>
                    <span className="num"><b>{a.claimed.assigned}</b><span>have somebody&apos;s name on them</span></span>
                    <span className="num">
                      <b className={a.claimed.assignedNoArtifact.length ? "amber" : ""}>
                        {a.claimed.assignedNoArtifact.length}
                      </b>
                      <span>assigned with nothing to show yet</span>
                    </span>
                  </div>
                  {a.claimed.assignedNoArtifact.length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      {a.claimed.assignedNoArtifact.map((t) => (
                        <div className="row" key={`${t.repo}#${t.number}`}>
                          <span className="when">{`#${t.number}`}</span>
                          <span className="what"><Link href={t.href}>{t.title}</Link></span>
                          <span className="st pending">{`@${t.assignee}`}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="muted small" style={{ marginTop: 10 }}>
                    No branch, no commit, no pull request. This is not a list of
                    people to chase — a task can be assigned the same morning, or
                    be a week of reading. It is the one place where what is
                    claimed and what exists can be compared at all.
                  </p>
                </>
              )}
            </div>
          </section>

          <section>
            <h2>{`Stalled — nothing for ${STALL_DAYS}+ days`}</h2>
            <div className="card">
              {!a.stalled ? (
                <p className="muted small">Not available — see above.</p>
              ) : a.stalled.length === 0 ? (
                <p className="muted small">
                  Every open task has had an artifact against it in the last three
                  days.
                </p>
              ) : (
                a.stalled.map((t) => (
                  <div className="row" key={`${t.repo}#${t.number}`}>
                    <span className="when">
                      {t.days === null ? "never moved" : `${t.days}d quiet`}
                    </span>
                    <span className="what">
                      <Link href={t.href}>{list.length > 1 ? `${t.repo}#${t.number} ${t.title}` : `#${t.number} ${t.title}`}</Link>
                      <span className="muted small">{` · ${stageLabel(t.stage)}`}</span>
                    </span>
                    <span className="st pending">{t.assignee ? `@${t.assignee}` : "unassigned"}</span>
                  </div>
                ))
              )}
              <p className="muted small" style={{ marginTop: 10 }}>
                A stalled task is a prompt to ask, not a verdict. Someone on
                approved leave is not stalled, and the daily digest already knows
                that.
              </p>
            </div>
          </section>

          <section>
            <h2>Who shipped what</h2>
            <div className="card">
              {a.people.length === 0 ? (
                <p className="muted small">
                  No merged pull requests on record for this repository yet.
                </p>
              ) : (
                a.people.map((p) => (
                  <div className="row" key={p.login}>
                    <span className="when">{`@${p.login}`}</span>
                    <span className="what">
                      {`${p.merged} merged · ${p.agentAuthored} agent-authored (${pct(p.agentAuthored, p.merged)})`}
                    </span>
                  </div>
                ))
              )}
              <p className="muted small" style={{ marginTop: 10 }}>
                Credited to whoever opened the pull request, never to whoever
                pressed merge — that person is the reviewer. Agent-authored share
                is context, not a score: work an agent drafted is still owned,
                read and defended by the person whose name is on it.
              </p>
            </div>
          </section>

          <section>
            <h2>What the agents cost</h2>
            <div className="card">
              {a.costByAgent.length === 0 ? (
                <p className="muted small">No agent runs recorded against this repository.</p>
              ) : (
                a.costByAgent.map((c) => (
                  <div className="row" key={c.agent}>
                    <span className="when">{c.agent}</span>
                    <span className="what">
                      {`${c.runs} run${c.runs === 1 ? "" : "s"}${c.failed ? ` · ${c.failed} failed` : ""}`}
                    </span>
                    <span className="st approved">{usd(c.cost)}</span>
                  </div>
                ))
              )}
            </div>
            {a.costByPerson.length > 0 && (
              <div className="card">
                {a.costByPerson.map((c, i) => (
                  <div className="row" key={c.name ?? `unknown-${i}`}>
                    <span className="when">{c.name ?? "unknown requester"}</span>
                    <span className="what">{`${c.runs} run${c.runs === 1 ? "" : "s"}`}</span>
                    <span className="st approved">{usd(c.cost)}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="muted small">
              Cost is reported by the agent workflow when a run finishes. A run
              showing nothing spent has not reported back yet.
            </p>
          </section>
        </>
      )}

      <style dangerouslySetInnerHTML={{ __html: PEOPLE_CSS }} />
    </main>
  );
}
