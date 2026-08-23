// POST /api/agents/local
//
// Receives session reports from Claude Code running on someone's own machine,
// sent by the hooks in .claude/settings.json.
//
// Why this exists: the platform dispatches agent runs on GitHub and sees those
// end to end — status, cost, tokens, PR. It has no visibility at all into a
// session someone starts in their own VS Code. This closes that gap.
//
// What it deliberately does not do: capture prompts, code, or anything typed.
// It records that an agent session ran, by whom, on which branch, for how long,
// and how many files it touched. That is enough to answer "how is the team
// using agents" without turning the platform into something people resent.
//
// Treat everything here as soft evidence. It is unauthenticated by design —
// requiring a token would mean putting one on every laptop — so it is trusted
// for analytics and never for accountability. The hard record is the commit and
// the PR, and those come through the signed GitHub webhook.

import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad JSON." }, { status: 400 });
  }

  const { event, gh_login, repo, branch, session, files_changed } = body;
  if (!event || !session) {
    return NextResponse.json({ error: "event and session are required." }, { status: 400 });
  }

  // The hook sends git user.email, which is the most reliable identifier
  // available on a laptop. Map it to a platform account; if we cannot, record
  // it as unattributed rather than guessing at a person.
  const [user] = await sql`
    select id from app_user where email = ${gh_login} or gh_login = ${gh_login} limit 1
  `;

  // Branch name carries the issue number, same convention the commit hook uses.
  const issue = /^(task|agent)\/(?:[a-z-]+\/)?(?:issue-)?(\d+)/.exec(branch || "")?.[2];

  if (event === "start") {
    await sql`
      insert into local_session (session_id, user_id, repo, branch, issue_number, started_at)
      values (${session}, ${user?.id ?? null}, ${repo}, ${branch}, ${issue ? Number(issue) : null}, now())
      on conflict (session_id) do nothing
    `;
  } else if (event === "stop") {
    await sql`
      update local_session
         set ended_at = now(),
             files_changed = ${files_changed ?? null},
             duration_minutes = extract(epoch from (now() - started_at)) / 60
       where session_id = ${session}
    `;
  }

  return NextResponse.json({ ok: true });
}
