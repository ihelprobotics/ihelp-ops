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

export const NAV_CSS = `
  .nav { display: flex; gap: 4px; margin-top: 8px; }
  .nav a { font-size: 11px; font-family: ui-monospace, monospace; text-decoration: none; color: #78909F; border: 1px solid transparent; border-radius: 2px; padding: 3px 8px; }
  .nav a:hover { color: #DCE6ED; border-color: #26343F; }
  .nav a.on { color: #4FD1C5; border-color: #26343F; background: #151F2A; }
`;
