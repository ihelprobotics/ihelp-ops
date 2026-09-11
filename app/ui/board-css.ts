// The board's own CSS. The shell — tokens, header, nav, buttons, the progress
// bar — is app/ui/base-css.ts; this adds only the columns and the cards.
//
// The columns are quiet on purpose. Each carries one coloured dot and a count,
// and the bar inside its cards takes the same colour, so the eye finds "what is
// stuck in review" without reading a word. Everything else stays on the one
// accent the rest of the product uses.

export const BOARD_CSS = `
  .wrap.wide { max-width: 1320px; }

  /* ---- filters ----------------------------------------------------- */
  .filters { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin: 4px 0 18px; }
  .seg {
    display: inline-flex; gap: 2px; padding: 2px;
    background: rgba(118,118,128,.10); border-radius: 10px;
  }
  .seg a, .seg .off {
    display: inline-flex; align-items: center; gap: 6px; min-height: 32px;
    font-size: 13px; font-weight: 500; color: var(--ink-2);
    padding: 5px 12px; border-radius: 8px; transition: background .15s ease, color .15s ease;
  }
  .seg a:hover { color: var(--ink); text-decoration: none; }
  .seg a.on { background: var(--surface); color: var(--ink); box-shadow: var(--shadow); }
  .seg .off { color: var(--ink-3); cursor: not-allowed; }
  .seg .n { font-size: 11px; color: var(--ink-3); font-variant-numeric: tabular-nums; }
  .filters select { min-height: 36px; font-size: 14px; padding: 6px 10px; max-width: 100%; }
  .filters .new {
    margin-left: auto; min-height: 36px; padding: 8px 16px; font-size: 14px;
    display: inline-flex; align-items: center;
  }
  .filters .new:hover { text-decoration: none; }

  /* ---- columns ----------------------------------------------------- */
  .cols { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; align-items: start; }
  .col { background: rgba(118,118,128,.06); border-radius: var(--radius); padding: 10px; min-width: 0; }
  .col.todo   { --dot: var(--ink-3); }
  .col.doing  { --dot: var(--amber); }
  .col.review { --dot: var(--accent); }
  .col.done   { --dot: var(--accent-ink); }

  .col-head { display: flex; align-items: center; gap: 8px; padding: 4px 4px 0; }
  .col-head b { font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
  .col-head b::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--dot); }
  .col-head .count {
    margin-left: auto; font-size: 12px; font-weight: 600; color: var(--ink-2);
    background: var(--surface); border-radius: 100px; padding: 1px 9px;
    font-variant-numeric: tabular-nums;
  }
  .col-hint { font-size: 12px; color: var(--ink-3); margin: 1px 4px 10px 20px; }
  .col-list { display: flex; flex-direction: column; gap: 8px; }
  .col-empty {
    margin: 0; padding: 14px 8px; text-align: center; font-size: 13px; color: var(--ink-3);
    border: 1px dashed var(--line); border-radius: var(--radius-sm);
  }

  /* ---- cards ------------------------------------------------------- */
  .tcard {
    background: var(--surface); border-radius: var(--radius-sm); box-shadow: var(--shadow);
    border: 1px solid var(--line-soft); overflow: hidden;
    transition: box-shadow .15s ease, border-color .15s ease;
  }
  .tcard:hover { box-shadow: 0 4px 16px rgba(0,0,0,.07); border-color: var(--line); }
  /* Your own work, marked at the edge rather than in a colour of its own. */
  .tcard.mine { box-shadow: inset 3px 0 0 var(--accent), var(--shadow); }

  .tcard-main { display: block; padding: 11px 13px 9px; color: inherit; }
  .tcard-main:hover { text-decoration: none; }
  .tcard-ref { font-size: 12px; color: var(--ink-3); font-variant-numeric: tabular-nums; }
  .tcard-title {
    font-size: 14px; font-weight: 500; line-height: 1.35; margin-top: 2px; color: var(--ink);
    overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 3;
    -webkit-box-orient: vertical; overflow: hidden;
  }
  .tcard .bar { height: 4px; margin: 10px 0 6px; }
  .col.todo  .tcard .bar i { background: var(--ink-3); }
  .col.doing .tcard .bar i { background: var(--amber); }
  .tcard-stage { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--ink-2); }
  .tcard-stage b { font-weight: 600; color: var(--ink); font-variant-numeric: tabular-nums; }
  .tcard-labels { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
  .tcard-labels .tag { font-size: 11px; padding: 1px 7px; }

  .tcard-foot {
    display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 4px 8px;
    padding: 6px 13px 8px; border-top: 1px solid var(--line-soft);
    min-height: 42px; font-size: 12px; color: var(--ink-2);
  }
  .tcard-who { display: inline-flex; align-items: center; gap: 6px; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .av {
    width: 20px; height: 20px; border-radius: 50%; flex: none;
    display: inline-flex; align-items: center; justify-content: center;
    background: var(--accent-bg); color: var(--accent-ink);
    font-style: normal; font-size: 11px; font-weight: 600;
  }
  .tcard-when { color: var(--ink-3); flex: none; }

  .take {
    flex: none; background: var(--accent); color: #fff; border: 0; border-radius: 100px;
    padding: 5px 13px; min-height: 30px; font-size: 12px; font-weight: 600; cursor: pointer;
    transition: background .15s ease, transform .1s ease;
  }
  .take:hover:not(:disabled) { background: var(--accent-ink); }
  .take:active:not(:disabled) { transform: scale(.97); }
  .take:disabled { opacity: .5; cursor: progress; }
  .take-err { flex-basis: 100%; margin: 2px 0 0; color: var(--danger); font-size: 12px; line-height: 1.4; }

  /* ---- around the columns ------------------------------------------ */
  .empty {
    background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow);
    padding: 32px 20px; text-align: center; color: var(--ink-2); margin: 0;
  }
  .foot { margin: 18px 4px 0; }

  .quiet { margin-top: 6px; }
  .quiet summary {
    font-size: 13px; color: var(--ink-2); cursor: pointer; padding: 6px 4px; min-height: 32px;
    list-style: none; display: flex; align-items: center; gap: 6px;
  }
  .quiet summary::-webkit-details-marker { display: none; }
  .quiet summary::before {
    content: ""; width: 6px; height: 6px; flex: none;
    border-right: 1.5px solid var(--ink-3); border-bottom: 1.5px solid var(--ink-3);
    transform: rotate(-45deg); transition: transform .15s ease;
  }
  .quiet[open] summary::before { transform: rotate(45deg); }
  .quiet p { margin: 2px 0 0 16px; line-height: 1.7; }

  @media (max-width: 1080px) { .cols { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 640px) {
    .cols { grid-template-columns: 1fr; }
    .filters .new { margin-left: 0; }
  }
`;
