// One task on the board.
//
// The card is a link to the task, because that is where everything you can do
// to a task now lives — including putting an agent on it. The one action kept
// on the card is Take it: seeing something nobody has and putting your name on
// it is how work starts, and it should not cost a page load.

import Link from "next/link";
import { ago, type BoardTask } from "@/app/lib/board";
import TakeButton from "@/app/ui/take-button";

export default function BoardCard({
  task: t, showRepo, mine, login,
}: {
  task: BoardTask;
  /** Only when the board spans repositories and is not filtered to one. */
  showRepo: boolean;
  mine: boolean;
  login: string | null;
}) {
  const short = t.repo.split("/")[1] ?? t.repo;
  const more = t.labels.length - 3;

  return (
    <article className={"tcard" + (mine ? " mine" : "")}>
      <Link className="tcard-main" href={t.href}>
        <div className="tcard-ref">{showRepo ? `${short} · #${t.number}` : `#${t.number}`}</div>
        <div className="tcard-title">{t.title}</div>
        <div className="bar"><i style={{ width: `${t.progress}%` }} /></div>
        <div className="tcard-stage">
          <span>
            {t.stage}
            {t.commits > 0 ? ` · ${t.commits} ${t.commits === 1 ? "commit" : "commits"}` : ""}
          </span>
          <b>{`${t.progress}%`}</b>
        </div>
        {t.labels.length > 0 && (
          <div className="tcard-labels">
            {t.labels.slice(0, 3).map((l) => <span className="tag" key={l}>{l}</span>)}
            {more > 0 && <span className="tag">{`+${more}`}</span>}
          </div>
        )}
      </Link>

      <footer className="tcard-foot">
        <span className="tcard-who">
          {t.assignee ? (
            <>
              <i className="av" aria-hidden="true">{t.assignee[0].toUpperCase()}</i>
              {mine ? "You" : `@${t.assignee}`}
            </>
          ) : (
            <span className="muted">Nobody has this</span>
          )}
        </span>
        {!t.assignee && login ? (
          <TakeButton repo={t.repo} number={t.number} login={login} />
        ) : (
          <span className="tcard-when" title={new Date(t.updated_at).toLocaleString()}>{ago(t.updated_at)}</span>
        )}
      </footer>
    </article>
  );
}
