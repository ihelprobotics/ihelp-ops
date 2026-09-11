"use client";

// The board's filters.
//
// Held in the URL rather than in component state, so a filtered board is a link
// somebody can send and the back button undoes a filter. The segments are plain
// links; only the repository select needs script, because a <select> cannot
// navigate on its own.

import Link from "next/link";
import { useRouter } from "next/navigation";

export type Show = "all" | "mine" | "open";

const TABS: { key: Show; label: string }[] = [
  { key: "all", label: "Everything" },
  { key: "mine", label: "Mine" },
  { key: "open", label: "Unassigned" },
];

export default function Filters({
  show, repo, repos, counts, canBeMine,
}: {
  show: Show;
  repo: string;
  repos: string[];
  counts: Record<Show, number>;
  canBeMine: boolean;
}) {
  const router = useRouter();

  const href = (s: Show, r: string) => {
    const q = new URLSearchParams();
    if (s !== "all") q.set("show", s);
    if (r) q.set("repo", r);
    const qs = q.toString();
    return qs ? `/?${qs}` : "/";
  };

  return (
    <div className="filters">
      <nav className="seg" aria-label="Which tasks">
        {TABS.map((t) =>
          t.key === "mine" && !canBeMine ? (
            // Visible and explained rather than hidden, like a locked agent tile.
            <span key={t.key} className="off" title="Link your GitHub account first — tasks are assigned by GitHub login.">
              {t.label}
            </span>
          ) : (
            <Link
              key={t.key}
              href={href(t.key, repo)}
              className={show === t.key ? "on" : ""}
              aria-current={show === t.key ? "page" : undefined}
            >
              {t.label}
              <span className="n">{counts[t.key]}</span>
            </Link>
          )
        )}
      </nav>

      {repos.length > 1 && (
        <select aria-label="Repository" value={repo} onChange={(e) => router.push(href(show, e.target.value))}>
          <option value="">All repositories</option>
          {repos.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      )}

      <Link className="go new" href="/new">New task</Link>
    </div>
  );
}
