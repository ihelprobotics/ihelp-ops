// The four screens, in the header of each of them.
//
// No hooks and no server-only imports, so the same component works inside the
// client board and inside the server-rendered people pages. Which one you are
// on is passed in rather than read from a router — a router hook here would
// make this client-only and force every page that wants a header to become a
// client component with it.

import Link from "next/link";

const PAGES = [
  { href: "/", key: "board", label: "Board" },
  { href: "/team", key: "team", label: "Team" },
  { href: "/leave", key: "leave", label: "Leave" },
  { href: "/me", key: "me", label: "Me" },
  { href: "/analytics", key: "analytics", label: "Analytics" },
  { href: "/admin", key: "admin", label: "Admin" },
] as const;

export type NavKey = (typeof PAGES)[number]["key"];

/**
 * `admin` shows the Admin link. Hiding it is a tidiness decision, not a
 * security one — the page and its route both check the role themselves, and
 * somebody who types the URL gets the permission table with an explanation
 * rather than a blank screen.
 */
export default function Nav({ current, admin = false }: { current: NavKey; admin?: boolean }) {
  return (
    <nav className="nav">
      {PAGES.filter((p) => p.key !== "admin" || admin).map((p) => (
        <Link key={p.key} href={p.href} className={p.key === current ? "on" : ""}>
          {p.label}
        </Link>
      ))}
    </nav>
  );
}

// The nav's own styling lives in app/ui/base-css.ts with the rest of the
// shell, because every screen that renders this component already includes it.
// A second stylesheet exported from here was a second place for the same rules
// to be written, and the copy went stale the moment the palette changed.
