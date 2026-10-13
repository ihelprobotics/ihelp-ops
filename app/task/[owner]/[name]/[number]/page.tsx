// /task/<owner>/<name>/<number> — one task, and the evidence behind every
// number on it.
//
// The repository is in the URL because a task is a repository *and* a number.
// Issue #1 exists in every repository there has ever been, and a bare number
// would quietly show one team's work under another's name. The repository is
// also checked against the configured list rather than merely parsed — without
// that, anyone could read any repository the token can see by typing its name
// into the address bar, which is a far wider door than the board opens.
//
// A server component, because almost all of this is facts being read: the issue
// and its comments and pull request live from GitHub, the commits and agent
// runs from the database. The only client code is the buttons, in actions.tsx.
//
// Nothing on this page is typed by anyone. The percentage comes from artifacts,
// and the section under it names which ones — so "60%" is never something the
// reader has to take on trust.

import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { loadTask } from "@/app/lib/task";
import { repoFromPath } from "@/app/lib/repos";
import { assignsOthers } from "@/app/lib/assign";
import { sql, dbErrorMessage } from "@/lib/db";
import { TASK_CSS } from "./css";
import TaskActions from "./actions";
import Assignee from "./assignee";
import Evidence from "./evidence";
import Chat from "./chat";
import { withUser } from "@/lib/db";
import { CHAT_AGENTS } from "@/app/lib/agents";

export const dynamic = "force-dynamic";

