// /person/[id] — a colleague's page.
//
// The id in the URL chooses the subject. It does not choose the reader: the
// reader is always the session, and every query about goals, 1:1s and feedback
// runs through withUser() with the session's identity. Changing the id in the
// address bar changes whose page you are looking at, never what you are allowed
// to see on it — that is decided by Postgres.
//
// If you land here and the notes are empty, the page says whether that is
// because none exist or because none are yours to read. Reporting the two
// identically is how people end up believing a colleague has no record.

import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { loadPerson } from "@/app/lib/person";
import { PEOPLE_CSS } from "@/app/ui/people-css";
import Nav from "@/app/ui/nav";
import { isAdmin } from "@/app/lib/roles";
import Person from "@/app/person/view";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  const session = await auth();
  const admin = isAdmin(session?.user?.role ?? "");

  // Postgres answers a malformed uuid with "invalid input syntax for type
  // uuid", which is a message about a parser rather than about the page.
  if (!UUID.test(id)) notFound();

  let view: Awaited<ReturnType<typeof loadPerson>> = null;
  let error = "";

  if (!session?.user?.id) {
    error = session?.user
      ? "Your session carries no account id, so row-level security has nothing to apply and every read fails closed. Sign out and back in."
      : "Sign in to see this page.";
  } else {
    try {
      view = await loadPerson({ id: session.user.id, role: session.user.role ?? "member" }, id);
    } catch (e: any) {
      error = e?.message ?? String(e);
    }
  }

  if (!error && !view) notFound();
  if (view) return <Person view={view} self={view.isSelf} admin={admin} />;

  return (
    <main className="wrap">
      <header className="top">
        <div>
          <h1>Person</h1>
          <Nav current="team" admin={admin} />
        </div>
      </header>
      <div className="error">{error}</div>
      <style dangerouslySetInnerHTML={{ __html: PEOPLE_CSS }} />
    </main>
  );
}
