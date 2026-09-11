// The middle of the task page: where the work is, and what proves it.
//
// Split out of page.tsx to keep both under the size a person can hold in their
// head. Everything here is read-only, so it stays a server component.
//
// The rule this section exists to honour: an empty list explains itself. "No
// commits" and "the webhook has never been connected, so no commit could have
// been recorded" send people to completely different places, and rendering them
// as the same blank box is how a platform loses the trust it is built to earn.

import type { TaskDetail } from "@/app/lib/task";

export default function Evidence({ task }: { task: NonNullable<TaskDetail> }) {
  const pr = task.pr;
  const blind = task.repoEventsRecorded === 0;

  return (
    <>
      <section>
        <h2>Where the work is</h2>

        <div className="card">
          <dl className="kv">
            <dt>Branch</dt>
            <dd className="mono">
              {task.branches.length ? task.branches.join(", ") : <span className="muted">none yet</span>}
            </dd>
            <dt>Pull request</dt>
            <dd>
              {!pr || pr.state === "no-pr" ? (
                <span className="muted">none</span>
              ) : (
                <a href={pr.url} target="_blank" rel="noreferrer">#{pr.number} · {pr.state}</a>
              )}
            </dd>
            {pr && pr.state !== "no-pr" && (
              <>
                <dt>Checks</dt>
                <dd className={pr.checks === "green" ? "green" : pr.checks === "none" ? "muted" : "amber"}>
                  {pr.checks === "none" ? "none have run" : pr.checks === "unreadable" ? "cannot be read" : pr.checks}
                </dd>
                <dt>Reviewer agent</dt>
                <dd className={pr.reviewerAgent === "success" ? "green" : pr.reviewerAgent === "pending" ? "muted" : "amber"}>
                  {pr.reviewerAgent === "unreadable" ? "cannot be read" : pr.reviewerAgent}
                  <span className="muted small"> · comments, never approves</span>
                </dd>
                <dt>Human approval</dt>
                <dd className={pr.humanApproved ? "green" : "amber"}>
                  {pr.humanApproved ? "approved" : "not yet — a named human in CODEOWNERS"}
                </dd>
                <dt>Mergeable</dt>
                <dd className="mono">{pr.mergeable ?? "unknown"}</dd>
              </>
            )}
          </dl>
          {/* Not "none have run". A permission the token does not hold is a
              different fact from a pull request nobody has tested, and only one
              of the two is fixed by editing the token. */}
          {pr && pr.state !== "no-pr" && pr.checksError && (
            <p className="notice small" style={{ marginBottom: 0 }}>{pr.checksError}</p>
          )}
        </div>

        {task.openIn && (
          <div className="card">
            <div className="ways">
              <a href={task.openIn.desktop}>Open in VS Code (desktop)</a>
              <a href={task.openIn.browser} target="_blank" rel="noreferrer">Open in vscode.dev (browser)</a>
              <pre>{task.openIn.terminal}</pre>
              <details>
                <summary className="muted small">First time on this machine</summary>
                <pre>{task.openIn.firstTime.join("\n")}</pre>
              </details>
            </div>
            <p className="muted small" style={{ marginBottom: 0 }}>
              Push and pull happen in VS Code. The uncommitted files are on your
              laptop and this server has never seen them; they arrive here through
              the webhook the moment they land.
            </p>
          </div>
        )}
      </section>

      <section>
        <h2>What proves it</h2>
        <div className="card">
          {task.commits.length === 0 ? (
            <p className="muted small" style={{ margin: 0 }}>
              {blind
                ? "No commits recorded — and none could be. The platform has no GitHub events at all for this repository, which means the webhook at /api/webhooks/github has never been connected. This is not a quiet task; it is a disconnected one. See docs/05-step2-golive.md §4."
                : "No commits carrying this task number yet. Commits attribute themselves through the iHelp-Task trailer, which the hook in .githooks writes — run git config core.hooksPath .githooks if yours are not appearing."}
            </p>
          ) : (
            task.commits.map((c: any) => (
              <div className="line" key={c.sha}>
                <span className="sha">{c.sha}</span>
                <span className="what">{String(c.message).split("\n")[0]}</span>
                <span className="when">{c.author ?? "unknown"} · {new Date(c.committed_at).toLocaleDateString()}</span>
              </div>
            ))
          )}
        </div>
      </section>

      <section>
        <h2>Agent runs</h2>
        <div className="card">
          {task.runs.length === 0 ? (
            <p className="muted small" style={{ margin: 0 }}>
              No agent has run on this task yet. Choose one under Agents above
              and press &ldquo;Have it do this&rdquo;.
            </p>
          ) : (
            task.runs.map((r: any) => (
              <div className="line" key={r.id}>
                <span className="sha">{r.agent}</span>
                <span className="what">
                  <span className={r.status === "success" ? "green" : r.status === "failure" ? "red" : "amber"}>{r.status}</span>
                  {r.pr_url && <> · <a href={r.pr_url} target="_blank" rel="noreferrer">pull request</a></>}
                  {r.logs_url && <> · <a href={r.logs_url} target="_blank" rel="noreferrer">log</a></>}
                  {" · "}
                  {/* An absent cost is reported as absent. A zero would be a
                      claim about what the run cost, and nobody measured it. */}
                  {r.cost_usd == null ? <span className="muted">cost not reported</span> : `$${Number(r.cost_usd).toFixed(4)}`}
                </span>
                <span className="when">{r.requester ?? "unknown"} · {new Date(r.started_at).toLocaleDateString()}</span>
              </div>
            ))
          )}
        </div>
      </section>
    </>
  );
}
