// Everything /analytics shows.
//
// There are no hours on this page and there will not be any. docs/06 is
// explicit: the moment time-online sits next to merged work, people optimise
// the easier number. The elapsed hours in cycle time and review latency are a
// different thing entirely — they measure how long a piece of *work* waited,
// not how long a *person* was at a desk, and nobody can make them look better
// by staying logged in.
//
// Every number here is a count of artifacts, or a duration between two of them.
// Nothing on this page can be improved by typing anything into this platform.
//
// The medians are medians on purpose. One task that sat over a long weekend
// drags a mean far enough to make a good fortnight look bad, and the reaction
// to that is an argument about the outlier rather than about the work.

import { sql } from "@/lib/db";
import { ghFetch, expectList } from "@/app/lib/github";
import { stageOf, branchIsForTask, STAGE } from "@/app/lib/progress";

/** A task with no artifact for this many days is worth asking about. */
export const STALL_DAYS = 3;

export type Analytics = {
  repo: string;
  /** Zero means the webhook has never delivered. Not a quiet fortnight. */
  eventsRecorded: number;
  cycle: { n: number; median: number | null; slowest: number | null };
  review: { approved: number; waiting: number; median: number | null };
  rework: { merged: number; reworked: number };
  claimed: {
    open: number;
    assigned: number;
    /** Assigned to somebody, with no branch, commit or pull request behind it. */
    assignedNoArtifact: { number: number; title: string; assignee: string }[];
  } | null;
  stalled: { number: number; title: string; assignee: string | null; stage: number; days: number | null }[] | null;
  /** Why the two GitHub-backed sections are null, when they are. */
  liveError: string | null;
  people: { login: string; merged: number; agentAuthored: number }[];
  costByAgent: { agent: string; runs: number; failed: number; cost: number }[];
  costByPerson: { name: string | null; runs: number; cost: number }[];
  spend: { total: number; runs: number };
};

