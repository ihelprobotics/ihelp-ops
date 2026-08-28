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

export async function openWorkFor(repo: string): Promise<OpenWork> {
  return cached(`work:${repo}`, async () => {
    try {
      const [issuesRes, branchesRes] = await Promise.all([
        ghFetch(`/repos/${repo}/issues?state=open&per_page=100`),
        // A failed branch listing degrades stage 20 and nothing else, so it is
        // allowed to come back empty rather than taking the repository with it.
        ghFetch(`/repos/${repo}/branches?per_page=100`).catch(() => ({ status: 0, body: [] })),
      ]);

      return {
        repo,
        issues: expectList(issuesRes.body, "issues").filter((i: any) => !i.pull_request),
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
