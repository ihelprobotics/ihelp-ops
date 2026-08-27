// Screen-specific CSS for the task page. The shell is app/ui/base-css.ts and
// the people screens share app/ui/people-css.ts; only what this page adds is
// here.

import { PEOPLE_CSS } from "@/app/ui/people-css";

export const TASK_CSS = `
${PEOPLE_CSS}
  /* ---- the header numbers ------------------------------------------ */
  .who .pct { font-size: 26px; font-weight: 600; letter-spacing: -.02em; }

  /* ---- labels under the title -------------------------------------- */
  .labels { display: flex; gap: 6px; flex-wrap: wrap; margin: 10px 0 0; }
  .label {
    font-size: 12px; font-weight: 500; color: var(--ink-2);
    background: rgba(118,118,128,.09); border-radius: 100px; padding: 3px 10px;
    text-decoration: none;
  }
  a.label { color: var(--accent); }
  a.label:hover { background: var(--accent-bg); text-decoration: none; }

  /* ---- evidence: label left, value right ---------------------------- */
  .kv { display: grid; grid-template-columns: 160px 1fr; gap: 9px 16px; font-size: 15px; }
  .kv dt { color: var(--ink-2); font-size: 14px; }
  .kv dd { margin: 0; }

  /* ---- the three ways into VS Code ---------------------------------- */
  .ways { display: flex; flex-direction: column; gap: 2px; }
  .ways a {
    display: flex; align-items: center; justify-content: space-between;
    min-height: 44px; padding: 11px 0; font-size: 15px;
    border-top: 1px solid var(--line-soft); text-decoration: none;
  }
  .ways a:first-child { border-top: 0; }
  .ways a:hover { text-decoration: none; color: var(--accent-ink); }
  /* The chevron says "this leaves the page", the way a list row does on a
     phone. It is drawn rather than an icon file so there is nothing to load. */
  .ways a::after {
    content: ""; width: 7px; height: 7px; flex: none;
    border-right: 1.5px solid var(--ink-3); border-bottom: 1.5px solid var(--ink-3);
    transform: rotate(-45deg); margin-left: 12px;
  }

  pre {
    font-family: var(--mono); font-size: 13px; line-height: 1.55;
    background: var(--sunken); border: 1px solid var(--line); border-radius: var(--radius-sm);
    padding: 11px 13px; margin: 8px 0 0; overflow-x: auto; color: var(--ink);
  }

  /* ---- commits and runs --------------------------------------------- */
  .line {
    display: flex; gap: 12px; align-items: baseline; padding: 10px 0;
    border-top: 1px solid var(--line-soft); font-size: 14px; min-height: 44px;
  }
  .line:first-child { border-top: 0; }
  .line .sha { font-family: var(--mono); font-size: 13px; color: var(--ink-3); flex: none; }
  .line .what { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .line .when { flex: none; font-size: 13px; color: var(--ink-3); }

  .green { color: var(--accent); }
  .red   { color: var(--danger); }

  /* ---- say something ------------------------------------------------ */
  .say { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }

  @media (max-width: 640px) {
    .kv { grid-template-columns: 1fr; gap: 2px 0; }
    .kv dt { margin-top: 8px; }
    .line { flex-wrap: wrap; }
  }
`;
