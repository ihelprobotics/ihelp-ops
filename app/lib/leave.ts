// The rules a leave request has to satisfy, as functions rather than as
// validation scattered through a route handler.
//
// They live here because two things need them and must agree: /api/leave, which
// refuses a bad request, and db/people-check.mjs, which proves the refusals are
// real. A copy in the test would be testing something nobody ships.
//
// Nothing here talks to the database. Overlap and balance need rows, so those
// are two separate steps: this file says whether a request is *coherent*, the
// route says whether it *fits*.

export const LEAVE_KINDS = ["planned", "sick", "unpaid", "comp_off"] as const;
export type LeaveKind = (typeof LEAVE_KINDS)[number];

export const LEAVE_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;

export type LeaveInput = {
  kind: string;
  starts_on: string;
  ends_on: string;
  half_day?: boolean;
  reason?: string | null;
};

export type LeaveRange = { starts_on: string | Date; ends_on: string | Date };

/** YYYY-MM-DD, and a date that exists. new Date("2026-02-31") does not throw. */
function parseDay(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value ? null : value;
}

const day = (v: string | Date) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const diffDays = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

/**
 * How many days a request costs.
 *
 * This mirrors the `leave_taken` view in db/schema-people.sql deliberately, and
 * the view is the authority — the balance on screen is read from it, not
 * computed here. This exists so a person can be told "that is 3 days" while
 * they are still filling the form, and so an error can say how long the request
 * it is refusing actually was.
 */
export function daysOf(r: { starts_on: string | Date; ends_on: string | Date; half_day?: boolean }): number {
  if (r.half_day) return 0.5;
  return diffDays(day(r.starts_on), day(r.ends_on)) + 1;
}

/** Only planned and unpaid come off the annual entitlement — same as the view. */
export function countsAgainstBalance(kind: string): boolean {
  return kind === "planned" || kind === "unpaid";
}

/** Two ranges share at least one day. Inclusive at both ends, as leave is. */
export function overlaps(a: LeaveRange, b: LeaveRange): boolean {
  return day(a.starts_on) <= day(b.ends_on) && day(b.starts_on) <= day(a.ends_on);
}

export type Validated = { kind: LeaveKind; starts_on: string; ends_on: string; half_day: boolean; reason: string | null };

/**
 * Every refusal names the field and what would have been accepted. A leave form
 * that answers "invalid request" teaches the person to try combinations until
 * something works.
 *
 * One shape out, rather than a discriminated union on `ok`. This project builds
 * with `strict: false`, where narrowing a union by a boolean discriminant does
 * not happen — the caller would have to cast, and a cast around a validator is
 * how an unvalidated value gets through.
 */
export function validateLeave(input: LeaveInput): { error: string | null; value: Validated | null } {
  const no = (error: string) => ({ error, value: null });

  const kind = String(input?.kind ?? "");
  if (!(LEAVE_KINDS as readonly string[]).includes(kind)) {
    return no(`"${kind || "(nothing)"}" is not a kind of leave. It has to be one of: ${LEAVE_KINDS.join(", ")}.`);
  }

  const starts = parseDay(input?.starts_on);
  const ends = parseDay(input?.ends_on);
  if (!starts) return no(`"${String(input?.starts_on ?? "")}" is not a date. Use YYYY-MM-DD, for example 2026-09-14.`);
  if (!ends) return no(`"${String(input?.ends_on ?? "")}" is not a date. Use YYYY-MM-DD, for example 2026-09-16.`);

  if (diffDays(starts, ends) < 0) {
    return no(`Leave cannot end before it starts. You asked for ${starts} to ${ends}.`);
  }

  const half_day = !!input?.half_day;
  if (half_day && starts !== ends) {
    return no(`A half day is a single date, so start and end have to match. You asked for ${starts} to ${ends} as a half day.`);
  }

  const length = diffDays(starts, ends) + 1;
  if (length > 60) {
    return no(`${length} days is longer than this form is for. Anything over 60 days is a conversation with your lead, not a request.`);
  }

  // A four-digit year typo — 0226, 2062 — sails past every check above and
  // lands in the table as a range nobody will ever look at again.
  const year = Number(starts.slice(0, 4));
  if (year < 2024 || year > 2100) {
    return no(`${starts} is almost certainly a typo in the year. Leave is booked in this decade.`);
  }

  const reason = typeof input?.reason === "string" && input.reason.trim() ? input.reason.trim().slice(0, 500) : null;

  return { error: null, value: { kind: kind as LeaveKind, starts_on: starts, ends_on: ends, half_day, reason } };
}

/**
 * Who may decide a request.
 *
 * The CTO and the founder decide anything. A lead decides for the people whose
 * lead_email is theirs — and for nobody else, so "lead" is not a role that can
 * quietly approve across pods.
 *
 * Nobody approves their own leave, whatever their role. That is not distrust:
 * an approval is the record that someone else knew, and a self-approval records
 * nothing at all.
 *
 * Returns the refusal, or null when there is none — so the caller writes
 * `if (refusal) return 403`, and forgetting to check reads as obviously wrong
 * rather than as a boolean that happened to be truthy.
 */
export function canDecide(
  decider: { id: string; role: string; email: string | null },
  request: { user_id: string; requester_lead_email: string | null }
): string | null {
  if (decider.id === request.user_id) {
    return "You cannot approve your own leave. An approval is the record that somebody else knew you would be away; ask your lead or the CTO.";
  }
  if (decider.role === "cto" || decider.role === "founder") return null;
  if (decider.role === "lead") {
    if (request.requester_lead_email && decider.email && request.requester_lead_email.toLowerCase() === decider.email.toLowerCase()) {
      return null;
    }
    return "This person's lead is somebody else, so this request is not yours to decide. Leads decide for the people whose lead_email is their own address; the CTO decides for everyone.";
  }
  return `Deciding leave needs the lead, cto or founder role. Yours is "${decider.role}".`;
}
