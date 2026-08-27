// Who is here, what they have open, and who is away.
//
// The split is the same one the rest of the platform uses. Identity, pod and
// leave are the database's — GitHub knows nothing about either. Open work is
// GitHub's, read live, because a mirrored issue list is wrong within a day.
//
// Nothing here counts hours, logins or anything a person could be present for
// without shipping. docs/06: the moment time-online sits next to merged work,
// people optimise the easier number.

import { sql } from "@/lib/db";
import { ghFetch, expectList } from "@/app/lib/github";

export type Person = {
  id: string;
  name: string | null;
  email: string | null;
  gh_login: string | null;
  role: string;
  agent_tier: string;
  pod: string | null;
  lead_email: string | null;
};

export type TeamMember = Person & {
  onLeave: { kind: string; ends_on: string } | null;
  /** Open issues assigned to this person, live from GitHub. Null when unread. */
  open: { number: number; title: string }[] | null;
};

export type Team = {
  repo: string | null;
  pods: { pod: string; members: TeamMember[] }[];
  /** Open issues with nobody's name on them. Unassigned work is a fact, not a gap. */
  unassigned: { number: number; title: string }[] | null;
  /**
   * Why the open-work column is empty, when it is. "Nobody has anything open"
   * and "GitHub could not be read" look identical otherwise, and they send you
   * to completely different places to fix them.
   */
  workError: string | null;
};

export async function loadTeam(): Promise<Team> {
  const repo = process.env.OPS_REPO ?? null;

  const [people, away] = await Promise.all([
    sql<Person[]>`
      select id, name, email, gh_login, role, agent_tier, pod, lead_email
        from app_user
       where active
       order by pod nulls last, name nulls last`,
    sql<{ user_id: string; kind: string; ends_on: string }[]>`
      select user_id, kind, ends_on::text from on_leave_today`,
  ]);

  const onLeave = new Map(away.map((l) => [l.user_id, { kind: l.kind, ends_on: l.ends_on }]));

  // Open issues, live. A failure here degrades one column and says so; it does
  // not take the page down, because the team list is worth reading on its own.
  let byAssignee: Map<string, { number: number; title: string }[]> | null = null;
  let unassigned: { number: number; title: string }[] | null = null;
  let workError: string | null = null;

  if (!repo) {
    workError = "OPS_REPO is not set, so there is no repository to read open work from. Set it to owner/name.";
  } else {
    try {
      const { body } = await ghFetch(`/repos/${repo}/issues?state=open&per_page=100`);
      const issues = expectList(body, "issues").filter((i: any) => !i.pull_request);
      byAssignee = new Map();
      unassigned = [];
      for (const i of issues) {
        const entry = { number: i.number as number, title: i.title as string };
        const assignees: string[] = (i.assignees ?? []).map((a: any) => a.login);
        if (assignees.length === 0) unassigned.push(entry);
        for (const login of assignees) {
          byAssignee.set(login, [...(byAssignee.get(login) ?? []), entry]);
        }
      }
    } catch (e: any) {
      workError = e?.message ?? String(e);
    }
  }

  const members: TeamMember[] = people.map((p) => ({
    ...p,
    onLeave: onLeave.get(p.id) ?? null,
    // Not the same as an empty list. A person with no GitHub login has no work
    // that could be attributed to them at all, which is a different sentence
    // from "nothing is assigned to you today".
    open: !byAssignee || !p.gh_login ? null : byAssignee.get(p.gh_login) ?? [],
  }));

  const order = new Map<string, number>();
  const pods: Team["pods"] = [];
  for (const m of members) {
    const pod = m.pod ?? "No pod set";
    if (!order.has(pod)) { order.set(pod, pods.length); pods.push({ pod, members: [] }); }
    pods[order.get(pod)!].members.push(m);
  }

  return { repo, pods, unassigned, workError };
}

/**
 * The signed-in person, as the database knows them.
 *
 * The session carries id, role and tier already, but leave and the approval
 * queue turn on `email` and `lead_email`, and a token minted before those
 * existed would silently behave as though the person had no lead. Reading the
 * row is one query and removes the whole class of problem.
 */
export async function loadViewer(email: string): Promise<Person | null> {
  const [me] = await sql<Person[]>`
    select id, name, email, gh_login, role, agent_tier, pod, lead_email
      from app_user where email = ${email}`;
  return me ?? null;
}
