// /plan — write what you want built, and get issues out of it.
//
// The second screen that writes to GitHub something a person typed, and it
// writes several at once, which is why it is not open to everyone. /new opens
// one task and the person opening it is the person who lives with it. This puts
// a week of work on a board other people read and plan around, so it sits with
// the roles that already decide what the team works on — canPlan() in
// app/lib/roles.ts, which is the same table /admin renders and the handbooks
// are generated from.
//
// The model proposes. A human edits, cuts, and presses the button. That order
// is the whole design: nothing reaches GitHub that somebody did not read first,
// because eight plausible-looking issues nobody checked cost more to close than
// they ever cost to open.
//
// Nothing is stored between the two steps. A plan that was never opened is a
// draft somebody discarded; once the issues exist, the issues are the record,
// in GitHub, which docs/06 says is where the truth about work lives.

import { auth } from "@/auth";
import Nav from "@/app/ui/nav";
import Link from "next/link";
import { BASE_CSS } from "@/app/ui/base-css";
import { isAdmin, canPlan } from "@/app/lib/roles";
import { repos } from "@/app/lib/repos";
import PlanForm from "./form";

export const dynamic = "force-dynamic";

export default async function PlanPage() {
  const session = await auth();
  const role = session?.user?.role ?? "member";
  const admin = isAdmin(role);
  const allowed = canPlan(role);
  const linked = !!session?.user?.login;

  let list: string[] = [];
  let error = "";
  if (allowed) {
    try {
      list = (await repos()).map((r) => r.full);
    } catch (e: any) {
      error = e?.message ?? String(e);
    }
  }

  return (
    <main className="wrap">
      <header className="top">
        <div>
          <h1>Plan</h1>
          <p className="sub">
            Describe what you want built. An agent breaks it into tasks, you
            edit them, and each one you keep becomes an issue.
          </p>
          <Nav current="plan" role={role} />
        </div>
      </header>

      {/* Refused with the reason and the alternative, rather than a blank page
          or a hidden link — the same choice the locked agent tiles make. */}
      {!allowed && (
        <div className="card">
          <h2>This one is for leads</h2>
          <p className="muted">
            Breaking a prompt into issues is for leads, the CTO and the founder.
            Opening one task is open to everybody:{" "}
            <Link href="/new">New task</Link>. Any agent will talk through an
            approach with you from <Link href="/agents">Agents</Link>, whatever
            your tier.
          </p>
          <p className="muted small">
            It is limited because this opens several issues at once onto a board
            other people plan around — not because the conversation is private.
          </p>
        </div>
      )}

      {allowed && !linked && (
        <div className="card">
          <h2>Link your GitHub account first</h2>
          <p className="muted">
            These become GitHub issues, and every one of them is attributed by
            GitHub login. Yours is not linked yet, so there is no name to open
            them under. A CTO or the founder can set it on <Link href="/admin">Admin</Link>.
          </p>
        </div>
      )}

      {allowed && linked && error && (
        <div className="error">
          The repository list could not be read, so there is nowhere to plan
          into: {error}
        </div>
      )}

      {allowed && linked && !error && <PlanForm repos={list} />}

      <style dangerouslySetInnerHTML={{ __html: PLAN_CSS }} />
    </main>
  );
}

const PLAN_CSS = `
${BASE_CSS}
  .plan-form { display: flex; flex-direction: column; gap: 14px; }
  .plan-form textarea { width: 100%; }
  .plan-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }

  .step {
    display: flex; gap: 11px; align-items: flex-start;
    padding: 13px; border-radius: var(--radius-sm);
    background: var(--surface); box-shadow: inset 0 0 0 1px var(--line);
  }
  .step.off { opacity: .5; }
  .step input[type=checkbox] { margin-top: 12px; flex: 0 0 auto; min-height: 0; }
  .step-fields { display: flex; flex-direction: column; gap: 7px; flex: 1 1 auto; min-width: 0; }
  .step-fields input { width: 100%; font-weight: 600; }
  .step-fields textarea { width: 100%; font-size: 14px; }

  .result {
    display: flex; flex-direction: column; gap: 4px;
    padding: 11px 13px; border-radius: var(--radius-sm); margin-bottom: 8px;
  }
  .result.ok   { background: var(--accent-bg); }
  .result.bad  { background: var(--danger-bg); }
  .result .who { font-weight: 600; font-size: 14px; }
  .result.ok .who  { color: var(--accent-ink); }
  .result.bad .who { color: var(--danger); }
`;
