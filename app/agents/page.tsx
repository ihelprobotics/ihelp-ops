// /agents — open an agent, pick the task, talk to it, and hand it the work.
//
// The conversation already existed, buried in a section of one task page. That
// is the right place to talk about *that* task, and the wrong place to answer
// "which agent should I ask, and about what" — which is the question somebody
// actually arrives with. There was no route to an agent from anywhere in the
// navigation, so for anyone who had not already opened the right task, the
// feature did not exist.
//
// This is a surface, not a new capability. It renders the same Chat component
// the task page does, dispatches through the same route, and is bound by the
// same rules: the conversation is private, tiers gate the button and not the
// talking, and nothing said here moves a task. Only artifacts do that.
//
// A conversation is always about a task. POST /api/chat takes owner, name and
// issue and there is no task-free mode, deliberately — an agent with no issue
// in front of it has nothing to read and nothing to be held to. So this page
// asks for both, in that order, and says so plainly when one is missing.

import Link from "next/link";
import { auth } from "@/auth";
import { sql, withUser } from "@/lib/db";
import { repos } from "@/app/lib/repos";
import { openWorkForAll } from "@/app/lib/work";
import { AGENTS, CHAT_AGENTS, agentName, canDispatch } from "@/app/lib/agents";
import { isAdmin } from "@/app/lib/roles";
import { BASE_CSS } from "@/app/ui/base-css";
import Nav from "@/app/ui/nav";
import Chat from "@/app/task/[owner]/[name]/[number]/chat";

export const dynamic = "force-dynamic";

type Search = { agent?: string; repo?: string; issue?: string };

