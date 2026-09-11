// The shell every screen shares: tokens, page frame, headings, lists, controls.
//
// No CSS framework. Plain CSS in one place, because two copies of a row style
// drift into two slightly different versions of the same product.
//
// The look is deliberately quiet. This is a tool people open twenty times a day
// to answer one question — where is the work — and a screen that decorates that
// answer gets in its way. So: a paper-white ground, white cards, hairline
// separators, one accent, and type doing the hierarchy.
//
// The structure borrows from iOS grouped lists, and not for fashion. That
// pattern is the most-practised reading surface most people own: a large title
// telling you where you are, sections with a plain-language header, rows of a
// consistent height with the label left and the value right, and a separator
// that starts where the text starts. Nobody has to learn it.
//
// Three rules hold throughout:
//
//   Anything you can touch is at least 44px tall. Below that, phones and
//   trackpads both start missing.
//
//   Every colour comes from a token. A literal in a component is a colour that
//   cannot be changed anywhere.
//
//   Motion is 150ms and only on things you pressed, and it stops entirely when
//   the reader has asked for less of it.
//
// The palette commits to light. This product had a dark terminal look; the
// team asked for the opposite, so it is one well-made theme rather than two
// half-made ones — every surface and every colour is painted explicitly.

export const BASE_CSS = `
  :root {
    --ground:     #F5F5F7;
    --surface:    #FFFFFF;
    --sunken:     #FAFAFA;
    --line:       #E4E4E9;
    --line-soft:  #EFEFF3;

    --ink:        #1D1D1F;
    --ink-2:      #6E6E73;
    --ink-3:      #A0A0A6;

    /* Deep teal. The dark product was teal; this is the same idea grown up —
       enough contrast to sit on white as a link, quiet enough not to shout. */
    --accent:     #12736C;
    --accent-ink: #0B534E;
    --accent-bg:  #EAF4F2;

    --amber:      #8A5A12;
    --amber-bg:   #FDF4E6;
    --danger:     #B3261E;
    --danger-bg:  #FCEEED;

    --radius:     12px;
    --radius-sm:  9px;
    --shadow:     0 1px 2px rgba(0,0,0,.04), 0 1px 1px rgba(0,0,0,.03);

    --font: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto,
            "Helvetica Neue", Arial, sans-serif;
    --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  }

  * { box-sizing: border-box; }

  html { -webkit-text-size-adjust: 100%; }

  body {
    margin: 0;
    background: var(--ground);
    color: var(--ink);
    font-family: var(--font);
    font-size: 15px;
    line-height: 1.47;
    letter-spacing: -.01em;
    -webkit-font-smoothing: antialiased;
    -webkit-tap-highlight-color: transparent;
  }

  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }

  /* ---- page frame -------------------------------------------------- */
  .wrap { max-width: 760px; margin: 0 auto; padding: 28px 20px 72px; }

  .top { display: flex; align-items: flex-start; gap: 16px; margin-bottom: 22px; }
  .top > div:first-child { min-width: 0; }

  h1 {
    font-size: 30px; line-height: 1.12; font-weight: 700; letter-spacing: -.028em;
    margin: 0 0 2px; text-wrap: balance;
  }
  .sub { color: var(--ink-2); margin: 0; font-size: 13px; }

  /* Section headers: plain language, not shouted. */
  h2 {
    font-size: 13px; font-weight: 600; color: var(--ink-2);
    letter-spacing: -.005em; margin: 26px 0 8px; padding: 0 4px;
  }

  .who { margin-left: auto; text-align: right; font-size: 13px; flex: none; }
  .who b { display: block; font-weight: 600; }
  .who span { color: var(--ink-2); font-size: 12px; }
  .warn { color: var(--amber); font-style: normal; }

  /* ---- segmented navigation ---------------------------------------- */
  .nav {
    display: inline-flex; gap: 2px; margin-top: 12px; padding: 2px;
    background: rgba(118,118,128,.10); border-radius: 10px; max-width: 100%;
    overflow-x: auto; scrollbar-width: none;
  }
  .nav::-webkit-scrollbar { display: none; }
  .nav a {
    font-size: 13px; font-weight: 500; color: var(--ink-2); text-decoration: none;
    padding: 6px 13px; border-radius: 8px; white-space: nowrap;
    transition: background .15s ease, color .15s ease;
  }
  .nav a:hover { color: var(--ink); text-decoration: none; }
  .nav a.on { background: var(--surface); color: var(--ink); box-shadow: var(--shadow); }

  /* ---- grouped list cards ------------------------------------------ */
  .card {
    background: var(--surface); border-radius: var(--radius);
    box-shadow: var(--shadow); padding: 14px 16px; overflow: hidden;
  }
  .card + .card { margin-top: 10px; }

  /* A row inside a card. The separator starts where the text does, which is
     what stops a list of rows reading as a table. */
  .row {
    display: flex; gap: 12px; align-items: baseline;
    padding: 11px 0; min-height: 44px; border-top: 1px solid var(--line-soft);
    font-size: 15px;
  }
  .row:first-child { border-top: 0; }
  .row .when { flex: 0 0 150px; color: var(--ink-2); font-size: 13px; }
  .row .what { flex: 1; min-width: 0; }
  .row .st { flex: 0 0 auto; font-size: 13px; font-weight: 500; }
  .st.approved, .st.success { color: var(--accent); }
  .st.pending { color: var(--amber); }
  .st.rejected, .st.cancelled { color: var(--ink-3); }

  /* ---- type helpers ------------------------------------------------ */
  .muted { color: var(--ink-2); }
  .small { font-size: 13px; }
  .mono { font-family: var(--mono); font-variant-numeric: tabular-nums; }
  .body { white-space: pre-wrap; font-size: 15px; color: var(--ink); margin: 6px 0 0; }

  /* ---- numbers ----------------------------------------------------- */
  .nums { display: flex; gap: 30px; flex-wrap: wrap; }
  .num b {
    display: block; font-size: 26px; font-weight: 600; letter-spacing: -.02em;
    font-variant-numeric: tabular-nums; color: var(--ink);
  }
  .num span { font-size: 12px; color: var(--ink-2); }
  .pct { color: var(--accent); }
  .amber { color: var(--amber); }

  /* ---- progress ---------------------------------------------------- */
  .bar {
    height: 6px; background: var(--line); border-radius: 3px;
    margin: 8px 0 6px; overflow: hidden;
  }
  .bar i { display: block; height: 100%; background: var(--accent); border-radius: 3px; }

  /* ---- badges ------------------------------------------------------ */
  .tag {
    display: inline-block; font-size: 12px; font-weight: 500; color: var(--ink-2);
    background: rgba(118,118,128,.09); border-radius: 100px; padding: 2px 9px;
    white-space: nowrap;
  }
  .tag.on { background: var(--accent-bg); color: var(--accent); }
  .tag.away { background: var(--amber-bg); color: var(--amber); }

  /* ---- controls ---------------------------------------------------- */
  button { font-family: inherit; }

  .go {
    background: var(--accent); color: #fff; border: 0; border-radius: var(--radius-sm);
    padding: 10px 18px; min-height: 40px; font-size: 15px; font-weight: 600;
    cursor: pointer; letter-spacing: -.01em; transition: background .15s ease, transform .1s ease;
  }
  .go:hover:not(:disabled) { background: var(--accent-ink); }
  .go:active:not(:disabled) { transform: scale(.98); }
  .go:disabled { opacity: .4; cursor: not-allowed; }

  .flat {
    background: var(--surface); color: var(--accent); border: 1px solid var(--line);
    border-radius: var(--radius-sm); padding: 9px 15px; min-height: 40px;
    font-size: 15px; font-weight: 500; cursor: pointer;
    transition: background .15s ease, border-color .15s ease, transform .1s ease;
  }
  .flat:hover:not(:disabled) { background: var(--sunken); border-color: var(--ink-3); }
  .flat:active:not(:disabled) { transform: scale(.98); }
  .flat:disabled { opacity: .4; cursor: not-allowed; }

  input, select, textarea {
    font-family: inherit; font-size: 15px; color: var(--ink);
    background: var(--surface); border: 1px solid var(--line);
    border-radius: var(--radius-sm); padding: 9px 11px; min-height: 40px;
    transition: border-color .15s ease, box-shadow .15s ease;
  }
  input:focus, select:focus, textarea:focus {
    outline: 0; border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-bg);
  }
  textarea { resize: vertical; min-height: 74px; width: 100%; line-height: 1.5; }
  input[type="checkbox"] { min-height: 0; accent-color: var(--accent); }

  .fields { display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-end; }
  .field { display: flex; flex-direction: column; gap: 5px; }
  .field label { font-size: 12px; font-weight: 500; color: var(--ink-2); }

  /* ---- messages ---------------------------------------------------- */
  .notice, .error, .ok {
    border-radius: var(--radius); padding: 12px 15px; margin: 14px 0;
    font-size: 14px; line-height: 1.5;
  }
  .notice { background: var(--amber-bg); color: var(--amber); }
  .error  { background: var(--danger-bg); color: var(--danger); }
  .ok     { background: var(--accent-bg); color: var(--accent-ink); }
  .notice code, .error code { font-family: var(--mono); font-size: 13px; }

  code {
    font-family: var(--mono); font-size: .89em;
    background: rgba(118,118,128,.10); border-radius: 5px; padding: .1em .4em;
  }

  /* ---- focus and motion -------------------------------------------- */
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }

  @media (prefers-reduced-motion: reduce) {
    * { transition: none !important; animation: none !important; }
  }

  @media (max-width: 640px) {
    .wrap { padding: 20px 16px 60px; }
    h1 { font-size: 26px; }
    .row { flex-wrap: wrap; gap: 4px 10px; }
    .row .when { flex-basis: 100%; }
    .nums { gap: 22px; }
  }

  /* ---- talking to an agent ------------------------------------------
     A conversation reads as a conversation: the two sides sit on opposite
     edges, yours on the accent, theirs on the sunken ground, so a glance
     tells you who said what without reading a name. The message list has a
     fixed height and scrolls inside itself — otherwise a long exchange pushes
     the evidence below it off the bottom of the world. */
  .chat { display: flex; flex-direction: column; gap: 12px; }

  .chat-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .chat-top select { min-width: 160px; }

  .msgs {
    display: flex; flex-direction: column; gap: 14px;
    max-height: 460px; overflow-y: auto; padding: 2px;
    scroll-behavior: smooth;
  }

  .msg { display: flex; flex-direction: column; gap: 4px; max-width: 86%; }
  .msg.user      { align-self: flex-end;   align-items: flex-end; }
  .msg.assistant { align-self: flex-start; align-items: flex-start; }
  /* A dispatch receipt. Centred and full width because it is neither side of
     the conversation — it is the moment the conversation turned into work that
     leaves this page. */
  .msg.run { align-self: stretch; align-items: stretch; max-width: 100%; }

  .msg .from {
    font-size: 11px; font-weight: 600; letter-spacing: .04em;
    text-transform: uppercase; color: var(--ink-3);
  }
  .msg .body {
    margin: 0; padding: 10px 14px; border-radius: 16px;
    font-size: 15px; line-height: 1.55; white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  /* Inline code inside a bubble. The global rule tints it grey, which on the
     accent-coloured side of the conversation disappears entirely. */
  .msg .body code { font-size: .88em; }
  .msg.user .body code { background: rgba(255,255,255,.22); color: #fff; }
  .msg.assistant .body code { background: rgba(118,118,128,.13); }
  .msg .body strong { font-weight: 600; }

  .msg.user .body {
    background: var(--accent); color: #fff; border-bottom-right-radius: 5px;
  }
  .msg.assistant .body {
    background: var(--sunken); color: var(--ink); border-bottom-left-radius: 5px;
    /* A hairline, because the sunken grey sits close to the card it is on and
       without it the agent's side of the conversation loses its edges. */
    box-shadow: inset 0 0 0 1px var(--line-soft);
  }
  .msg.run .body {
    background: var(--accent-bg); color: var(--accent-ink);
    border-radius: var(--radius-sm); font-size: 13.5px;
    box-shadow: inset 0 0 0 1px var(--line-soft);
  }

  /* Dispatching from the conversation. */
  .dispatch { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .dispatch-why { margin: 0; }
  .dispatch-box {
    display: flex; flex-direction: column; gap: 10px;
    padding: 14px; border-radius: var(--radius-sm);
    background: var(--sunken); box-shadow: inset 0 0 0 1px var(--line);
  }
  .dispatch-box textarea { width: 100%; }
  .dispatch-box .warn { margin: 0; color: var(--amber); }
  .dispatch-box .warn strong { color: var(--amber); }
  .dispatch-box p { margin: 0; }
  .dispatch-foot {
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
  }
  .dispatch-foot .row { display: flex; gap: 8px; }
  .dispatch-foot .over { color: var(--danger); font-weight: 600; }

  /* The model's working-out while you wait for the answer. Dimmed and
     italic because it is not the answer — and it disappears the moment the
     answer starts, so nobody is left reading the notes instead of the reply. */
  .msg .thinking {
    margin: 0; padding: 8px 14px; border-radius: 14px;
    border-bottom-left-radius: 5px;
    background: transparent; box-shadow: inset 0 0 0 1px var(--line-soft);
    color: var(--ink-3); font-size: 13.5px; line-height: 1.5;
    font-style: italic; white-space: pre-wrap; overflow-wrap: anywhere;
  }

  .ask { display: flex; gap: 10px; align-items: flex-end; }
  .ask textarea { min-height: 46px; }
  .ask .go { flex: 0 0 auto; }

  .dispatch-go { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
  .dispatch-live { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
  .dispatch-live .live { align-self: stretch; }

  /* ---- choosing an agent --------------------------------------------
     Every tile can be talked to; the last line says whether it can also be
     run. A tile you cannot run is quieter, never hidden. */
  .agrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
  .atile {
    display: flex; flex-direction: column; gap: 2px; min-height: 44px; text-align: left;
    font: inherit; color: inherit; cursor: pointer; padding: 9px 11px;
    background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-sm);
    transition: border-color .15s ease, background .15s ease;
  }
  .atile:hover:not(:disabled) { border-color: var(--ink-3); }
  .atile.on { border-color: var(--accent); background: var(--accent-bg); box-shadow: inset 0 0 0 1px var(--accent); }
  .atile b { font-size: 14px; font-weight: 600; }
  .atile span { font-size: 12px; color: var(--ink-2); line-height: 1.35; }
  .atile em { font-style: normal; font-size: 11px; font-weight: 500; color: var(--accent); margin-top: 3px; }
  .atile.talk em { color: var(--ink-3); }
  .atile:disabled { cursor: not-allowed; opacity: .6; }

  /* ---- a run, watched ----------------------------------------------- */
  .live {
    display: flex; flex-direction: column; gap: 10px; padding: 14px;
    border-radius: var(--radius-sm); background: var(--sunken); box-shadow: inset 0 0 0 1px var(--line);
  }
  .live-head { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
  .live-log {
    margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 3px;
    max-height: 240px; overflow-y: auto; font-family: var(--mono); font-size: 12.5px;
  }
  .live-log li { color: var(--ink-2); overflow-wrap: anywhere; }
  .live-log li.tool::before { content: "› "; color: var(--ink-3); }
  .live-log li.failed, .live-log li.pending { color: var(--ink-3); }
  .live .ok, .live .error { margin: 0; }
  .live-said .body { font-size: 13.5px; margin-top: 6px; }

  @media (max-width: 640px) {
    .msg { max-width: 94%; }
    .msgs { max-height: 60vh; }
    .dispatch-go { justify-content: stretch; }
  }
`;
