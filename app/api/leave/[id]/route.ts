// POST /api/leave/[id] — approve, reject, or withdraw a request.
//
// Who may decide is worked out in app/lib/leave.ts, in one function, because
// the same rule has to hold in the queue that lists the requests and in the
// route that acts on them. A queue that shows a request the route then refuses
// is a UI that lies, and a route that accepts one the queue would not show is a
// hole.
//
// The decision is recorded with a name and a time against it. An approval whose
// author is not stored is not an approval — it is a status field that changed.

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { withUser } from "@/lib/db";
import { loadViewer } from "@/app/lib/people";
import { canDecide } from "@/app/lib/leave";

type Ctx = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request, { params }: Ctx) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const id = (await params).id;
  // Postgres answers a malformed uuid with "invalid input syntax for type
  // uuid", which describes a parser rather than the thing that was wrong.
  if (!UUID.test(id)) {
    return NextResponse.json({ error: `"${id}" is not a leave request id.` }, { status: 400 });
  }

  const me = await loadViewer(session.user.email);
  if (!me) {
    return NextResponse.json({ error: `No account in app_user for ${session.user.email}.` }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "The request body is not JSON." }, { status: 400 });
  }

  const action = String(body?.action ?? "");
  if (!["approve", "reject", "cancel"].includes(action)) {
    return NextResponse.json(
      { error: `Unknown action "${action}". This route accepts approve, reject or cancel.` },
      { status: 400 }
    );
  }

  // Read as this person. A request they may not see comes back as no row, and
  // is answered with the same 404 as one that does not exist — which is the
  // correct answer either way: it is not theirs to know about.
  const [request] = await withUser(me.id, me.role, (tx) => tx<{ id: string; user_id: string; status: string; kind: string; starts_on: string; ends_on: string; requester_name: string | null; requester_lead_email: string | null }[]>`
    select l.id, l.user_id, l.status, l.kind, l.starts_on::text, l.ends_on::text,
           u.name as requester_name, u.lead_email as requester_lead_email
      from leave_request l join app_user u on u.id = l.user_id
     where l.id = ${id}`);

  if (!request) {
    return NextResponse.json({ error: "There is no leave request with that id, or it is not yours to see. It may have been withdrawn." }, { status: 404 });
  }
  if (request.status !== "pending") {
    return NextResponse.json(
      { error: `That request is already ${request.status}, so there is nothing left to decide. A decision is not reversed here — book new dates instead.` },
      { status: 409 }
    );
  }

  // Withdrawing your own request is not a decision and needs no role.
  if (action === "cancel") {
    if (request.user_id !== me.id) {
      return NextResponse.json(
        { error: "That request is not yours to withdraw. Reject it instead, if it is yours to decide." },
        { status: 403 }
      );
    }
    // The policy allows this exact transition and no other: your own row, while
    // pending, becoming cancelled. Writing `status = 'approved'` here would be
    // refused by Postgres, not merely by the code above.
    await withUser(me.id, me.role, (tx) => tx`
      update leave_request
         set status = 'cancelled', decided_by = ${me.id}, decided_at = now()
       where id = ${id} and status = 'pending'`);
    return NextResponse.json({ status: "cancelled", message: `Withdrawn — ${request.starts_on} to ${request.ends_on} is free again.` });
  }

  const refusal = canDecide(
    { id: me.id, role: me.role, email: me.email },
    { user_id: request.user_id, requester_lead_email: request.requester_lead_email }
  );
  if (refusal) return NextResponse.json({ error: refusal }, { status: 403 });

  const note = typeof body?.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : null;
  if (action === "reject" && !note) {
    return NextResponse.json(
      { error: "A rejection needs a reason. The person has to be able to read why, and \"rejected\" on its own is the kind of decision that gets asked about in person instead." },
      { status: 400 }
    );
  }

  const status = action === "approve" ? "approved" : "rejected";
  await withUser(me.id, me.role, (tx) => tx`
    update leave_request
       set status = ${status}, decided_by = ${me.id}, decided_at = now(), decision_note = ${note}
     where id = ${id} and status = 'pending'`);

  return NextResponse.json({
    status,
    message:
      status === "approved"
        ? `Approved. ${request.requester_name ?? "They"} will appear in on_leave_today from ${request.starts_on}, and the daily digest will skip them rather than ask why nothing shipped.`
        : `Rejected, with your note. ${request.requester_name ?? "They"} can read it on their own leave page.`,
  });
}
