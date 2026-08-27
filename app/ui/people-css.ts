// Shared by /team, /leave, /me and /person/[id] — the four people screens.
//
// The shell is app/ui/base-css.ts and the nav rules travel with the nav
// component. Only what these four pages add lives here, and it lives in one
// file because four copies of a row style drift into four slightly different
// versions of the same product.

import { BASE_CSS } from "@/app/ui/base-css";
import { NAV_CSS } from "@/app/ui/nav";

export const PEOPLE_CSS = `
${BASE_CSS}
${NAV_CSS}
  .back { font-size: 11px; font-family: ui-monospace, monospace; text-decoration: none; }
  .card { background: #151F2A; border: 1px solid #26343F; border-radius: 2px; padding: 13px 15px; }
  .card + .card { margin-top: 8px; }
  .pod { color: #4FD1C5; font-family: ui-monospace, monospace; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; margin: 22px 0 8px; }
  .person { display: flex; gap: 14px; align-items: baseline; padding: 9px 0; border-top: 1px solid #1E2A35; }
  .person:first-child { border-top: 0; }
  .person .id { flex: 0 0 210px; min-width: 0; }
  .person .id b { display: block; font-weight: 500; }
  .person .id span { font-size: 11px; font-family: ui-monospace, monospace; color: #4E6472; }
  .person .work { flex: 1; min-width: 0; font-size: 13px; }
  .person .work a { text-decoration: none; }
  .person .work a:hover { text-decoration: underline; }
  .tags { display: flex; gap: 6px; flex-wrap: wrap; flex: 0 0 auto; }
  .tag { font-size: 10px; font-family: ui-monospace, monospace; color: #78909F; border: 1px solid #26343F; border-radius: 2px; padding: 1px 6px; }
  .tag.away { color: #F2A03D; border-color: #4A3A22; }
  .tag.on { color: #4FD1C5; border-color: #24463F; }
  .nums { display: flex; gap: 26px; flex-wrap: wrap; }
  .num b { display: block; font-family: ui-monospace, monospace; font-size: 20px; color: #DCE6ED; font-weight: 500; }
  .num span { font-size: 11px; color: #78909F; }
  .row { display: flex; gap: 12px; align-items: baseline; padding: 8px 0; border-top: 1px solid #1E2A35; font-size: 13px; }
  .row:first-child { border-top: 0; }
  .row .when { flex: 0 0 168px; font-family: ui-monospace, monospace; font-size: 12px; color: #78909F; }
  .row .what { flex: 1; min-width: 0; }
  .row .st { flex: 0 0 auto; font-family: ui-monospace, monospace; font-size: 11px; }
  .st.approved { color: #4FD1C5; }
  .st.pending  { color: #F2A03D; }
  .st.rejected, .st.cancelled { color: #78909F; }
  .body { white-space: pre-wrap; font-size: 13px; color: #A9BECC; margin: 4px 0 0; }
  form.stack { display: flex; flex-direction: column; gap: 9px; }
  .fields { display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-end; }
  .field { display: flex; flex-direction: column; gap: 3px; }
  .field label { font-size: 11px; color: #78909F; font-family: ui-monospace, monospace; }
  input, select, textarea {
    background: #0E1620; color: #DCE6ED; border: 1px solid #26343F; border-radius: 2px;
    padding: 6px 8px; font: inherit; font-size: 13px;
  }
  input:focus, select:focus, textarea:focus { outline: 0; border-color: #4FD1C5; }
  textarea { resize: vertical; min-height: 54px; width: 100%; }
  .go { background: #4FD1C5; color: #06231F; border: 0; border-radius: 2px; padding: 7px 13px; font-weight: 600; font-size: 12px; cursor: pointer; font-family: inherit; }
  .go:disabled { opacity: .5; cursor: not-allowed; }
  .flat { background: none; color: #DCE6ED; border: 1px solid #26343F; border-radius: 2px; padding: 6px 11px; font-size: 12px; cursor: pointer; font-family: inherit; }
  .flat:hover { border-color: #4FD1C5; }
  .flat:disabled { opacity: .5; cursor: not-allowed; }
  .ok { background: #1B2733; border-left: 3px solid #4FD1C5; padding: 11px 13px; margin-top: 12px; border-radius: 2px; font-size: 13px; }
  .goal { border-top: 1px solid #1E2A35; padding: 11px 0; }
  .goal:first-child { border-top: 0; }
  .goal header { display: flex; gap: 10px; align-items: baseline; }
  .goal .cyc { font-family: ui-monospace, monospace; font-size: 11px; color: #4FD1C5; }
  .goal .due { margin-left: auto; font-family: ui-monospace, monospace; font-size: 11px; color: #4E6472; }
  .ev { display: flex; flex-direction: column; gap: 3px; margin-top: 6px; }
  .ev a { font-size: 12px; text-decoration: none; }
  .ev a:hover { text-decoration: underline; }
`;
