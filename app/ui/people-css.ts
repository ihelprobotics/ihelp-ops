// What /team, /leave, /me, /person, /analytics and /admin add to the shell.
//
// Only what is genuinely shared lives here. The shell is app/ui/base-css.ts and
// the nav rules travel with the nav component; anything used on one screen
// stays on that screen.

import { BASE_CSS } from "@/app/ui/base-css";

export const PEOPLE_CSS = `
${BASE_CSS}
  .back {
    display: inline-block; font-size: 14px; color: var(--accent);
    text-decoration: none; margin-bottom: 6px;
  }
  .back:hover { text-decoration: underline; }

  /* ---- a person in a list ------------------------------------------ */
  .person {
    display: flex; gap: 14px; align-items: center; padding: 12px 0;
    min-height: 56px; border-top: 1px solid var(--line-soft);
  }
  .person:first-child { border-top: 0; }
  .person .id { flex: 0 0 190px; min-width: 0; }
  .person .id b { display: block; font-weight: 600; font-size: 15px; }
  .person .id b a { color: var(--ink); }
  .person .id span { font-size: 13px; color: var(--ink-2); }
  .person .work { flex: 1; min-width: 0; font-size: 14px; color: var(--ink-2); }
  .person .work a { color: var(--accent); }
  .tags { display: flex; gap: 5px; flex-wrap: wrap; flex: none; }

  /* Pod headings: the one place a label is set in small caps, because it names
     a group of cards rather than a section of one. */
  .pod {
    font-size: 12px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase;
    color: var(--ink-3); margin: 26px 0 8px; padding: 0 4px;
  }

  /* ---- forms ------------------------------------------------------- */
  form.stack { display: flex; flex-direction: column; gap: 14px; }

  /* ---- goals ------------------------------------------------------- */
  .goal { border-top: 1px solid var(--line-soft); padding: 14px 0; }
  .goal:first-child { border-top: 0; }
  .goal header { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
  .goal header b { font-size: 15px; font-weight: 600; flex: 1; min-width: 0; }
  .goal .cyc {
    font-size: 12px; font-weight: 600; color: var(--accent);
    background: var(--accent-bg); border-radius: 100px; padding: 2px 9px;
  }
  .goal .due { margin-left: auto; font-size: 13px; color: var(--ink-3); }
  .ev { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; }
  .ev a { font-size: 14px; }

  /* ---- comment / note bodies --------------------------------------- */
  .cmt { border-top: 1px solid var(--line-soft); padding: 13px 0; }
  .cmt:first-child { border-top: 0; }
  .cmt header { font-size: 13px; color: var(--ink-2); margin-bottom: 3px; }

  /* ---- admin ------------------------------------------------------- */
  .prow {
    display: grid; grid-template-columns: 200px 1fr; gap: 10px 16px;
    padding: 16px 0; border-top: 1px solid var(--line-soft); align-items: start;
  }
  .prow:first-child { border-top: 0; }
  .prow.off { opacity: .5; }
  .pid b { display: block; font-weight: 600; font-size: 15px; }
  .pid span { display: block; font-size: 12px; color: var(--ink-2); word-break: break-all; }
  /* The badge is a badge, not a row. Without this it inherits the block above
     and stretches the width of the column. */
  .pid .tag { display: inline-block; width: auto; margin-top: 5px; }

  .perms { display: flex; flex-direction: column; overflow-x: auto; }
  .phead, .prow2 {
    display: grid; grid-template-columns: minmax(250px, 1fr) repeat(4, 88px);
    gap: 10px; align-items: baseline; padding: 9px 0;
  }
  .phead {
    border-bottom: 1px solid var(--line); font-size: 12px; font-weight: 600;
    color: var(--ink-3); letter-spacing: .02em;
  }
  .prow2 { border-top: 1px solid var(--line-soft); font-size: 14px; }
  .prow2:first-of-type { border-top: 0; }
  .pwhat { display: flex; flex-direction: column; gap: 2px; }
  .pcol { font-size: 13px; }
  .pcol.yes { color: var(--accent); font-weight: 500; }
  .pcol.no { color: var(--ink-3); }

  /* ---- assignee control -------------------------------------------- */
  .assignee { display: flex; flex-direction: column; gap: 12px; }
  .who-has { display: flex; gap: 9px; align-items: baseline; }
  .who-has b { font-size: 17px; font-weight: 600; }
  .acts { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }

  @media (max-width: 640px) {
    .person { flex-wrap: wrap; }
    .person .id { flex-basis: 100%; }
    .prow { grid-template-columns: 1fr; }
    .phead, .prow2 { grid-template-columns: minmax(190px, 1fr) repeat(4, 76px); }
  }
`;
