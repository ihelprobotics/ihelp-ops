// Roles, tiers, and who may change them.
//
// Four roles and three agent tiers, and they answer different questions. The
// role says what you may do to other people's work and records; the tier says
// which agents you may dispatch, and grows as somebody learns what good looks
// like in this codebase. A new joiner is `member` / `week1`; neither is a
// judgement, both are a starting point.
//
// The permission table below is the single description of what a role means. It
// is data rather than prose because /admin renders it — a written list in a
// document and a check in the code drift apart, and then nobody can answer
// "what can a lead actually do" without reading the source.
//
// Every row here is enforced somewhere real. The enforcement is named in the
// `where` field so a reader can go and check rather than take it on trust, and
// so anybody changing a rule can find the other half of it.

export const ROLES = ["member", "lead", "cto", "founder"] as const;
export const TIERS = ["week1", "week2", "full"] as const;

export type Role = (typeof ROLES)[number];
export type Tier = (typeof TIERS)[number];

/** Who may open /admin and change other people's roles. */
export const ADMIN_ROLES: readonly string[] = ["cto", "founder"];
export const isAdmin = (role: string) => ADMIN_ROLES.includes(role);

/**
 * Who may turn a prompt into a set of issues.
 *
 * Opening one task is open to anyone with a linked GitHub login — it is one
 * piece of work, and the person doing it is the person who has to live with it.
 * Opening eight at once is a different act: it puts work on a board other
 * people read and plan around, and a vague prompt produces eight vague issues
 * faster than anyone can close them. So it sits with the people who already
 * decide what the team works on.
 *
 * This is not a second approval system — docs/06 rules that out, and nothing
 * here approves anything. It is who may *propose* work in bulk. Every issue it
 * opens is an ordinary GitHub issue that CODEOWNERS and branch protection
 * govern exactly as they govern any other.
 */
export const PLANNING_ROLES: readonly string[] = ["lead", "cto", "founder"];
export const canPlan = (role: string) => PLANNING_ROLES.includes(role);

export type Permission = {
  what: string;
  member: string;
  lead: string;
  cto: string;
  founder: string;
  /** Where this is actually enforced. */
  where: string;
};

const YES = "yes";
const NO = "—";

export const PERMISSIONS: Permission[] = [
  { what: "Sign in and read the board, team and analytics",
    member: YES, lead: YES, cto: YES, founder: YES,
    where: "middleware.ts — everything but the webhooks needs a session" },

  { what: "Book and withdraw your own leave",
    member: YES, lead: YES, cto: YES, founder: YES,
    where: "leave_book / leave_withdraw policies" },

  { what: "Take an unassigned task",
    member: "with GitHub linked", lead: "with GitHub linked", cto: "with GitHub linked", founder: "with GitHub linked",
    where: "canAssign() in app/lib/assign.ts" },

  { what: "Start a task, open a pull request, merge, comment",
    member: "with GitHub linked", lead: "with GitHub linked", cto: "with GitHub linked", founder: "with GitHub linked",
    where: "/api/tasks/[owner]/[name]/[number] — refused without a gh_login" },

  { what: "Dispatch agents",
    member: "up to your tier", lead: "up to your tier", cto: "up to your tier", founder: "any",
    where: "TIERS in /api/agents/run" },

  { what: "Break a prompt into issues and open them",
    member: NO, lead: "with GitHub linked", cto: "with GitHub linked", founder: "with GitHub linked",
    where: "canPlan() in /api/plan and /api/plan/open" },

  { what: "Talk to any agent about a task",
    member: YES, lead: YES, cto: YES, founder: YES,
    where: "/api/chat — tiers gate dispatch, not conversation" },

  { what: "Read somebody else's conversation with an agent",
    member: NO, lead: NO, cto: NO, founder: NO,
    where: "chat_thread_own / chat_message_own — one clause, no admin escape" },

  { what: "Assign work to other people, and reassign",
    member: NO, lead: YES, cto: YES, founder: YES,
    where: "assignsOthers() in app/lib/assign.ts" },

  { what: "Approve or reject leave",
    member: NO, lead: "your reports", cto: "everyone", founder: "everyone",
    where: "canDecide() and the leave_decide policy" },

  { what: "Read somebody else's leave and balance",
    member: NO, lead: "your reports", cto: "everyone", founder: "everyone",
    where: "leave_read / balance_read policies" },

  { what: "Read a 1:1 you did not write",
    member: NO, lead: NO, cto: "all, and it is logged", founder: NO,
    where: "app_reads_all_notes() — the CTO alone, by design" },

  { what: "Read feedback written about somebody else",
    member: NO, lead: NO, cto: YES, founder: NO,
    where: "feedback_read policy" },

  { what: "See who was nudged, and local editor sessions",
    member: "your own", lead: "your reports", cto: "everyone", founder: "everyone",
    where: "notification_read / local_session_read policies" },

  { what: "Change roles, tiers, pods and GitHub logins",
    member: NO, lead: NO, cto: YES, founder: YES,
    where: "isAdmin() — this page" },
];

