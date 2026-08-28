// /new — open a task.
//
// The only screen in this platform that writes to GitHub something a person
// typed. Everything else here derives what it shows from artifacts; this makes
// one. That is not a contradiction, it is the boundary: a task is the *request*
// for work, and somebody has to say what the work is. What nobody types is how
// far along it is.
//
// It is a thin form over the GitHub issues API on purpose. docs/06 says not to
// rebuild issue browsing, diffs or code search here, because GitHub does them
// better — that reasoning holds, and it is why this page has a title, a
// description and nothing else. No templates, no custom fields, no workflow
// states. The issue it creates is an ordinary issue, readable and editable by
// anyone on GitHub with no knowledge that this platform exists.

import { auth } from "@/auth";
import Nav from "@/app/ui/nav";
import { BASE_CSS } from "@/app/ui/base-css";
import { isAdmin } from "@/app/lib/roles";
import { repos, type Repo } from "@/app/lib/repos";
import { ghFetch } from "@/app/lib/github";
import { cached } from "@/app/lib/cache";
import NewTaskForm from "./form";

export const dynamic = "force-dynamic";

/**
 * Which repositories can actually dispatch an agent.
 *
 * Cached for five minutes: it changes when somebody copies a workflow file in,
 * which is rare, and asking GitHub once per repository on every page load would
 * spend the request budget the rest of the platform is careful with.
 *
 * A failure here is not fatal. The form still works — this only decides whether
 * a sentence of warning is shown — so it degrades to showing nothing rather
 * than taking the page down.
 */
async function reposWithAgents(list: Repo[]): Promise<string[]> {
  return cached("agent-capable", async () => {
    const checks = await Promise.all(
      list.map(async (r) => {
        try {
          const { status } = await ghFetch(
            `/repos/${r.full}/contents/.github/workflows/agent-run.yml`,
            { allow: [404] }
          );
          return status === 200 ? r.full : null;
        } catch {
          return null;
        }
      })
    );
    return checks.filter((x): x is string => x !== null);
  }, 5 * 60_000).catch(() => []);
}

export default async function NewTaskPage() {
  const session = await auth();
  const admin = isAdmin(session?.user?.role ?? "");
  const login = session?.user?.login ?? null;

  let list: Repo[] = [];
  let error = "";
  try {
    list = await repos();
  } catch (e: any) {
    error = e?.message ?? String(e);
  }

  const withAgents = list.length ? await reposWithAgents(list) : [];

  // The repository somebody most likely wants is the one the platform itself
  // is configured around, if it is on the list at all.
  const preferred = (process.env.OPS_REPO ?? "").trim();
  const defaultRepo = list.some((r) => r.full === preferred) ? preferred : list[0]?.full ?? "";

  return (
    <main className="wrap">
      <style dangerouslySetInnerHTML={{ __html: BASE_CSS + PAGE_CSS }} />
      <header className="top">
        <h1>Open a task</h1>
        <Nav current="new" admin={admin} />
      </header>

      {error ? (
        <div className="error">{error}</div>
      ) : list.length === 0 ? (
        <div className="notice">
          No repositories are configured, so there is nowhere to open a task.
          Set <code>GH_ORG</code> to the organisation, or <code>REPOS</code> to
          an explicit list.
        </div>
      ) : !login ? (
        <div className="notice">
          <p style={{ margin: 0 }}>
            Link your GitHub account before opening a task. A task is a GitHub
            issue, and everything that happens to one afterwards — who holds it,
            whose commits count towards it, who may approve it — is attributed
            by GitHub login. Without one the task could be created and then
            given to nobody.
          </p>
        </div>
      ) : (
        <>
          <section>
            <div className="card">
              <NewTaskForm
                repos={list}
                canRunAgents={withAgents}
                defaultRepo={defaultRepo}
              />
            </div>
          </section>

          <section>
            <h2>What happens next</h2>
            <div className="card">
              <div className="row">
                <span className="when">Now</span>
                <span>
                  The issue is created in GitHub and you land on its task page.
                  It sits at 10% — opened, nothing done yet.
                </span>
              </div>
              <div className="row">
                <span className="when">Then</span>
                <span>
                  Somebody takes it, presses <strong>Start task</strong>, and it
                  moves on its own: a branch is 20%, the first commit 40%, a pull
                  request 60%, green checks 75%, an approval 90%, a merge 100%.
                  Nobody types any of that.
                </span>
              </div>
              <div className="row">
                <span className="when">Or</span>
                <span>
                  Press <strong>Run</strong> on an agent and it works the task in
                  GitHub Actions, reading the description above as its entire
                  brief, and opens a pull request for a human to review.
                </span>
              </div>
            </div>
            <p className="muted small">
              The platform holds one GitHub token, so GitHub records that
              account as the issue&rsquo;s author whoever fills this in. Your
              name is written into the issue body instead, where it stays true
              when the issue is read outside this platform.
            </p>
          </section>
        </>
      )}
    </main>
  );
}

const PAGE_CSS = `
  .newtask { display: flex; flex-direction: column; gap: 18px; }
  .newtask .field { gap: 7px; }
  .newtask input[type="text"], .newtask input:not([type]), .newtask select, .newtask textarea { width: 100%; }
  .newtask select { max-width: 340px; }
  .newtask textarea { min-height: 200px; font-size: 15px; }

  /* A checkbox is a 16px target inside a 44px row; the label carries the rest
     so it can be hit on a phone. */
  .mine {
    display: flex; align-items: center; gap: 10px;
    min-height: 44px; cursor: pointer; font-size: 15px;
  }
  .mine input { margin: 0; }

  .newtask .fields { align-items: center; gap: 14px; }
`;
