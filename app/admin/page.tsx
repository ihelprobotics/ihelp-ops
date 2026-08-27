// /admin — accounts, roles and tiers, and what each role actually means.
//
// Only the CTO and the founder reach this page. Everybody else gets told so
// rather than getting a blank screen: a page that renders nothing looks broken,
// and somebody then spends ten minutes deciding whether it is.
//
// The permission table is rendered from app/lib/roles.ts, not written out here.
// A table in a document and a check in the code drift apart within a month, and
// then nobody can answer "what can a lead actually do" without reading source.
// Each row names where it is enforced, so a reader can go and confirm it.

import { auth } from "@/auth";
import { sql } from "@/lib/db";
import { isAdmin, PERMISSIONS, ROLES } from "@/app/lib/roles";
import { PEOPLE_CSS } from "@/app/ui/people-css";
import Nav from "@/app/ui/nav";
import PersonRow, { type Person } from "./person-row";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await auth();

  // Read the role from the database rather than the session. A token lives for
  // days; a role granted this morning should work this morning.
  const [me] = session?.user?.email
    ? await sql<{ id: string; role: string; name: string | null }[]>`
        select id, role, name from app_user where email = ${session.user.email}`
    : [];

  const allowed = !!me && isAdmin(me.role);

  const people = allowed
    ? await sql<Person[]>`
        select id, name, email, gh_login, role, agent_tier, pod, lead_email, active
          from app_user
         order by active desc,
                  case role when 'founder' then 0 when 'cto' then 1 when 'lead' then 2 else 3 end,
                  name nulls last`
    : [];

  const admins = people.filter((p) => p.active && isAdmin(p.role));

  return (
    <main className="wrap">
      <header className="top">
        <div>
          <h1>Accounts and roles</h1>
          <p className="sub">{allowed ? `${people.length} accounts · ${admins.length} can change roles` : "restricted"}</p>
          <Nav current="admin" admin={allowed} />
        </div>
        {me && (
          <div className="who">
            <b>{me.name}</b>
            <span>{me.role}</span>
          </div>
        )}
      </header>

      {!allowed && (
        <div className="notice">
          This page is for the CTO and the founder — it is where roles, agent
          tiers and GitHub logins are set, so it is deliberately narrow.
          {me ? ` Your role is "${me.role}".` : " Sign in to see your own role."}{" "}
          The table below is the whole of what each role can do, and is worth
          reading whatever yours is.
        </div>
      )}

      {allowed && (
        <>
          <section>
            <h2>People</h2>
            <div className="card">
              {people.map((p) => (
                <PersonRow key={p.id} person={p} isSelf={p.id === me.id} />
              ))}
            </div>
            <p className="muted small">
              An account appears here the first time somebody signs in with
              Google. It starts as <code>member</code> on <code>week1</code> with
              no GitHub login — which is a starting point, not a judgement.
            </p>
            <p className="muted small">
              <b>The GitHub login is the one that matters.</b> Until it is set,
              that person can read, comment and book leave, but cannot take a
              task, start one, or run an agent — work has to be attributable to a
              git identity. It must be the username exactly: not a URL, not an
              @handle, not a display name.
            </p>
          </section>

          {admins.length === 1 && (
            <div className="notice">
              <b>{admins[0].name ?? "One account"}</b> is the only person who can
              change roles. Nothing can take that role away from them — the last
              admin is protected, because the way back would otherwise be a
              hand-written SQL statement. Give somebody else <code>cto</code> or{" "}
              <code>founder</code> so this does not rest on one account.
            </div>
          )}
        </>
      )}

      <section>
        <h2>What each role can do</h2>
        <div className="card">
          <div className="perms">
            <div className="phead">
              <span>Can</span>
              {ROLES.map((r) => <span key={r} className="pcol">{r}</span>)}
            </div>
            {PERMISSIONS.map((p) => (
              <div className="prow2" key={p.what}>
                <span className="pwhat">
                  {p.what}
                  <span className="muted small">{` · ${p.where}`}</span>
                </span>
                <span className={"pcol " + (p.member === "—" ? "no" : "yes")}>{p.member}</span>
                <span className={"pcol " + (p.lead === "—" ? "no" : "yes")}>{p.lead}</span>
                <span className={"pcol " + (p.cto === "—" ? "no" : "yes")}>{p.cto}</span>
                <span className={"pcol " + (p.founder === "—" ? "no" : "yes")}>{p.founder}</span>
              </div>
            ))}
          </div>
          <p className="muted small" style={{ marginTop: 12 }}>
            Two of these are worth saying out loud. <b>Only the CTO reads a 1:1
            they did not write</b> — not the founder, not a lead — and every such
            read appears in the subject&apos;s own access log. And <b>nothing is
            written about a person that the person cannot read</b>: there are no
            private manager files, which is enforced by Postgres rather than
            asked for in a guideline.
          </p>
        </div>
      </section>

      <style dangerouslySetInnerHTML={{ __html: PEOPLE_CSS + ADMIN_CSS }} />
    </main>
  );
}

const ADMIN_CSS = `
  .prow { display: grid; grid-template-columns: 210px 1fr; gap: 10px 14px; padding: 13px 0; border-top: 1px solid #1E2A35; align-items: start; }
  .prow:first-child { border-top: 0; }
  .prow.off { opacity: .55; }
  .pid b { display: block; font-weight: 500; font-size: 13px; }
  .pid span { font-size: 11px; font-family: ui-monospace, monospace; color: #4E6472; }
  .perms { display: flex; flex-direction: column; overflow-x: auto; }
  .phead, .prow2 { display: grid; grid-template-columns: minmax(260px, 1fr) repeat(4, 92px); gap: 8px; align-items: baseline; padding: 7px 0; }
  .phead { border-bottom: 1px solid #26343F; font-family: ui-monospace, monospace; font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #78909F; }
  .prow2 { border-top: 1px solid #1E2A35; font-size: 12px; }
  .prow2:first-of-type { border-top: 0; }
  .pwhat { display: flex; flex-direction: column; gap: 2px; }
  .pcol { font-size: 11px; font-family: ui-monospace, monospace; }
  .pcol.yes { color: #4FD1C5; }
  .pcol.no { color: #4E6472; }
`;