export type PersonPatch = {
  role?: string;
  agent_tier?: string;
  pod?: string | null;
  lead_email?: string | null;
  gh_login?: string | null;
  active?: boolean;
};

/** GitHub's own rule. The database has the same constraint; this is so the
 *  refusal explains itself instead of arriving as a constraint violation. */
const GH_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Is this change coherent, and is this person allowed to make it?
 *
 * Returns the refusal, or null when allowed.
 *
 * `actor` is who is making the change, `subject` is whose row it is, and
 * `remainingAdmins` is how many admins would be left afterwards — the caller
 * counts it, because only the caller can see the table.
 */
export function validatePersonPatch(
  actor: { id: string; role: string },
  subject: { id: string; role: string },
  patch: PersonPatch,
  remainingAdmins: number
): string | null {
  if (!isAdmin(actor.role)) {
    return `Changing roles needs the cto or founder role. Yours is "${actor.role}".`;
  }

  // You cannot edit your own row here. Not because you are not trusted with it
  // — you already have every permission there is — but because the two ways it
  // goes wrong are both silent: promoting yourself leaves no second person who
  // agreed, and demoting yourself locks you out of the screen that could undo
  // it. Ask the other admin; that is what having two is for.
  if (actor.id === subject.id) {
    return "You cannot change your own row. Another admin can — which is the point: a role change should be something somebody else agreed to.";
  }

  if (patch.role !== undefined) {
    if (!(ROLES as readonly string[]).includes(patch.role)) {
      return `"${patch.role}" is not a role. It has to be one of: ${ROLES.join(", ")}.`;
    }
    // Losing the last admin means nobody can grant the role back, and the only
    // way out is SQL. Refused here rather than discovered later.
    if (isAdmin(subject.role) && !isAdmin(patch.role) && remainingAdmins < 1) {
      return "That would leave nobody able to change roles, and the only way back would be a hand-written SQL statement. Give somebody else the cto or founder role first.";
    }
  }

  if (patch.agent_tier !== undefined && !(TIERS as readonly string[]).includes(patch.agent_tier)) {
    return `"${patch.agent_tier}" is not an agent tier. It has to be one of: ${TIERS.join(", ")}.`;
  }

  if (patch.gh_login) {
    if (!GH_LOGIN.test(patch.gh_login)) {
      return `"${patch.gh_login}" is not a GitHub username. It is the attribution key — commits, reviews and CODEOWNERS all match on this exact string, so a URL or an @handle silently matches nothing.`;
    }
  }

  if (patch.lead_email && !EMAIL.test(patch.lead_email)) {
    return `"${patch.lead_email}" is not an email address. The lead is matched by email, because a lead may have no GitHub account at all.`;
  }

  if (patch.active === false && isAdmin(subject.role) && remainingAdmins < 1) {
    return "That would deactivate the last admin. Give somebody else the cto or founder role first.";
  }

  return null;
}
