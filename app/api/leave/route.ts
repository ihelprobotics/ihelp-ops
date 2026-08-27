// POST /api/leave — book leave.
//
// The request is always for the signed-in person. There is no user_id in the
// body and there will not be one: a form field that decides whose row is
// written is one typo away from booking somebody else's holiday, and one bug
// away from being the endpoint that lets anyone do it deliberately.
//
// Approval is somebody else's job — see /api/leave/[id]. What lands here is
// always 'pending', whoever asks.

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sql } from "@/lib/db";
import { loadViewer } from "@/app/lib/people";
import { clashingRequests } from "@/app/lib/leave-data";
import { validateLeave, daysOf, countsAgainstBalance } from "@/app/lib/leave";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const me = await loadViewer(session.user.email);
  if (!me) {
    return NextResponse.json(
      { error: `No account in app_user for ${session.user.email}. Signing in creates one, so this means the row was removed — ask your pod lead.` },
      { status: 403 }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "The request body is not JSON." }, { status: 400 });
  }

  const { error: incoherent, value: leave } = validateLeave(body);
  if (incoherent) return NextResponse.json({ error: incoherent }, { status: 400 });

  // Two rows covering the same day would put the same person in and out of
  // on_leave_today depending on which one a query happened to read first, and
  // the digest reads that view to decide who not to email.
  const clash = await clashingRequests(me.id, leave.starts_on, leave.ends_on);
  if (clash.length) {
    const c = clash[0];
    return NextResponse.json(
      { error: `You already have ${c.status} ${c.kind} leave covering ${c.starts_on} to ${c.ends_on}, which overlaps these dates. Cancel that one first, or pick dates outside it.` },
      { status: 409 }
    );
  }

  try {
    const [created] = await sql<{ id: string; status: string }[]>`
      insert into leave_request (user_id, kind, starts_on, ends_on, half_day, reason)
      values (${me.id}, ${leave.kind}, ${leave.starts_on}::date, ${leave.ends_on}::date,
              ${leave.half_day}, ${leave.reason})
      returning id, status`;

    const days = daysOf(leave);
    return NextResponse.json({
      id: created.id,
      status: created.status,
      days,
      message:
        `${days} day${days === 1 ? "" : "s"} of ${leave.kind} leave requested, ${leave.starts_on} to ${leave.ends_on}. ` +
        (countsAgainstBalance(leave.kind)
          ? "It comes off your balance once approved."
          : "Sick and comp-off leave do not come off the annual entitlement.") +
        (me.lead_email
          ? ` It is waiting on ${me.lead_email}.`
          : " You have no lead_email set, so it is waiting on the CTO."),
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: `The leave request was refused by the database: ${e?.message ?? String(e)}` },
      { status: 500 }
    );
  }
}
