// Who may put whose name on a task.
//
// A task carries exactly one name. GitHub allows several assignees, and a task
// with two owners has none — "somebody was going to do it" is the failure this
// whole platform exists to make impossible. So assignment replaces rather than
// adds, and the rules below decide who may do the replacing.
//
// Two ways a name gets onto a task, and both are first-class:
//
//   You take it. Anyone with a linked GitHub login can claim work nobody has
//   claimed. This is the normal path and needs no one's permission — a person
//   who can see the work should be able to start it.
//
//   Somebody gives it to you. A lead, the CTO or the founder can assign anyone,
//   including moving a task off a person who is stuck, on leave, or gone. That
//   is not a privilege over people; it is the ability to unblock work, and
//   without it a task belongs to whoever touched it first for ever.
//
// A lead who assigns does not need a GitHub login themselves. The platform
// assigns with its own token, so the delivery manager can hand work out without
// ever having written a line of code — which is the point of them.
//
// These are functions rather than checks inside a route because the button and
// the route must agree. A button offered where the route refuses is a UI that
// lies; a route that accepts what no button offers is a hole.

export const ASSIGNERS = ["lead", "cto", "founder"] as const;

export type Actor = {
  /** GitHub login, or null when the account has never been linked. */
  login: string | null;
  role: string;
};

/** Can this person hand work to other people? */
export const assignsOthers = (actor: Actor) =>
  (ASSIGNERS as readonly string[]).includes(actor.role);

/**
 * May `actor` set this task's assignee to `to`?
 *
 * `to` is a GitHub login, or null to clear the assignment. `current` is who
 * holds it now, or null if nobody does.
 *
 * Returns the refusal, or null when allowed — so a caller writes
 * `if (refusal) return 403`, and forgetting the check reads as obviously wrong.
 */
export function canAssign(
  actor: Actor,
  current: string | null,
  to: string | null
): string | null {
  const lead = assignsOthers(actor);
  const mine = !!actor.login && current?.toLowerCase() === actor.login.toLowerCase();
  const toMe = !!actor.login && to?.toLowerCase() === actor.login.toLowerCase();

  if (lead) {
    // The one thing a lead cannot do is assign work to an account that has no
    // git identity to own it — the same rule that stops that account starting a
    // task itself. Refusing here is what keeps the ledger free of work nobody
    // can be shown to have done.
    return null;
  }

  if (!actor.login) {
    return "Link your GitHub account before taking work. A task is owned by a git identity — commits, reviews and CODEOWNERS all match on it, so an unlinked account cannot hold one.";
  }

  if (to === null) {
    return mine
      ? null
      : `That task is assigned to ${current ? "@" + current : "nobody"}, so it is not yours to hand back. Ask your lead to move it.`;
  }

  if (!toMe) {
    return "Only a lead, the CTO or the founder can assign work to somebody else. You can take an unassigned task yourself.";
  }

  if (current && !mine) {
    return `@${current} already has that task. Two names on one task means neither owns it — ask them, or ask your lead to move it.`;
  }

  return null;
}

/**
 * What the platform should say once it has happened. Written here so the
 * message matches the rule that allowed it.
 */
export function assignmentMessage(ref: string, to: string | null, byLead: boolean, self: boolean): string {
  if (to === null) return `${ref} is unassigned again. It goes back on the board for somebody to take.`;
  if (self) return `${ref} is yours. Start it from this page — the branch will carry the task number, so everything you push attributes itself.`;
  return byLead
    ? `${ref} is assigned to @${to}. They will see it on their board.`
    : `${ref} is assigned to @${to}.`;
}
