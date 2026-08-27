// Everything /me and /person/[id] show about one person.
//
// Two rules from docs/06 decide the whole shape of this file:
//
//   Nothing is written about a person that the person cannot read. There are no
//   private manager files.
//
//   1:1 visibility: the subject always; the author; the CTO reads all. The
//   delivery manager reads only what they wrote. Reads by anyone who is neither
//   author nor subject are logged, and the subject can see that log.
//
// Neither is implemented here. Both are implemented in Postgres, in the
// policies in db/schema-people-growth.sql, and this file goes through
// withUser() so that they apply. An application-level filter would be a coding
// convention that one forgotten WHERE clause defeats — and the mistake would be
// somebody reading a private conversation about a colleague.
//
// The goals, notes and feedback queries read the BASE TABLES, never the
// goal_progress view, even though the view computes exactly the counts wanted.
// A view executes with its owner's row-level security, not the caller's, so
// reading through it would make the policy that applies depend on who ran
// CREATE VIEW. Off the base tables, the policy is unambiguously the reader's.

import { sql, withUser } from "@/lib/db";

export type Viewer = { id: string; role: string };

export type Goal = {
  id: string;
  cycle: string;
  statement: string;
  status: string;
  starts_on: string;
  due_on: string;
  closing_note: string | null;
  /** Counts, deliberately never a score. docs/06: a percentage against a person's name. */
  evidence_linked: number;
  evidence_landed: number;
  evidence: { kind: string; url: string; label: string | null; landed: boolean }[];
};

export type Note = {
  id: string;
  held_on: string;
  author: string | null;
  authoredByViewer: boolean;
  notes: string | null;
  agreed_actions: string | null;
};

export type PersonView = {
  subject: {
    id: string; name: string | null; email: string | null; gh_login: string | null;
    role: string; agent_tier: string; pod: string | null; lead_email: string | null;
  };
  isSelf: boolean;
  goals: Goal[];
  oneOnOnes: Note[];
  feedback: { id: string; body: string; shared_at: string; author: string | null }[];
  /**
   * Why the notes list may be short. Row-level security returns rows or it does
   * not; it never explains itself, so an empty list means "none exist" and
   * "none you may read" identically. Saying which is the whole point.
   */
  notesGate: string | null;
  /** Who has opened notes about this person. Shown to the subject only. */
  accessLog: { reader: string | null; read_at: string }[] | null;
  /** Changes made to this person's own account. Shown to the subject only. */
  accountChanges: { changed: Record<string, { from: string | boolean | null; to: string | boolean | null }>; changed_at: string; actor: string | null }[] | null;
  delivered: {
    merged: number; mergedAgentAuthored: number; opened: number;
    reviews: number; commits: number;
    cycleHours: number | null; cycleSample: number;
  } | null;
  /** Why `delivered` is null, when it is. */
  deliveredMissing: string | null;
  /** Zero events anywhere is the webhook, not a quiet quarter. */
  eventsRecorded: number;
};

