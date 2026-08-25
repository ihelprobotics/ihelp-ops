// /task/[number] — one task, and the evidence behind every number on it.
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
import { TASK_CSS } from "./css";
import TaskActions from "./actions";
import Evidence from "./evidence";

export const dynamic = "force-dynamic";

export default async function TaskPage({ params }: { params: Promise<{ number: string }> }) {
  const n = Number((await params).number);
  const session = await auth();
  const repo = process.env.OPS_REPO;

  if (!Number.isInteger(n) || n < 1) notFound();

  let task: Awaited<ReturnType<typeof loadTask>> = null;
  let error = "";
  if (!repo) {
    error = "OPS_REPO is not set. Set it to the repository these tasks live in, as owner/name — without it there is no task to show.";
  } else {
    try {
      task = await loadTask(repo, n);
    } catch (e: any) {
      error = e?.message ?? String(e);
    }
  }
  if (!error && !task) notFound();

  const login = session?.user?.login ?? null;
  const pr = task?.pr ?? null;
  const prState = pr ? pr.state : null;

  return (
    <main className="wrap">
      <header className="top">
        <div>
          <Link className="back muted" href="/">&larr; Board</Link>
          <h1>{task ? `#${task.number} ${task.issue.title}` : `#${n}`}</h1>
          <p className="sub">{repo ?? "OPS_REPO not set"}</p>
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
            <h2>Do</h2>
            <div className="card">
              <TaskActions
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