export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const session = await auth();
  const admin = isAdmin(session?.user?.role ?? "");
  const sp = await searchParams;

  // An unknown agent in the URL is not silently swapped for a working one —
  // that would answer a question nobody asked, in a voice that is not theirs.
  const agent = sp.agent && CHAT_AGENTS.includes(sp.agent) ? sp.agent : CHAT_AGENTS[0];
  const badAgent = sp.agent && !CHAT_AGENTS.includes(sp.agent) ? sp.agent : null;

  const me = session?.user
    ? {
        login: session.user.login ?? null,
        role: session.user.role ?? "member",
        tier: session.user.tier ?? "week1",
      }
    : null;

  // The open work, read live from GitHub. Per-repo failures are carried and
  // shown rather than folded into "no tasks" — a repository the token cannot
  // see and a repository with nothing open are different facts.
  let tasks: { repo: string; number: number; title: string }[] = [];
  let repoErrors: { repo: string; error: string }[] = [];
  let listError = "";
  try {
    const list = await repos();
    const work = await openWorkForAll(list.map((r) => r.full));
    for (const w of work) {
      if (w.error) { repoErrors.push({ repo: w.repo, error: w.error }); continue; }
      for (const i of w.issues) tasks.push({ repo: w.repo, number: i.number, title: i.title });
    }
    tasks.sort((a, b) => a.repo.localeCompare(b.repo) || a.number - b.number);
  } catch (e: any) {
    listError = e?.message ?? String(e);
  }

  const chosen =
    sp.repo && sp.issue && /^\d+$/.test(sp.issue)
      ? tasks.find((t) => t.repo === sp.repo && t.number === Number(sp.issue)) ?? null
      : null;
  // Named rather than ignored: a link that no longer matches open work should
  // say so, not quietly show the picker again as though nothing was asked for.
  const missingTask = sp.repo && sp.issue && !chosen ? `${sp.repo}#${sp.issue}` : null;

  // The stored thread for this person, this agent and this task. Read through
  // withUser so the chat policies apply — the same read the task page does.
  let history: { agent: string; messages: any[] } = { agent, messages: [] };
  let historyError = "";
  if (session?.user?.id && chosen) {
    try {
      history = await withUser(session.user.id, session.user.role ?? "member", async (tx) => {
        const [t] = await tx<any[]>`
          select id from chat_thread
           where user_id = ${session.user.id} and repo = ${chosen.repo}
             and issue_number = ${chosen.number} and agent = ${agent}
           order by created_at desc limit 1`;
        if (!t) return { agent, messages: [] };
        const rows = await tx<any[]>`
          select role, content, cost_usd from chat_message
           where thread_id = ${t.id} order by created_at, id limit 100`;
        return {
          agent,
          messages: rows.map((r) => ({
            role: r.role,
            content: r.content,
            cost: r.cost_usd ? Number(r.cost_usd) : undefined,
          })),
        };
      });
    } catch (e: any) {
      historyError = e?.message ?? String(e);
    }
  }

  const owner = chosen?.repo.split("/")[0] ?? "";
  const name = chosen?.repo.split("/")[1] ?? "";
  const dispatchable = canDispatch(agent, me);

  const href = (next: Partial<Search>) => {
    const q = new URLSearchParams();
    q.set("agent", next.agent ?? agent);
    const r = next.repo ?? chosen?.repo;
    const i = next.issue ?? (chosen ? String(chosen.number) : undefined);
    if (r) q.set("repo", r);
    if (i) q.set("issue", i);
    return `/agents?${q}`;
  };

  return (
    <main className="wrap">
      <header className="top">
        <div>
          <h1>Agents</h1>
          <p className="sub">
            Ask an agent about a task, then hand it the work. Talking changes
            nothing — the pull request is what changes anything.
          </p>
          <Nav current="agents" admin={admin} />
        </div>
      </header>

      {badAgent && (
        <div className="error">
          There is no agent called <code>{badAgent}</code>. The ones you can talk
          to are: {CHAT_AGENTS.map(agentName).join(", ")}.
        </div>
      )}

      <div className="agents-layout">
        <aside className="agent-list">
          {AGENTS.map((a) => {
            const can = canDispatch(a.id, me);
            return (
              <Link
                key={a.id}
                href={href({ agent: a.id })}
                className={"agent-card" + (a.id === agent ? " on" : "")}
              >
                <span className="agent-name">{a.name}</span>
                <span className="agent-blurb">{a.blurb}</span>
                <span className={"tag " + (can.ok ? "on" : "")}>
                  {can.ok ? "can be dispatched" : "talk only, at your tier"}
                </span>
              </Link>
            );
          })}
        </aside>

        <section className="agent-talk">
          <div className="card">
            <div className="picked">
              <strong>{agentName(agent)}</strong>
              {chosen ? (
                <span className="muted small">
                  {" about "}
                  <Link href={`/task/${chosen.repo}/${chosen.number}`}>
                    {chosen.repo}#{chosen.number}
                  </Link>
                  {" — "}
                  {chosen.title}
                </span>
              ) : (
                <span className="muted small"> — pick a task below</span>
              )}
            </div>

            {!dispatchable.ok && (
              <p className="muted small">{dispatchable.why}</p>
            )}

            {missingTask && (
              <div className="error">
                {missingTask} is not in the open work right now. It may have been
                closed, or its repository may be unreadable — the list below is
                what GitHub answered a moment ago.
              </div>
            )}

            {listError && (
              <div className="error">
                The task list could not be read: {listError}
              </div>
            )}

            {historyError && (
              <div className="error">
                Your stored conversation could not be read, so this box starts
                empty. It is not gone: {historyError}
              </div>
            )}

            {!chosen && (
              <div className="task-pick">
                {tasks.length === 0 && !listError ? (
                  <p className="muted small">
                    Nothing is open in any configured repository, so there is
                    nothing to ask about yet. Open a task first — an agent with
                    no issue in front of it has nothing to read.
                  </p>
                ) : (
                  <>
                    <p className="muted small">
                      A conversation is always about a task. Pick one:
                    </p>
                    <ul className="tasks">
                      {tasks.map((t) => (
                        <li key={`${t.repo}#${t.number}`}>
                          <Link href={href({ repo: t.repo, issue: String(t.number) })}>
                            <code>{t.repo}#{t.number}</code> {t.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {repoErrors.length > 0 && (
                  <div className="error">
                    {repoErrors.length} repositor{repoErrors.length === 1 ? "y" : "ies"} could
                    not be read, so their tasks are missing from this list rather
                    than absent:
                    <ul>
                      {repoErrors.map((r) => (
                        <li key={r.repo}>
                          <code>{r.repo}</code> — {r.error}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {chosen && (
              <Chat
                key={`${agent}:${chosen.repo}#${chosen.number}`}
                owner={owner}
                name={name}
                issue={chosen.number}
                initialAgent={agent}
                history={history}
                me={me}
              />
            )}
          </div>
        </section>
      </div>

      <style dangerouslySetInnerHTML={{ __html: AGENTS_CSS }} />
    </main>
  );
}

const AGENTS_CSS = `
${BASE_CSS}
  .agents-layout {
    display: grid; grid-template-columns: minmax(200px, 260px) 1fr;
    gap: 18px; align-items: start;
  }
  @media (max-width: 820px) { .agents-layout { grid-template-columns: 1fr; } }

  .agent-list { display: flex; flex-direction: column; gap: 8px; }
  .agent-card {
    display: flex; flex-direction: column; gap: 3px; text-decoration: none;
    background: var(--surface); border-radius: var(--radius-sm);
    box-shadow: inset 0 0 0 1px var(--line); padding: 11px 13px;
    transition: box-shadow .15s ease, background .15s ease;
  }
  .agent-card:hover { background: var(--sunken); }
  .agent-card.on { box-shadow: inset 0 0 0 2px var(--accent); background: var(--accent-bg); }
  .agent-name { font-weight: 600; font-size: 15px; color: var(--ink); }
  .agent-blurb { font-size: 12.5px; color: var(--ink-2); }
  .agent-card .tag { align-self: flex-start; margin-top: 3px; font-size: 11px; }

  .agent-talk .card { display: flex; flex-direction: column; gap: 14px; }
  .picked { font-size: 15px; }
  .task-pick { display: flex; flex-direction: column; gap: 10px; }
  .tasks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .tasks a {
    display: block; padding: 9px 12px; border-radius: var(--radius-sm);
    background: var(--sunken); text-decoration: none; color: var(--ink);
    font-size: 14px;
  }
  .tasks a:hover { background: var(--accent-bg); }
`;