export default async function TaskPage({
  params,
}: {
  params: Promise<{ owner: string; name: string; number: string }>;
}) {
  const p = await params;
  const n = Number(p.number);
  const session = await auth();

  if (!Number.isInteger(n) || n < 1) notFound();

  // Resolved before the try, because notFound() works by throwing a value
  // Next.js catches itself — calling it inside a catch-all would turn "no such
  // repository" into an error message about a control-flow signal.
  let repo: string | null = null;
  let configError = "";
  try {
    const found = await repoFromPath(p.owner, p.name);
    repo = found?.full ?? null;
  } catch (e: any) {
    configError = e?.message ?? String(e);   // REPOS itself is unset or malformed
  }
  if (!configError && !repo) notFound();

  let task: Awaited<ReturnType<typeof loadTask>> = null;
  let error = configError;
  if (repo) {
    try {
      task = await loadTask(repo, n);
    } catch (e: any) {
      error = dbErrorMessage(e);
    }
  }
  if (!error && !task) notFound();

  const login = session?.user?.login ?? null;
  const pr = task?.pr ?? null;
  const prState = pr ? pr.state : null;

  // Who this task could be handed to. Only accounts with a linked GitHub login
  // can hold work, so the list is exactly those — an unlinked colleague is not
  // offered and then refused.
  const canAssignOthers = assignsOthers({ login, role: session?.user?.role ?? "member" });
  const people = canAssignOthers
    ? await sql<{ name: string | null; gh_login: string }[]>`
        select name, gh_login from app_user
         where active and gh_login is not null order by name nulls last`
    : [];

  // The stored conversation, read as this person so the chat policies apply.
  // A failure here must not take the task page down — the chat simply starts
  // empty and the reason is on the server log, not in the reader's way.
  let chatHistory: { agent: string; messages: any[] } = { agent: CHAT_AGENTS[0], messages: [] };
  if (session?.user?.id && repo) {
    try {
      chatHistory = await withUser(session.user.id, session.user.role ?? "member", async (tx) => {
        const [t] = await tx<any[]>`
          select id, agent from chat_thread
           where user_id = ${session.user.id} and repo = ${repo} and issue_number = ${n}
           order by created_at desc limit 1`;
        if (!t) return { agent: CHAT_AGENTS[0], messages: [] };
        const rows = await tx<any[]>`
          select role, content, cost_usd from chat_message
           where thread_id = ${t.id} order by created_at, id limit 100`;
        return {
          agent: t.agent,
          messages: rows.map((r) => ({ role: r.role, content: r.content, cost: r.cost_usd ? Number(r.cost_usd) : undefined })),
        };
      });
    } catch { /* start empty */ }
  }

  return (
    <main className="wrap">
      <header className="top">
        <div>
          <Link className="back muted" href="/">&larr; Board</Link>
          <h1>{task ? `#${task.number} ${task.issue.title}` : `#${n}`}</h1>
          <p className="sub">{repo ?? `${p.owner}/${p.name}`}</p>
        </div>
        {task && (
          <div className="who">
            <b className="pct">{task.progress}%</b>
            <span>{task.stage}</span>
          </div>
        )}
      </header>

      {error && <div className="error">{error}</div>}

      {task && (
        <>
          <div className="bar" style={{ marginTop: 16 }}><i style={{ width: `${task.progress}%` }} /></div>
          <div className="labels">
            <span className="label">{task.issue.state}</span>
            <span className="label">{task.issue.assignee ? `@${task.issue.assignee}` : "unassigned"}</span>
            {task.issue.labels.map((l: string) => <span className="label" key={l}>{l}</span>)}
            <a className="label" href={task.issue.url} target="_blank" rel="noreferrer">on GitHub</a>
          </div>

          {task.issue.body.trim() && (
            <div className="card" style={{ marginTop: 14 }}>
              <p className="body">{task.issue.body}</p>
            </div>
          )}

          <section>
            <h2>Owner</h2>
            <div className="card">
              <Assignee
                href={`/api/tasks/${repo}/${task.number}`}
                current={task.issue.assignee}
                actor={{ login, role: session?.user?.role ?? "member" }}
                people={people}
              />
              <p className="muted small" style={{ marginTop: 10 }}>
                One name, never two. A task with two owners has none — and
                &ldquo;somebody was going to do it&rdquo; is the outcome this
                platform exists to make impossible.
              </p>
            </div>
          </section>

          <section>
            <h2>Do</h2>
            <div className="card">
              <TaskActions
                href={`/api/tasks/${repo}/${task.number}`}
                number={task.number}
                hasBranch={task.branches.length > 0}
                branch={task.prBranch ?? task.branches[0] ?? null}
                prNumber={pr && pr.state !== "no-pr" ? pr.number : null}
                prState={prState}
                canAct={!!login}
                whyNot={
                  session
                    ? "Link your GitHub account before starting work. Branches, pull requests and comments are attributed by GitHub login."
                    : "Sign in to start this task."
                }
              />
            </div>
          </section>

          <section>
            {/* The agents live here rather than on the board: choosing one
                happens with the issue it will read in front of you. */}
            <h2>Agents</h2>
            <div className="card">
              <Chat
                owner={p.owner}
                name={p.name}
                issue={task.number}
                initialAgent={chatHistory.agent}
                history={chatHistory}
                // Tier and role decide whether this conversation can be turned
                // into a run. Tiers gate dispatch, never the talking — so this
                // is passed for the button, not for the chat.
                me={
                  session?.user
                    ? {
                        login,
                        role: session.user.role ?? "member",
                        tier: session.user.tier ?? "week1",
                      }
                    : null
                }
              />
            </div>
          </section>

          <Evidence task={task} />

          <section>
            <h2>Said</h2>
            <div className="card">
              {task.comments.length === 0 ? (
                <p className="muted small">
                  No comments on this issue yet. Read live from GitHub, so this is
                  the issue itself and not a copy of it.
                </p>
              ) : (
                task.comments.map((c) => (
                  <div className="cmt" key={c.url}>
                    <header>
                      @{c.author} · {new Date(c.createdAt).toLocaleString()} ·{" "}
                      <a href={c.url} target="_blank" rel="noreferrer">on GitHub</a>
                    </header>
                    <p className="body">{c.body}</p>
                  </div>
                ))
              )}
            </div>
          </section>
        </>
      )}

      <style dangerouslySetInnerHTML={{ __html: TASK_CSS }} />
    </main>
  );
}
