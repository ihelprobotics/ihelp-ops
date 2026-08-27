// What /leave reads: one person's balance and history, and the queue of
// requests they are allowed to decide.
//
// Leave is in this platform for one reason, stated in docs/06: the Escalator
// has to know who is away, so that a person on approved sick leave is not
// flagged as stalled and emailed about it. It is not an HR module, and nothing
// here is a step towards one.
//
// Every query runs inside withUser(), so the policies in db/schema-leave-rls.sql
// decide what comes back. The WHERE clauses below are still scoped by the id on
// the session — but they are now the second line of defence rather than the
// only one. Forgetting one returns zero rows instead of everybody's leave.
//
// The one deliberate exception is `on_leave_today`, read at the bottom. It is a
// view, and a view executes with its owner's row-level security rather than the
// caller's, so it answers for the whole company. That is intended: who is away
// today is already on /team for everyone, and the Escalator and the digest both
// read exactly this view.

import type postgres from "postgres";
import { withUser } from "@/lib/db";
import type { Person } from "@/app/lib/people";

/** The transaction withUser() hands to its callback. */
export type Tx = postgres.TransactionSql;

export type LeaveRow = {
  id: string;
  kind: string;
  starts_on: string;
  ends_on: string;
  half_day: boolean;
  reason: string | null;
  status: string;
  decision_note: string | null;
  decided_at: string | null;
  decided_by_name: string | null;
  created_at: string;
};

export type QueueRow = LeaveRow & {
  user_id: string;
  requester_name: string | null;
  requester_pod: string | null;
  requester_lead_email: string | null;
};

export type Balance = {
  year: number;
  entitled: number;
  carried_over: number;
  taken: number;
  remaining: number;
};

export type LeaveView = {
  year: number;
  balance: Balance | null;
  /** Why there is no balance, when there is none. Never a silent 12. */
  balanceMissing: string | null;
  history: LeaveRow[];
  /** Null when this person decides nothing — different from an empty queue. */
  queue: QueueRow[] | null;
  awayToday: { name: string | null; kind: string; ends_on: string }[];
};

export async function loadLeave(viewer: Person, year = new Date().getFullYear()): Promise<LeaveView> {
  const decides = viewer.role === "cto" || viewer.role === "founder" || viewer.role === "lead";
  const decidesEverything = viewer.role === "cto" || viewer.role === "founder";

  const [entitlement, taken, history, awayToday, queue] = await withUser(viewer.id, viewer.role, (tx) => {
    // The shared column list, built from the transaction so it is bound to the
    // same connection as the queries that embed it. At module scope it would
    // also open the pool at import, which next build does for every route —
    // turning a missing DATABASE_URL into a failed build rather than the
    // message that names it.
    const row = tx`
      l.id, l.kind, l.starts_on::text, l.ends_on::text, l.half_day, l.reason, l.status,
      l.decision_note, l.decided_at, l.created_at,
      d.name as decided_by_name
    `;

    return Promise.all([
    tx<{ entitled: string; carried_over: string }[]>`
      select entitled, carried_over from leave_balance
       where user_id = ${viewer.id} and year = ${year}`,

    // The view is the authority on how days are counted, so the number on
    // screen and the number in an analytics query cannot disagree.
    tx<{ days: string }[]>`
      select days from leave_taken where user_id = ${viewer.id} and year = ${year}`,

    tx<LeaveRow[]>`
      select ${row}
        from leave_request l
        left join app_user d on d.id = l.decided_by
       where l.user_id = ${viewer.id}
       order by l.starts_on desc, l.created_at desc
       limit 100`,

    tx<{ name: string | null; kind: string; ends_on: string }[]>`
      select name, kind, ends_on::text from on_leave_today order by name nulls last`,

    decides
      ? tx<QueueRow[]>`
          select ${row}, l.user_id,
                 u.name as requester_name, u.pod as requester_pod, u.lead_email as requester_lead_email
            from leave_request l
            join app_user u on u.id = l.user_id
            left join app_user d on d.id = l.decided_by
           where l.status = 'pending'
             and l.user_id <> ${viewer.id}
             and (${decidesEverything}::boolean or lower(u.lead_email) = lower(${viewer.email ?? ""}))
           order by l.starts_on`
        : Promise.resolve(null),
    ]);
  });

  // A missing entitlement row is a missing entitlement row. Defaulting to the
  // 12 in the schema would put a number on screen that nobody agreed to, and
  // the person would plan a holiday against it.
  const balance: Balance | null = entitlement.length
    ? (() => {
        const entitled = Number(entitlement[0].entitled);
        const carried_over = Number(entitlement[0].carried_over);
        const used = Number(taken[0]?.days ?? 0);
        return { year, entitled, carried_over, taken: used, remaining: entitled + carried_over - used };
      })()
    : null;

  return {
    year,
    balance,
    balanceMissing: balance
      ? null
      : `There is no row in leave_balance for you for ${year}, so this platform does not know your entitlement and will not guess at one. Ask your lead to add it — until then you can still book leave, and it will still be approved and counted.`,
    history,
    queue: queue as QueueRow[] | null,
    awayToday,
  };
}

/**
 * Requests that already cover any of these dates. Used to refuse a double
 * booking with the dates named, rather than storing two overlapping rows and
 * letting the digest decide which one it believes.
 *
 * Cancelled and rejected requests do not count — those dates are free again.
 *
 * Takes the transaction rather than opening its own, so that the check and the
 * insert it guards happen as one person, in one transaction, under one set of
 * policies. Two separate connections would leave a gap in which the same dates
 * could be booked twice.
 */
export async function clashingRequests(
  tx: Tx,
  userId: string,
  starts_on: string,
  ends_on: string
) {
  return tx<{ id: string; kind: string; starts_on: string; ends_on: string; status: string }[]>`
    select id, kind, starts_on::text, ends_on::text, status
      from leave_request
     where user_id = ${userId}
       and status in ('pending', 'approved')
       and starts_on <= ${ends_on}::date
       and ends_on   >= ${starts_on}::date`;
}
