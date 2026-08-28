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
import { repos, taskHref } from "@/app/lib/repos";
import { openWorkForAll } from "@/app/lib/work";

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
  open: { repo: string; number: number; title: string; href: string }[] | null;
};

export type Team = {
  /** Every repository the board reports on. */
  repos: string[];
  pods: { pod: string; members: TeamMember[] }[];
  /** Open issues with nobody's name on them. Unassigned work is a fact, not a gap. */
  unassigned: { repo: string; number: number; title: string; href: string }[] | null;
  /**
   * Why the open-work column is empty, when it is. "Nobody has anything open"
   * and "GitHub could not be read" look identical otherwise, and they send you
   * to completely different places to fix them.
   */
  workError: string | null;
};

type Work = { repo: string; number: number; title: string; href: string };

export async function loadTeam(): Promise<Team> {
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

  // Open issues across every configured repository, live. A failure degrades
  // one column and says so; it does not take the page down, because the team
  // list is worth reading on its own.
  let byAssignee: Map<string, Work[]> | null = null;
  let unassigned: Work[] | null = null;
  let workError: string | null = null;
  let names: string[] = [];

  try {
    const list = await repos();
    names = list.map((r) => r.full);

    const perRepo = await openWorkForAll(names);
    const failed = perRepo.filter((r) => r.error);
    if (failed.length) {
      workError = `${failed.length === 1 ? "One repository" : failed.length + " repositories"} could not be read: ${failed.map((f) => f.repo + " — " + f.error).join("; ")}`;
    }

    byAssignee = new Map();
    unassigned = [];
    for (const { repo, issues } of perRepo) {
      for (const i of issues) {
        const entry: Work = { repo, number: i.number, title: i.title, href: taskHref(repo, i.number) };
        // One name or none, matching what the board and the task page enforce.
        // A task GitHub still has two names on shows under both, which is how
        // you would find out it happened.
        const assignees: string[] = (i.assignees ?? []).map((a: any) => a.login);
        if (assignees.length === 0) unassigned.push(entry);
        for (const login of assignees) {
          byAssignee.set(login, [...(byAssignee.get(login) ?? []), entry]);
        }
      }
    }
  } catch (e: any) {
    workError = e?.message ?? String(e);
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

  return { repos: names, pods, unassigned, workError };
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
