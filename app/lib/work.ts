// What is open in a repository, read once and shared.
//
// The board, /team and /analytics all want the same two things per repository:
// the open issues, and the branch names that prove a task was started. Before
// this file each of them asked GitHub separately, so opening the board and then
// /team cost fifty-two requests for one person looking at one afternoon's work.
//
// One function, one cache key per repository, thirty seconds. That is what
// keeps a working team inside GitHub's hourly limit — see app/lib/cache.ts for
// the arithmetic that made it necessary.
//
// A repository that cannot be read comes back as an entry carrying its own
// error rather than throwing. One repository the token lost access to must not
// blank the other twelve, and it must not be reported as an empty backlog.

import { ghFetch, expectList } from "@/app/lib/github";
import { cached, invalidate } from "@/app/lib/cache";

export type OpenWork = {
  repo: string;
  /** Null only when the read failed; an empty array means genuinely nothing. */
  issues: any[];
  branches: string[];
  error: string | null;
};

/**
 * Tasks opened through this platform in the last minute and a half.
 *
 * GitHub's issue *list* endpoint is not read-your-writes. Measured against a
 * real repository, an issue created at t=0 did not appear in
 * `GET /repos/:repo/issues` until t≈7.5s — eight attempts, every one of the
 * first five absent. Invalidating our own cache does nothing about that: the
 * next read is fresh, truthful, and still missing the task.
 *
 * The person who just opened it sees a board without it, decides the button did
 * not work, and opens it again. Two issues for one piece of work is exactly the
 * mess this platform exists to prevent.
 *
 * So the issue object GitHub returned from the create is held here and merged
 * into the next reads. This is not a mirror and not a source of truth: it is
 * the same object GitHub just handed us, held for as long as its own index
 * takes to agree, and dropped by number the moment the list contains it. The
 * database never sees it.
 */
const GRACE_MS = 90_000;
const justOpened = new Map<string, { issue: any; at: number }[]>();

const stillWaiting = (repo: string) =>
  (justOpened.get(repo) ?? []).filter((x) => Date.now() - x.at < GRACE_MS);

/** Called after this platform opens a task, with what GitHub answered. */
export function noteNewTask(repo: string, issue: any): void {
  justOpened.set(repo, [...stillWaiting(repo), { issue, at: Date.now() }]);
  forgetWork(repo);
}

export async function openWorkFor(repo: string): Promise<OpenWork> {
  return cached(`work:${repo}`, async () => {
    try {
      const [issuesRes, branchesRes] = await Promise.all([
        ghFetch(`/repos/${repo}/issues?state=open&per_page=100`),
        // A failed branch listing degrades stage 20 and nothing else, so it is
        // allowed to come back empty rather than taking the repository with it.
        ghFetch(`/repos/${repo}/branches?per_page=100`).catch(() => ({ status: 0, body: [] })),
      ]);

      const listed = expectList(issuesRes.body, "issues").filter((i: any) => !i.pull_request);

      // Anything we opened that GitHub has not indexed yet. Deduped by number,
      // so the moment its own list catches up this adds nothing.
      const pending = stillWaiting(repo)
        .map((x) => x.issue)
        .filter((e) => !listed.some((i: any) => i.number === e.number));

      return {
        repo,
        issues: [...listed, ...pending],
        branches: (Array.isArray(branchesRes.body) ? branchesRes.body : []).map((b: any) => b.name as string),
        error: null,
      };
    } catch (e: any) {
      return { repo, issues: [], branches: [], error: e?.message ?? String(e) };
    }
  });
}

/** Every configured repository, read in parallel. */
export async function openWorkForAll(repos: string[]): Promise<OpenWork[]> {
  return Promise.all(repos.map(openWorkFor));
}

/**
 * Forget what we know about a repository.
 *
 * Called after the platform changes something in it — taking a task, starting
 * one, opening a pull request. Without this, pressing "Take it" and watching
 * the board still say nobody has it for half a minute reads as the button not
 * working, and the second press is somebody trying again.
 */
export function forgetWork(repo: string): void {
  invalidate(`work:${repo}`);
}
