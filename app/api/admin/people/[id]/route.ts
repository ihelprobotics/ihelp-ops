// POST /api/admin/people/<id>
//
// The one place a person's role, tier, pod, lead and GitHub login change.
//
// Everything this route can do is enforced twice: the rules in
// app/lib/roles.ts decide whether the change is coherent and permitted, and the
// database constraint on gh_login refuses a value that is not a username
// whatever this route thinks. Neither is decoration — the constraint exists
// because a gh_login was once set to a full profile URL, which read as merely
// ugly while silently breaking every system that matches on a username.
//
// This route writes as the owner rather than through withUser. app_user's
// policy grants reads to anybody signed in and writes to nobody, deliberately:
// accounts are created by the sign-in callback and edited here, both of which
// run as the platform. The authorisation is the check below, and it is the only
// one — which is why it is the first thing the route does.

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sql } from "@/lib/db";
import { validatePersonPatch, isAdmin, type PersonPatch } from "@/app/lib/roles";

type Ctx = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request, { params }: Ctx) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const id = (await params).id;
  if (!UUID.test(id)) {
    return NextResponse.json({ error: `"${id}" is not an account id.` }, { status: 400 });
  }

  // The actor's role is read from the database, not from the session token. A
  // token is minted at sign-in and lives for days; a role removed this morning
  // has to take effect this morning, not whenever that person next signs in.
  const [actor] = await sql<{ id: string; role: string }[]>`
    select id, role from app_user where email = ${session.user.email}`;
  if (!actor) {
    return NextResponse.json({ error: "No account for this email." }, { status: 403 });
  }
  if (!isAdmin(actor.role)) {
    return NextResponse.json(
      { error: `Changing roles needs the cto or founder role. Yours is "${actor.role}".` },
      { status: 403 }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "The request body is not JSON." }, { status: 400 });
  }

  const [subject] = await sql<{ id: string; role: string; name: string | null }[]>`
    select id, role, name from app_user where id = ${id}`;
  if (!subject) {
    return NextResponse.json({ error: "There is no account with that id." }, { status: 404 });
  }

  // Blank strings from a form mean "clear it", not "set it to empty".
  const blankToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

  const patch: PersonPatch = {};
  if (body.role !== undefined) patch.role = String(body.role);
  if (body.agent_tier !== undefined) patch.agent_tier = String(body.agent_tier);
  if (body.pod !== undefined) patch.pod = blankToNull(body.pod) as string | null;
  if (body.lead_email !== undefined) patch.lead_email = blankToNull(body.lead_email) as string | null;
  if (body.gh_login !== undefined) patch.gh_login = blankToNull(body.gh_login) as string | null;
  if (body.active !== undefined) patch.active = !!body.active;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  }

  // How many admins would be left if this change went through. Counted here
  // because only this side can see the table, and the rule that needs it —
  // never remove the last person who can grant the role back — cannot be
  // checked without it.
  const [{ n: remainingAdmins }] = await sql<{ n: number }[]>`
    select count(*)::int as n from app_user
     where active and role in ('cto', 'founder') and id <> ${id}`;

  const refusal = validatePersonPatch(actor, subject, patch, remainingAdmins);
  if (refusal) return NextResponse.json({ error: refusal }, { status: 403 });

  try {
    const [updated] = await sql<any[]>`
      update app_user set ${sql(patch as Record<string, any>)}
       where id = ${id}
      returning id, name, email, gh_login, role, agent_tier, pod, lead_email, active`;

    const said = Object.entries(patch)
      .map(([k, v]) => `${k} → ${v === null ? "cleared" : v}`)
      .join(", ");
    return NextResponse.json({
      person: updated,
      message: `${subject.name ?? "That account"}: ${said}.`,
    });
  } catch (e: any) {
    // The gh_login constraint fires here when a value looks like a username to
    // the regex above but not to Postgres. Passing the message through is what
    // makes the difference findable.
    return NextResponse.json(
      { error: `The database refused that change: ${e?.message ?? String(e)}` },
      { status: 400 }
    );
  }
}
