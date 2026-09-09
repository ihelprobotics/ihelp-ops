// The screens, in the header of each of them.
//
// No hooks and no server-only imports, so the same component works inside the
// client board and inside the server-rendered people pages. Which one you are
// on is passed in rather than read from a router — a router hook here would
// make this client-only and force every page that wants a header to become a
// client component with it.

import Link from "next/link";
import { isAdmin, canPlan } from "@/app/lib/roles";

const PAGES = [
  { href: "/", key: "board", label: "Board" },
  { href: "/new", key: "new", label: "New task" },
  // The way in to a conversation. Before this existed the chat lived only in a
  // section of one task page, so unless you had already opened the right task
  // there was no route to an agent from anywhere in the product.
  { href: "/agents", key: "agents", label: "Agents" },
  // Turning one prompt into a set of issues. Shown to the roles that may do it
  // — tidiness, not security: the page and both routes check canPlan()
  // themselves, and somebody who types the URL gets the reason and where to go
  // instead, rather than a blank screen.
  { href: "/plan", key: "plan", label: "Plan" },
  { href: "/team", key: "team", label: "Team" },
  { href: "/leave", key: "leave", label: "Leave" },
  { href: "/me", key: "me", label: "Me" },
  { href: "/analytics", key: "analytics", label: "Analytics" },
  { href: "/admin", key: "admin", label: "Admin" },
] as const;

export type NavKey = (typeof PAGES)[number]["key"];

/**
 * `role` rather than a flag per link.
 *
 * This took a flag — `admin` — and every page that rendered the nav had to
 * remember to pass it. Adding a second role-gated screen would have meant
 * touching eleven call sites and getting all eleven right, and the failure mode
 * is silent: the link simply does not appear, on exactly the pages somebody
 * would have looked for it. That is how the Agents screen ended up reachable
 * only by typing its URL. So the nav is told who is looking and works the rest
 * out from app/lib/roles.ts, the same table /admin renders.
 *
 * Hiding a link is tidiness, never security. Every page and every route behind
 * one checks the role itself, and somebody who types the URL gets the reason
 * and somewhere to go instead of a blank screen.
 */
export default function Nav({ current, role }: { current: NavKey; role: string }) {
  const shown = PAGES.filter((p) =>
    p.key === "admin" ? isAdmin(role) : p.key === "plan" ? canPlan(role) : true
  );
  return (
    <nav className="nav">
      {shown.map((p) => (
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
