// /leave — book time off, see the balance, and decide other people's requests
// if that is yours to do.
//
// Leave is the one piece of HR in this platform, and docs/06 says why it is
// here at all: the Escalator has to know who is away. A person on approved sick
// leave is not stalled, and flagging them is how an accountability system loses
// the room.
//
// The balance is read from the leave_taken view rather than counted here, so
// the number on this page and the number in any analytics query are the same
// number. If nobody has set an entitlement, the page says so — it does not
// quietly show the schema default and let someone plan a holiday against it.

import { auth } from "@/auth";
import { loadViewer } from "@/app/lib/people";
import { loadLeave } from "@/app/lib/leave-data";
import { daysOf } from "@/app/lib/leave";
import { PEOPLE_CSS } from "@/app/ui/people-css";
import Nav from "@/app/ui/nav";
import RequestForm from "./request-form";
import Decide from "./decide";

export const dynamic = "force-dynamic";

const span = (r: { starts_on: string; ends_on: string; half_day: boolean }) =>
  r.starts_on === r.ends_on
    ? `${r.starts_on}${r.half_day ? " (half day)" : ""}`
    : `${r.starts_on} → ${r.ends_on}`;

export default async function LeavePage() {
  const session = await auth();
  // The Admin link, shown only to those it is for. The page itself checks too.
  const role = session?.user?.role ?? "";

  let view: Awaited<ReturnType<typeof loadLeave>> | null = null;
  let me: Awaited<ReturnType<typeof loadViewer>> = null;
  let error = "";

  try {
    if (!session?.user?.email) throw new Error("Sign in to book leave.");
    me = await loadViewer(session.user.email);
    if (!me) throw new Error(`No account in app_user for ${session.user.email}. Signing in creates one, so this means the row was removed — ask your pod lead.`);
    view = await loadLeave(me);
  } catch (e: any) {
    error = e?.message ?? String(e);
  }

  return (
    <main className="wrap">
      <header className="top">
        <div>
          <h1>Leave</h1>
          <p className="sub">{me?.lead_email ? `decided by ${me.lead_email}` : "no lead set — the CTO decides"}</p>
          <Nav current="leave" role={role} />
        </div>
        {me && (
          <div className="who">
            <b>{me.name}</b>
            <span>{me.pod ?? "no pod"}</span>
          </div>
        )}
      </header>

      {error && <div className="error">{error}</div>}

      {view && (
        <>
          <section>
            <h2>Balance {view.year}</h2>
            <div className="card">
              {view.balance ? (
                <div className="nums">
                  <span className="num"><b>{view.balance.entitled}</b><span>entitled</span></span>
                  <span className="num"><b>{view.balance.carried_over}</b><span>carried over</span></span>
                  <span className="num"><b>{view.balance.taken}</b><span>taken</span></span>
                  <span className="num"><b className="pct">{view.balance.remaining}</b><span>remaining</span></span>
                </div>
              ) : (
                <p className="body">{view.balanceMissing}</p>
              )}
              <p className="muted small" style={{ marginTop: 10 }}>
                Planned and unpaid leave come off the entitlement. Sick and comp
                off do not, and are recorded so nobody is chased for a day they
                were ill.
              </p>
            </div>
          </section>

          <section>
            <h2>Book</h2>
            <div className="card"><RequestForm /></div>
          </section>

          {view.queue !== null && (
            <section>
              <h2>Waiting on you</h2>
              <div className="card">
                {view.queue.length === 0 ? (
                  <p className="muted small">
                    Nothing pending. Requests from the people whose lead you are
                    appear here; the CTO and founder see everyone&apos;s.
                  </p>
                ) : (
                  view.queue.map((q) => (
                    <div className="row" key={q.id}>
                      <span className="when">{span(q)}</span>
                      <span className="what">
                        <b>{q.requester_name ?? "unnamed"}</b>{" "}
                        <span className="muted small">
                          {q.kind} · {daysOf(q)} day{daysOf(q) === 1 ? "" : "s"}
                          {q.requester_pod ? ` · ${q.requester_pod}` : ""}
                        </span>
                        {q.reason && <p className="body">{q.reason}</p>}
                      </span>
                      <Decide id={q.id} mine={false} />
                    </div>
                  ))
                )}
              </div>
            </section>
          )}

          <section>
            <h2>Yours</h2>
            <div className="card">
              {view.history.length === 0 ? (
                <p className="muted small">
                  You have not booked any leave. Nothing is wrong — this list
                  fills the first time you do.
                </p>
              ) : (
                view.history.map((r) => (
                  <div className="row" key={r.id}>
                    <span className="when">{span(r)}</span>
                    <span className="what">
                      {r.kind} · {daysOf(r)} day{daysOf(r) === 1 ? "" : "s"}
                      {r.reason && <p className="body">{r.reason}</p>}
                      {r.decision_note && (
                        <p className="body">
                          {r.decided_by_name ?? "Decided"}: {r.decision_note}
                        </p>
                      )}
                    </span>
                    <span className={`st ${r.status}`}>{r.status}</span>
                    {r.status === "pending" && <Decide id={r.id} mine />}
                  </div>
                ))
              )}
            </div>
          </section>

          <section>
            <h2>Away today</h2>
            <div className="card">
              {view.awayToday.length === 0 ? (
                <p className="muted small">Nobody is on approved leave today.</p>
              ) : (
                view.awayToday.map((a, i) => (
                  <div className="row" key={`${a.name}-${i}`}>
                    <span className="when">{a.kind}</span>
                    <span className="what">{a.name ?? "unnamed"}</span>
                    <span className="st pending">back after {a.ends_on}</span>
                  </div>
                ))
              )}
            </div>
          </section>
        </>
      )}

      <style dangerouslySetInnerHTML={{ __html: PEOPLE_CSS }} />
    </main>
  );
}
