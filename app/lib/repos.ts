// Which repositories this platform reports on.
//
// The team works across many — the EV platform, the Android app, the spatial
// work, this one — and a task is only identified by a repository *and* a
// number. Issue #1 exists in every repository there has ever been, so a bare
// number is ambiguous the moment there is more than one, and silently points at
// the wrong work.
//
// There are two ways to say which repositories count, and they answer different
// questions:
//
//   GH_ORG    Every repository in that GitHub organisation, read live. A repo
//             created next month appears on the board the first time somebody
//             loads it, with nobody editing configuration. This is the setting
//             for "all of ours, including the ones we have not made yet".
//
//   REPOS     An explicit comma-separated list. Wins over GH_ORG when both are
//             set, because pinning the list is the whole point of writing one.
//
// OPS_REPO remains the repository the agent workflow is dispatched into by
// default, and stands in as the list when neither of the above is set — so a
// one-repository setup needs no new configuration at all.

import { ghFetch, expectList } from "@/app/lib/github";

export type Repo = { owner: string; name: string; full: string };

/** GitHub's own rule for both halves, so a typo is refused here rather than as a 404. */
const PART = /^[A-Za-z0-9._-]{1,100}$/;

export function parseRepo(full: string): Repo | null {
  const [owner, name, ...rest] = full.trim().split("/");
  if (rest.length || !owner || !name || !PART.test(owner) || !PART.test(name)) return null;
  return { owner, name, full: `${owner}/${name}` };
}

/**
 * Discovery is one API call, and the board, /team and /analytics each want the
 * answer. Cached for a few minutes so a page load costs one request rather than
 * three, and so a burst of people opening the board at 9am does not spend the
 * rate limit on the same list.
 *
 * Deliberately short. A repository created this morning should appear this
 * morning — the cache is there to avoid repeating a call inside one page load,
 * not to hold a stale view of the company for an hour. Serverless instances are
 * ephemeral, so this saves work rather than guaranteeing it.
 */
const TTL_MS = 5 * 60 * 1000;
let cache: { at: number; org: string; list: Repo[] } | null = null;

function fromList(raw: string[], source: string): Repo[] {
  const parsed = raw.map((r) => ({ raw: r, repo: parseRepo(r) }));
  const bad = parsed.filter((p) => !p.repo).map((p) => p.raw);
  if (bad.length) {
    throw new Error(
      `${source} contains ${bad.map((b) => `"${b}"`).join(", ")}, which ${bad.length === 1 ? "is not" : "are not"} of the form owner/name. Each entry is a GitHub repository path, without a URL and without a trailing slash.`
    );
  }
  const seen = new Set<string>();
  return parsed
    .map((p) => p.repo as Repo)
    .filter((r) => (seen.has(r.full) ? false : (seen.add(r.full), true)));
}

/**
 * The repositories to report on, in a stable order.
 *
 * Throws rather than returning an empty list. "No repositories are configured"
 * and "nothing is open" are different situations, and this is the layer that
 * can still tell them apart — above it they look identical.
 */
export async function repos(): Promise<Repo[]> {
  const explicit = (process.env.REPOS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (explicit.length) return fromList(explicit, "REPOS");

  const org = (process.env.GH_ORG || "").trim();
  if (org) {
    if (cache && cache.org === org && Date.now() - cache.at < TTL_MS) return cache.list;

    const { body } = await ghFetch(`/orgs/${org}/repos?per_page=100&sort=full_name`);
    const all = expectList(body, `repositories in ${org}`);

    // Archived repositories are read-only history. Showing their issues on the
    // board would offer work nobody can branch from or merge into.
    const list = fromList(
      all.filter((r: any) => !r.archived && !r.disabled).map((r: any) => r.full_name as string),
      `the repository list for ${org}`
    );

    if (list.length === 0) {
      throw new Error(
        `GH_ORG is "${org}", but GH_DISPATCH_TOKEN can see no active repositories in it. Either the organisation name is wrong, or the token's access does not reach it.`
      );
    }
    cache = { at: Date.now(), org, list };
    return list;
  }

  const fallback = (process.env.OPS_REPO || "").trim();
  if (fallback) return fromList([fallback], "OPS_REPO");

  throw new Error(
    "None of GH_ORG, REPOS or OPS_REPO is set, so there are no repositories to show work from. Set GH_ORG to your GitHub organisation to include every repository in it automatically, or REPOS to a comma-separated list such as 'ihelprobotics/ev-edge,ihelprobotics/ihelp-ops'."
  );
}

/**
 * The repository behind a `/task/<owner>/<name>/<number>` URL, confirmed
 * against the configured list.
 *
 * Not merely parsed: a URL naming a repository this platform does not report on
 * is refused. Otherwise anyone could read any repository the token can see by
 * typing its name into the address bar, which is a far wider door than the one
 * the board opens.
 */
export async function repoFromPath(owner: string, name: string): Promise<Repo | null> {
  const wanted = `${owner}/${name}`.toLowerCase();
  return (await repos()).find((r) => r.full.toLowerCase() === wanted) ?? null;
}

/** `owner/name#number`, the way a person writes it. */
export const taskRef = (repo: string, number: number) => `${repo}#${number}`;

/** The path to a task's page. One place, so the shape can change in one place. */
export const taskHref = (repo: string, number: number) => `/task/${repo}/${number}`;
