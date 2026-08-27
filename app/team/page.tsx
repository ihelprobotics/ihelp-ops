// /team — who is here, what they have open, who is away today. Read-only.
//
// There is no headcount, no utilisation and no capacity number on this page,
// and there will not be one. What a lead actually needs before assigning work
// is: who is on this pod, what is already on their plate, and who is not here
// this week. That is three facts and they are all artifacts.

import Link from "next/link";
import { auth } from "@/auth";
import { loadTeam } from "@/app/lib/people";
import { PEOPLE_CSS } from "@/app/ui/people-css";
import Nav from "@/app/ui/nav";
import { isAdmin } from "@/app/lib/roles";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const session = await auth();
  // The Admin link, shown only to those it is for. The page itself checks too.
  const admin = isAdmin(session?.user?.role ?? "");

  let team: Awaited<ReturnType<typeof loadTeam>> | null = null;
  let error = "";
  try {
    team = await loadTeam();
  } catch (e: any) {
    error = e?.message ?? String(e);
  }

  const away = team?.pods.flatMap((p) => p.members).filter((m) => m.onLeave) ?? [];

  return (
    <main className="wrap">
      <header className="top">
        <div>
          <h1>Team</h1>
          <p className="sub">{team?.repos.length ? team.repos.join(" · ") : "no repositories configured"}</p>
          <Nav current="team" admin={admin} />
        </div>
        {session?.user && (
          <div className="who">
            <b>{session.user.name}</b>
            <span>{session.user.login ? `@${session.user.login}` : "GitHub not linked"}</span>
          </div>
        )}
      </header>

      {error && <div className="error">{error}</div>}

      {team?.workError && (
        <div className="notice">
          Open work could not be read, so the column beside each name is blank —
          that is a failure to read GitHub, not an idle team. {team.workError}
        </div>
      )}

      {team && (
        <>
          <section>
            <h2>Away today</h2>
            <div className="card">
              {away.length === 0 ? (
                <p className="muted small">
                  Nobody is on approved leave today. Booked leave appears here the
                  day it starts, and the daily digest skips whoever is listed.
                </p>
              ) : (
                away.map((m) => (
                  <div className="row" key={m.id}>
                    <span className="when">{m.onLeave!.kind}</span>
                    <span className="what">{m.name ?? m.email}</span>
                    <span className="st pending">back after {m.onLeave!.ends_on}</span>
                  </div>
                ))
              )}
            </div>
          </section>

          {team.pods.map((pod) => (
            <section key={pod.pod}>
              <p className="pod">{pod.pod}</p>
              <div className="card">
                {pod.members.map((m) => (
                  <div className="person" key={m.id}>
                    <span className="id">
                      <b>
                        <Link href={`/person/${m.id}`} style={{ textDecoration: "none" }}>
                          {m.name ?? m.email ?? "unnamed"}
                        </Link>
                      </b>
                      <span>{m.gh_login ? `@${m.gh_login}` : "GitHub not linked"}</span>
                    </span>

                    <span className="work">
                      {m.open === null ? (
                        <span className="muted small">
                          {m.gh_login
                            ? "not read"
                            : "no GitHub login, so no work can be attributed to this account"}
                        </span>
                      ) : m.open.length === 0 ? (
                        <span className="muted small">nothing open</span>
                      ) : (
                        m.open.map((t, i) => (
                          <span key={`${t.repo}#${t.number}`}>
                            {i > 0 && <span className="muted"> · </span>}
                            <Link href={t.href}>{`#${t.number}`}</Link>{` ${t.title}`}
                          </span>
                        ))
                      )}
                    </span>

                    <span className="tags">
                      {m.onLeave && <span className="tag away">on leave · {m.onLeave.kind}</span>}
                      <span className="tag">{m.role}</span>
                      <span className="tag">{m.agent_tier}</span>
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ))}

          <section>
            <h2>Nobody&apos;s name on it</h2>
            <div className="card">
              {team.unassigned === null ? (
                <p className="muted small">Open issues could not be read — see above.</p>
              ) : team.unassigned.length === 0 ? (
                <p className="muted small">Every open issue has an assignee.</p>
              ) : (
                team.unassigned.map((t) => (
                  <div className="row" key={`${t.repo}#${t.number}`}>
                    <span className="when">{`#${t.number}`}</span>
                    <span className="what">
                      <Link href={t.href}>{t.title}</Link>
                      {team.repos.length > 1 && <span className="muted small">{` · ${t.repo}`}</span>}
                    </span>
                  </div>
                ))
              )}
            </div>
            <p className="muted small">
              Read live from GitHub. Anyone can take one of these from the board;
              a lead can hand one to somebody. Either way the name lands on the
              GitHub issue, which stays the only place assignment is recorded.
            </p>
          </section>
        </>
      )}

      <style dangerouslySetInnerHTML={{ __html: PEOPLE_CSS }} />
    </main>
  );
}
