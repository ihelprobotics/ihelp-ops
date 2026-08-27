// Which repositories this platform reports on.
//
// The team works across several — the EV platform, the eldercare app, this one —
// and a task is only identified by a repository *and* a number. Issue #1 exists
// in every repository there has ever been, so a bare number is ambiguous the
// moment there is more than one, and silently points at the wrong work.
//
// `REPOS` is the list, comma-separated. `OPS_REPO` remains the single
// repository the agent workflow is dispatched into, and is used as the list
// when `REPOS` is unset — so a one-repository setup needs no new configuration.
// ops/lib/gh.mjs already reads exactly this pair for the daily digest.

export type Repo = { owner: string; name: string; full: string };

/** GitHub's own rule for both halves, so a typo is refused here rather than as a 404. */
const PART = /^[A-Za-z0-9._-]{1,100}$/;

export function parseRepo(full: string): Repo | null {
  const [owner, name, ...rest] = full.trim().split("/");
  if (rest.length || !owner || !name || !PART.test(owner) || !PART.test(name)) return null;
  return { owner, name, full: `${owner}/${name}` };
}

/**
 * The configured list, in the order it was written — which is the order the
 * board shows, so a team can put the repository they live in first.
 *
 * Throws rather than returning an empty list. An empty board that means "no
 * repositories are configured" and one that means "nothing is open" are
 * different situations, and this is the layer that can still tell them apart.
 */
export function repos(): Repo[] {
  const raw = (process.env.REPOS || process.env.OPS_REPO || "").split(",").map((s) => s.trim()).filter(Boolean);

  if (raw.length === 0) {
    throw new Error(
      "Neither REPOS nor OPS_REPO is set, so there are no repositories to show work from. Set REPOS to a comma-separated list such as 'ihelprobotics/ev-edge,ihelprobotics/ihelp-ops'."
    );
  }

  const parsed = raw.map((r) => ({ raw: r, repo: parseRepo(r) }));
  const bad = parsed.filter((p) => !p.repo).map((p) => p.raw);
  if (bad.length) {
    throw new Error(
      `REPOS contains ${bad.map((b) => `"${b}"`).join(", ")}, which ${bad.length === 1 ? "is not" : "are not"} of the form owner/name. Each entry is a GitHub repository path, without a URL and without a trailing slash.`
    );
  }

  // Same repository twice would fan out two identical requests and show every
  // task on it twice.
  const seen = new Set<string>();
  return parsed
    .map((p) => p.repo as Repo)
    .filter((r) => (seen.has(r.full) ? false : (seen.add(r.full), true)));
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
export function repoFromPath(owner: string, name: string): Repo | null {
  const wanted = `${owner}/${name}`.toLowerCase();
  return repos().find((r) => r.full.toLowerCase() === wanted) ?? null;
}

/** `owner/name#number`, the way a person writes it. */
export const taskRef = (repo: string, number: number) => `${repo}#${number}`;

/** The path to a task's page. One place, so the shape can change in one place. */
export const taskHref = (repo: string, number: number) => `/task/${repo}/${number}`;
