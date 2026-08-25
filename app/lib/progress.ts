// The seven stages, in one place.
//
// Status is derived from artifacts and never typed by anyone, so there is
// exactly one ladder and every screen climbs it. Two copies would drift, and
// the first symptom is a task reading 60% on the board and 75% on its own page
// — which is exactly the doubt this platform exists to remove. The board and
// /task/[number] both call stageOf, and neither computes its own.

export const STAGE = {
  opened: 10,
  branched: 20,
  committed: 40,
  pr_open: 60,
  checks_green: 75,
  approved: 90,
  merged: 100,
} as const;

/** What the platform actually knows about a task. Nothing here is self-reported. */
export type Evidence = {
  /** gh_event.kind values recorded against this task number. */
  kinds: string[];
  /** A commit carrying the iHelp-Task trailer for this task. */
  hasCommit: boolean;
  /** A branch on GitHub named for this task. */
  hasBranch: boolean;
};

export function stageOf({ kinds, hasCommit, hasBranch }: Evidence): number {
  if (kinds.includes("pr_merged")) return STAGE.merged;
  if (kinds.includes("review_submitted")) return STAGE.approved;
  if (kinds.includes("pr_opened")) {
    // Only promote past 60 when a green run is actually on record. Absence of a
    // failure is not evidence of a pass.
    return kinds.includes("workflow_success") ? STAGE.checks_green : STAGE.pr_open;
  }
  if (hasCommit) return STAGE.committed;
  if (hasBranch) return STAGE.branched;
  return STAGE.opened;
}

/**
 * The artifact behind the number. A bare percentage invites the question "says
 * who?", and the answer is always a thing that happened in GitHub.
 */
export function stageLabel(progress: number): string {
  if (progress >= STAGE.merged) return "Merged";
  if (progress >= STAGE.approved) return "Approved by a human";
  if (progress >= STAGE.checks_green) return "Checks green";
  if (progress >= STAGE.pr_open) return "Pull request open";
  if (progress >= STAGE.committed) return "First commit landed";
  if (progress >= STAGE.branched) return "Branch created";
  return "Issue opened";
}

/**
 * Does this branch belong to task n?
 *
 * Two shapes are legitimate: task/<n>/<slug> when a person starts a task, and
 * agent/<agent>/issue-<n> when agent-run.yml does. The issue number is matched
 * as a whole number on purpose — `includes("issue-1")` also matches
 * `issue-10`, which would show task #1 as branched because somebody started
 * #10, and there is nothing on the screen that would give that away.
 */
export function branchIsForTask(branch: string, n: number): boolean {
  if (branch.startsWith(`task/${n}/`)) return true;
  const agent = /^agent\/[a-z-]+\/issue-(\d+)$/.exec(branch);
  return agent ? Number(agent[1]) === n : false;
}