export async function loadAnalytics(repo: string): Promise<Analytics> {
  const [events, cycle, review, rework, people, costByAgent, costByPerson, spend, activity] =
    await Promise.all([
      sql<{ n: number }[]>`select count(*)::int as n from gh_event where repo = ${repo}`,

      sql<any[]>`
        select count(*)::int as n,
               round(percentile_cont(0.5) within group (order by hours)::numeric, 1) as median,
               round(max(hours)::numeric, 1) as slowest
          from cycle_time where repo = ${repo}`,

      // A pull request with no approval yet is not a fast review, it is an
      // unfinished one — counted separately rather than folded into the median.
      sql<any[]>`
        select count(*) filter (where approved_at is not null)::int as approved,
               count(*) filter (where approved_at is null)::int     as waiting,
               round((percentile_cont(0.5) within group (order by hours)
                      filter (where hours is not null))::numeric, 1) as median
          from review_latency where repo = ${repo}`,

      // Rework: a task that was merged and then needed more commits. Not a
      // measure of sloppiness — it is a measure of how often "done" was not.
      sql<any[]>`
        select (select count(*) from cycle_time where repo = ${repo})::int as merged,
               (select count(*) from cycle_time c
                 where c.repo = ${repo}
                   and exists (select 1 from commit_event e
                                where e.repo = c.repo and e.issue_number = c.issue_number
                                  and e.committed_at > c.merged_at))::int as reworked`,

      // Attributed to whoever opened the pull request, never to whoever merged
      // it — that person is the reviewer, and crediting them would take the
      // author's work away twice.
      sql<any[]>`
        select payload->'pull_request'->'user'->>'login'  as login,
               count(*)::int                              as merged,
               count(*) filter (where agent_authored)::int as agent_authored
          from gh_event
         where repo = ${repo} and kind = 'pr_merged'
           and payload->'pull_request'->'user'->>'login' is not null
         group by 1 order by merged desc, login limit 50`,

      sql<any[]>`
        select agent, count(*)::int as runs,
               count(*) filter (where status = 'failure')::int as failed,
               coalesce(sum(cost_usd), 0)::float as cost
          from agent_run where repo = ${repo} group by agent order by cost desc`,

      sql<any[]>`
        select u.name, count(*)::int as runs, coalesce(sum(r.cost_usd), 0)::float as cost
          from agent_run r left join app_user u on u.id = r.requester_id
         where r.repo = ${repo} group by u.name order by cost desc`,

      sql<any[]>`
        select coalesce(sum(cost_usd), 0)::float as total, count(*)::int as runs
          from agent_run where repo = ${repo}`,

      // The last time anything happened against each task, from either source.
      sql<{ number: number; last_at: string }[]>`
        select number, max(at) as last_at from (
          select number, occurred_at as at from gh_event where repo = ${repo} and number is not null
          union all
          select issue_number as number, committed_at as at from commit_event
           where repo = ${repo} and issue_number is not null
        ) t group by number`,
    ]);

  const base = {
    repo,
    eventsRecorded: events[0].n,
    cycle: {
      n: cycle[0].n,
      median: cycle[0].median === null ? null : Number(cycle[0].median),
      slowest: cycle[0].slowest === null ? null : Number(cycle[0].slowest),
    },
    review: {
      approved: review[0].approved,
      waiting: review[0].waiting,
      median: review[0].median === null ? null : Number(review[0].median),
    },
    rework: { merged: rework[0].merged, reworked: rework[0].reworked },
    people: people.map((p) => ({ login: p.login, merged: p.merged, agentAuthored: p.agent_authored })),
    costByAgent: costByAgent.map((a) => ({ agent: a.agent, runs: a.runs, failed: a.failed, cost: a.cost })),
    costByPerson: costByPerson.map((p) => ({ name: p.name, runs: p.runs, cost: p.cost })),
    spend: { total: spend[0].total, runs: spend[0].runs },
  };

  // ---------------------------------------------------------------------
  // The two sections that need to know what is still open, which only GitHub
  // knows. A failure here blanks those two and says so; it does not take the
  // page down, and it never reports "nothing is stalled".
  // ---------------------------------------------------------------------
  try {
    const [issuesRes, branchesRes] = await Promise.all([
      ghFetch(`/repos/${repo}/issues?state=open&per_page=100`),
      ghFetch(`/repos/${repo}/branches?per_page=100`),
    ]);
    const issues = expectList(issuesRes.body, "issues").filter((i: any) => !i.pull_request);
    const branches: string[] = expectList(branchesRes.body, "branches").map((b: any) => b.name);

    const numbers = issues.map((i: any) => i.number);
    const [kinds, commits] = numbers.length
      ? await Promise.all([
          sql<{ kind: string; number: number }[]>`
            select kind, number from gh_event where repo = ${repo} and number = any(${numbers})`,
          sql<{ issue_number: number }[]>`
            select distinct issue_number from commit_event
             where repo = ${repo} and issue_number = any(${numbers})`,
        ])
      : [[], []];

    const committed = new Set(commits.map((c) => c.issue_number));
    const lastAt = new Map(activity.map((a) => [a.number, new Date(a.last_at).getTime()]));
    const now = Date.now();

    const rows = issues.map((i: any) => {
      const stage = stageOf({
        kinds: kinds.filter((k) => k.number === i.number).map((k) => k.kind),
        hasCommit: committed.has(i.number),
        hasBranch: branches.some((b) => branchIsForTask(b, i.number)),
      });
      const last = lastAt.get(i.number) ?? null;
      return {
        number: i.number as number,
        title: i.title as string,
        assignee: (i.assignee?.login ?? null) as string | null,
        stage,
        // Days since the last artifact. Null when there has never been one —
        // a different situation from "it went quiet", and shown as such.
        days: last === null ? null : Math.floor((now - last) / 86400000),
        openedDays: Math.floor((now - new Date(i.created_at).getTime()) / 86400000),
      };
    });

    const assigned = rows.filter((r) => r.assignee);

    return {
      ...base,
      liveError: null,
      claimed: {
        open: rows.length,
        assigned: assigned.length,
        // The gap this whole platform exists to close: somebody's name is on
        // it, and there is not one artifact to show for it.
        assignedNoArtifact: assigned
          .filter((r) => r.stage <= STAGE.opened)
          .map((r) => ({ number: r.number, title: r.title, assignee: r.assignee as string })),
      },
      stalled: rows
        .filter((r) => (r.days === null ? r.openedDays >= STALL_DAYS : r.days >= STALL_DAYS))
        .sort((a, b) => (b.days ?? b.openedDays) - (a.days ?? a.openedDays))
        .map(({ number, title, assignee, stage, days }) => ({ number, title, assignee, stage, days })),
    };
  } catch (e: any) {
    return {
      ...base,
      liveError: e?.message ?? String(e),
      claimed: null,
      stalled: null,
    };
  }
}
