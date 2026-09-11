// / — the board. Every open task, in the column its evidence puts it in.
//
// Tasks and their progress, and nothing else. Agents used to sit under the list
// as a grid you armed by selecting a row; they now live on the task page, where
// the issue, its branch and its pull request are in front of you when you pick
// one. The board is for seeing where the work is. Deciding who or what does it
// happens inside the task.
//
// The columns are not states anyone moves a card between — see COLUMNS in
// app/lib/board.ts. A server component, because everything here is read; the
// only client code is the repository filter and the Take it button.

import Link from "next/link";
import { auth } from "@/auth";
import { dbErrorMessage } from "@/lib/db";
import { loadBoard, COLUMNS, type Board } from "@/app/lib/board";
import { BASE_CSS } from "@/app/ui/base-css";
import { BOARD_CSS } from "@/app/ui/board-css";
import Nav from "@/app/ui/nav";
import BoardCard from "@/app/ui/board-card";
import Filters, { type Show } from "@/app/ui/board-filters";

export const dynamic = "force-dynamic";

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string; repo?: string }>;
}) {
  const session = await auth();
  const me = session?.user ?? null;
  const login = me?.login ?? null;
  const sp = await searchParams;
  const show: Show = sp.show === "mine" || sp.show === "open" ? sp.show : "all";

  let board: Board | null = null;
  let error = "";
  try {
    board = await loadBoard();
  } catch (e: any) {
    error = dbErrorMessage(e);
  }

  const all = board?.tasks ?? [];
  const repoNames = (board?.repos ?? []).map((r) => r.repo);
  const multi = repoNames.length > 1;
  const repo = sp.repo && repoNames.includes(sp.repo) ? sp.repo : "";
  // Named rather than ignored: a link to a repository that is no longer on the
  // board should say so, not quietly show everything as though nothing was asked.
  const unknownRepo = board && sp.repo && !repo ? sp.repo : null;

  const isMine = (a: string | null) => !!login && !!a && a.toLowerCase() === login.toLowerCase();
  const inRepo = all.filter((t) => !repo || t.repo === repo);
  const counts = {
    all: inRepo.length,
    mine: inRepo.filter((t) => isMine(t.assignee)).length,
    open: inRepo.filter((t) => !t.assignee).length,
  };
  const shown = inRepo
    .filter((t) => (show === "mine" ? isMine(t.assignee) : show === "open" ? !t.assignee : true))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  const failed = (board?.repos ?? []).filter((r) => r.error);
  const quiet = (board?.repos ?? []).filter((r) => !r.error && r.open === 0);

  return (
    <main className="wrap wide">
      <header className="top">
        <div>
          <h1>Board</h1>
          <p className="sub">
            {!board
              ? "iHelp Ops"
              : `${all.length} open ${all.length === 1 ? "task" : "tasks"}` +
                (multi ? ` across ${repoNames.length} repositories` : repoNames[0] ? ` in ${repoNames[0]}` : "")}
          </p>
          <Nav current="board" role={me?.role ?? ""} />
        </div>
        {me && (
          <div className="who">
            <b>{me.name}</b>
            <span>
              {login ? `@${login}` : <em className="warn">GitHub not linked</em>}
              {me.pod ? ` · ${me.pod}` : ""}
            </span>
          </div>
        )}
      </header>

      {me && !login && (
        <div className="notice">
          Link your GitHub account to take a task or run an agent on one. Work is
          attributed by GitHub login — commits, reviews and CODEOWNERS all use it —
          so an unlinked account can read the board but cannot own anything on it.
        </div>
      )}

      {error && <div className="error">{error}</div>}

      {board && board.events_recorded === 0 && all.length > 0 && (
        <div className="notice">
          Every task is in <b>Not started</b> because the platform has no GitHub
          events on record for these repositories — not because nothing has
          happened. Until the webhook at <code>/api/webhooks/github</code> is
          connected, no card can move: branches, commits, pull requests, reviews
          and merges all arrive through it.
          <span className="muted small"> See docs/05-step2-golive.md §4.</span>
        </div>
      )}

      {/* A repository that could not be read says so by name. Folding it into
          the columns would show a failure to reach GitHub as an empty backlog. */}
      {failed.map((r) => (
        <div className="notice" key={r.repo}>
          <b>{r.repo}</b> could not be read, so its tasks are missing from this
          board — that is a failure to reach GitHub, not an empty backlog.{" "}
          <span className="muted small">{r.error}</span>
        </div>
      ))}

      {unknownRepo && (
        <div className="notice">
          <b>{unknownRepo}</b> is not one of the repositories on this board, so that
          filter was ignored and every repository is shown.
        </div>
      )}

      {show === "mine" && !login && me && (
        <div className="notice">
          &ldquo;Mine&rdquo; means tasks assigned to your GitHub login, and this
          account has none linked — so it is empty for that reason, not because
          you have no work.
        </div>
      )}

      {board && (
        <>
          <Filters show={show} repo={repo} repos={repoNames} counts={counts} canBeMine={!!login} />

          {all.length === 0 ? (
            <p className="empty">
              No open issues in {multi ? "any of the configured repositories" : repoNames[0] ?? "the configured repository"}.{" "}
              <Link href="/new">Open a task</Link> and it appears here.
            </p>
          ) : (
            <div className="cols">
              {COLUMNS.map((c) => {
                const here = shown.filter((t) => t.progress >= c.from && t.progress < c.to);
                return (
                  <section className={`col ${c.key}`} key={c.key} aria-label={c.title}>
                    <header className="col-head">
                      <b>{c.title}</b>
                      <span className="count">{here.length}</span>
                    </header>
                    <p className="col-hint">{c.hint}</p>
                    <div className="col-list">
                      {here.length === 0 ? (
                        <p className="col-empty">
                          {show === "mine" ? "Nothing of yours here." : show === "open" ? "Nothing unassigned here." : "Nothing at this stage."}
                        </p>
                      ) : (
                        here.map((t) => (
                          <BoardCard
                            key={`${t.repo}#${t.number}`}
                            task={t}
                            showRepo={multi && !repo}
                            mine={isMine(t.assignee)}
                            login={login}
                          />
                        ))
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          )}

          <p className="muted small foot">
            Columns come from GitHub — a branch, commits, a pull request, a review,
            a merge. Nobody moves a card and nobody types a percentage. Open a task
            to put an agent on it.
          </p>

          {/* Named rather than merely omitted. "We read these and they were
              empty" and "we did not look" are different facts. */}
          {quiet.length > 0 && (
            <details className="quiet">
              <summary>{`${quiet.length} other ${quiet.length === 1 ? "repository has" : "repositories have"} nothing open`}</summary>
              <p className="muted small">{quiet.map((r) => r.repo).join(" · ")}</p>
            </details>
          )}
        </>
      )}

      <style dangerouslySetInnerHTML={{ __html: BASE_CSS + BOARD_CSS }} />
    </main>
  );
}
