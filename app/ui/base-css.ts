// The shell every screen shares: page frame, headings, notices, muted text.
//
// No CSS framework. This is the same plain CSS that was written inline in
// app/page.tsx, moved here the moment a second screen needed it — one copy,
// because two would drift and the drift would show as two slightly different
// versions of the same product.
//
// Screen-specific rules stay in the screen. Only what is genuinely shared
// belongs here.

export const BASE_CSS = `
  * { box-sizing: border-box; }
  body {
    margin: 0; background: #0E1620; color: #DCE6ED;
    font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
    font-size: 14px; line-height: 1.5;
  }
  a { color: #4FD1C5; }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 24px; }
  .top { display: flex; align-items: flex-start; gap: 16px; border-bottom: 1px solid #26343F; padding-bottom: 16px; }
  h1 { font-size: 17px; margin: 0; font-weight: 600; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .09em; color: #78909F; margin: 30px 0 12px; font-weight: 500; }
  .sub { color: #4E6472; margin: 2px 0 0; font-size: 12px; font-family: ui-monospace, monospace; }
  .who { margin-left: auto; text-align: right; font-size: 12px; }
  .who b { display: block; }
  .who span { color: #78909F; font-family: ui-monospace, monospace; font-size: 11px; }
  .warn { color: #F2A03D; font-style: normal; }
  .notice { background: #1B2733; border-left: 3px solid #F2A03D; padding: 11px 13px; margin-top: 18px; border-radius: 2px; font-size: 13px; }
  .notice code { font-family: ui-monospace, monospace; font-size: 12px; color: #DCE6ED; }
  .error { background: #1B2733; border-left: 3px solid #E0555F; padding: 11px 13px; margin-top: 18px; border-radius: 2px; font-size: 13px; }
  .bar { height: 3px; background: #26343F; border-radius: 2px; margin: 8px 0 6px; overflow: hidden; }
  .bar i { display: block; height: 100%; background: #4FD1C5; }
  .muted { color: #4E6472; }
  .small { font-size: 11px; }
  .mono { font-family: ui-monospace, monospace; }
`;