export async function loadPerson(viewer: Viewer, subjectId: string): Promise<PersonView | null> {
  if (!viewer.id) {
    throw new Error(
      "The signed-in session carries no account id, so no row-level security context can be set and every read would fail closed. Sign out and back in — the token predates the field."
    );
  }

  const [subject] = await sql<PersonView["subject"][]>`
    select id, name, email, gh_login, role, agent_tier, pod, lead_email
      from app_user where id = ${subjectId}`;
  if (!subject) return null;

  const isSelf = viewer.id === subject.id;

  // ---------------------------------------------------------------------
  // Everything the policies guard, inside one transaction that carries the
  // reader's identity. Outside withUser these four tables return nothing.
  // ---------------------------------------------------------------------
  const guarded = await withUser(viewer.id, viewer.role, async (tx) => {
    const goals = await tx<any[]>`
      select g.id, g.cycle, g.statement, g.status, g.starts_on::text, g.due_on::text, g.closing_note,
             count(e.id)::int                         as evidence_linked,
             count(e.id) filter (where e.landed)::int as evidence_landed
        from goal g
        left join goal_evidence e on e.goal_id = g.id
       where g.subject_id = ${subject.id}
       group by g.id
       order by g.due_on desc
       limit 50`;

    const evidence = goals.length
      ? await tx<any[]>`
          select goal_id, kind, url, label, landed from goal_evidence
           where goal_id = any(${goals.map((g) => g.id)}) order by added_at`
      : [];

    const oneOnOnes = await tx<any[]>`
      select id, held_on::text, author_id, subject_id, notes, agreed_actions
        from one_on_one where subject_id = ${subject.id}
       order by held_on desc limit 50`;

    const feedback = await tx<any[]>`
      select id, body, shared_at, author_id from feedback_note
       where subject_id = ${subject.id} order by shared_at desc limit 50`;

    // -------------------------------------------------------------------
    // Log the reads the subject is entitled to know about.
    //
    // Not surveillance of the reader — the opposite. "The CTO can read
    // everything" is only acceptable rather than quietly corrosive because
    // the person it is about can see that it happened.
    //
    // Inside this transaction, not after it, so the insert is policed by
    // note_access_log's own policy: you may record a read you performed and
    // no other kind. Written from outside it would be written by a role that
    // bypasses that check, which is how the table came to have none.
    // -------------------------------------------------------------------
    const overheard = oneOnOnes.filter((n) => n.author_id !== viewer.id && n.subject_id !== viewer.id);
    if (overheard.length) {
      await tx`
        insert into note_access_log ${tx(
          overheard.map((n) => ({ note_id: n.id, reader_id: viewer.id, subject_id: subject.id })),
          "note_id", "reader_id", "subject_id"
        )}`;
    }

    // Only the subject. The rule in docs/06 is that the person can see who
    // looked; it does not say anyone else can, and the policy agrees.
    const accessLog = isSelf
      ? await tx<any[]>`
          select reader_id, read_at from note_access_log
           where subject_id = ${subject.id} order by read_at desc limit 50`
      : null;

    // Same rule, applied to the record of their own role changing. Nothing is
    // written about a person that the person cannot read — a demotion they
    // could not see would be the private manager file this codebase refuses.
    const accountChanges = isSelf
      ? await tx<any[]>`
          select changed, changed_at, actor_id from role_change
           where subject_id = ${subject.id} order by changed_at desc limit 25`
      : null;

    return { goals, evidence, oneOnOnes, feedback, accessLog, accountChanges };
  });

  // Names for every id the guarded reads came back with — note authors, and the
  // readers in the access log. app_user is a directory, not a secret, and
  // resolving it inside the guarded transaction would prove nothing; doing it
  // in one query rather than per row is what keeps this page one round trip.
  const ids = [
    ...guarded.oneOnOnes.map((r) => r.author_id),
    ...guarded.feedback.map((r) => r.author_id),
    ...(guarded.accessLog ?? []).map((r) => r.reader_id),
    ...(guarded.accountChanges ?? []).map((r) => r.actor_id),
  ];
  const named = new Map(
    ids.length
      ? (await sql<{ id: string; name: string | null }[]>`
          select id, name from app_user where id = any(${[...new Set(ids)]})`).map((a) => [a.id, a.name])
      : []
  );

  const evidenceByGoal = new Map<string, Goal["evidence"]>();
  for (const e of guarded.evidence) {
    evidenceByGoal.set(e.goal_id, [...(evidenceByGoal.get(e.goal_id) ?? []), e]);
  }

  const accessLog = guarded.accessLog
    ? guarded.accessLog.map((a) => ({ reader: named.get(a.reader_id) ?? null, read_at: a.read_at }))
    : null;

  const accountChanges = guarded.accountChanges
    ? guarded.accountChanges.map((c) => ({
        changed: c.changed, changed_at: c.changed_at, actor: named.get(c.actor_id) ?? null,
      }))
    : null;

  const { delivered, deliveredMissing, eventsRecorded } = await loadDelivered(subject.gh_login);

  return {
    subject,
    isSelf,
    goals: guarded.goals.map((g) => ({ ...g, evidence: evidenceByGoal.get(g.id) ?? [] })),
    oneOnOnes: guarded.oneOnOnes.map((n) => ({
      id: n.id, held_on: n.held_on, notes: n.notes, agreed_actions: n.agreed_actions,
      author: named.get(n.author_id) ?? null,
      authoredByViewer: n.author_id === viewer.id,
    })),
    feedback: guarded.feedback.map((f) => ({
      id: f.id, body: f.body, shared_at: f.shared_at, author: named.get(f.author_id) ?? null,
    })),
    notesGate: notesGate(viewer, subject.id, isSelf),
    accessLog,
    accountChanges,
    delivered,
    deliveredMissing,
    eventsRecorded,
  };
}

/**
 * What an empty notes list means for this particular reader. Worked out from
 * the same rule the policy encodes, so the sentence on screen and the row the
 * database returned cannot say different things.
 */
function notesGate(viewer: Viewer, subjectId: string, isSelf: boolean): string | null {
  if (isSelf) return null;                       // sees everything about themselves, by policy
  if (viewer.role === "cto") return null;        // reads all — and is logged doing it
  return "You can only see 1:1 notes and feedback about this person that you wrote yourself. The subject reads everything about themselves, and the CTO reads all — nobody else does, and that is enforced by Postgres rather than by this page.";
}

/**
 * Delivered work, from artifacts. A merged pull request is attributed to the
 * person who opened it, not to whoever pressed merge — merged_by is the
 * reviewer, and counting it would credit the reviewer with the author's work.
 */
async function loadDelivered(login: string | null) {
  const [{ n: eventsRecorded }] = await sql<{ n: number }[]>`select count(*)::int as n from gh_event`;

  if (!login) {
    return {
      delivered: null,
      deliveredMissing:
        "This account has no GitHub login linked, so no commit, pull request or review can be attributed to it. That is deliberate rather than missing: an unlinked account can read and book leave, and cannot own work.",
      eventsRecorded,
    };
  }

  const [[work], [reviews], [commits], [cycle]] = await Promise.all([
    sql<any[]>`
      select count(*) filter (where kind = 'pr_merged')::int                       as merged,
             count(*) filter (where kind = 'pr_merged' and agent_authored)::int    as merged_agent,
             count(*) filter (where kind = 'pr_opened')::int                       as opened
        from gh_event
       where payload->'pull_request'->'user'->>'login' = ${login}`,
    sql<any[]>`select count(*)::int as n from gh_event where kind = 'review_submitted' and actor = ${login}`,
    sql<any[]>`select count(*)::int as n from commit_event where author = ${login}`,
    sql<any[]>`
      select round(avg(c.hours)::numeric, 1) as avg_hours, count(*)::int as n
        from cycle_time c
        join gh_event m
          on m.repo = c.repo and m.number = c.issue_number and m.kind = 'pr_merged'
       where m.payload->'pull_request'->'user'->>'login' = ${login}`,
  ]);

  return {
    delivered: {
      merged: work.merged, mergedAgentAuthored: work.merged_agent, opened: work.opened,
      reviews: reviews.n, commits: commits.n,
      cycleHours: cycle.avg_hours === null ? null : Number(cycle.avg_hours),
      cycleSample: cycle.n,
    },
    deliveredMissing: null,
    eventsRecorded,
  };
}
