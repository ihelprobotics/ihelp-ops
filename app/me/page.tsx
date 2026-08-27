// /me — your own goals, notes, feedback and delivered work.
//
// The same loader and the same component as /person/[id]. What is different is
// only what Postgres returns, because you are the subject of everything written
// about you and the policies say so. Building a separate "my page" would mean
// two implementations of one rule, and the day they disagreed the disagreement
// would be somebody seeing a note about themselves on one screen and not the
// other.

import { auth } from "@/auth";
import { loadPerson } from "@/app/lib/person";
import { PEOPLE_CSS } from "@/app/ui/people-css";
import Nav from "@/app/ui/nav";
import { isAdmin } from "@/app/lib/roles";
import Person from "@/app/person/view";

export const dynamic = "force-dynamic";

export default async function MePage() {
  const session = await auth();
  const admin = isAdmin(session?.user?.role ?? "");

  let view: Awaited<ReturnType<typeof loadPerson>> = null;
  let error = "";

  if (!session?.user?.id) {
    error = session?.user
      ? "Your session carries no account id, so nothing scoped to you can be read — every query would fail closed and show an empty page. Sign out and back in; the token predates the field."
      : "Sign in to see your own page.";
  } else {
    try {
      view = await loadPerson(
        { id: session.user.id, role: session.user.role ?? "member" },
        session.user.id
      );
      if (!view) error = "There is no app_user row for your session. Signing in creates one, so this means it was removed — ask your pod lead.";
    } catch (e: any) {
      error = e?.message ?? String(e);
    }
  }

  if (view) return <Person view={view} self admin={admin} />;

  return (
    <main className="wrap">
      <header className="top">
        <div>
          <h1>Me</h1>
          <Nav current="me" admin={admin} />
        </div>
      </header>
      <div className="error">{error}</div>
      <style dangerouslySetInnerHTML={{ __html: PEOPLE_CSS }} />
    </main>
  );
}
