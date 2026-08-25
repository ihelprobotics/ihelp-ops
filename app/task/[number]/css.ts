// Screen-specific CSS for /task/[number]. The shared shell is in
// app/ui/base-css.ts; only what this page adds lives here.

import { BASE_CSS } from "@/app/ui/base-css";

export const TASK_CSS = `
${BASE_CSS}
  .back { font-size: 11px; font-family: ui-monospace, monospace; text-decoration: none; }
  .card { background: #151F2A; border: 1px solid #26343F; border-radius: 2px; padding: 13px 15px; }
  .card + .card { margin-top: 8px; }
  .stage { display: flex; gap: 10px; align-items: baseline; }
  .pct { font-family: ui-monospace, monospace; font-size: 12px; color: #4FD1C5; }
  .labels { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
  .label { font-size: 11px; font-family: ui-monospace, monospace; color: #78909F; border: 1px solid #26343F; border-radius: 2px; padding: 1px 6px; }
  .kv { display: grid; grid-template-columns: 150px 1fr; gap: 5px 14px; font-size: 13px; }
  .kv dt { color: #78909F; font-size: 12px; }
  .kv dd { margin: 0; }
  .ways { display: flex; flex-direction: column; gap: 7px; }
  .ways a { font-size: 13px; text-decoration: none; }
  .ways a:hover { text-decoration: underline; }
  pre { background: #0E1620; border: 1px solid #26343F; border-radius: 2px; padding: 9px 11px; margin: 0; overflow-x: auto; font-size: 12px; color: #A9BECC; }
  .line { display: flex; gap: 10px; align-items: baseline; padding: 6px 0; border-top: 1px solid #1E2A35; font-size: 13px; }
  .line:first-child { border-top: 0; }
  .line .sha { font-family: ui-monospace, monospace; font-size: 12px; color: #78909F; flex: none; }
  .line .what { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .line .when { flex: none; font-size: 11px; color: #4E6472; font-family: ui-monospace, monospace; }
  .body { white-space: pre-wrap; font-size: 13px; color: #A9BECC; margin: 0; }
  .cmt { border-top: 1px solid #1E2A35; padding: 10px 0; }
  .cmt:first-child { border-top: 0; }
  .cmt header { font-size: 11px; font-family: ui-monospace, monospace; color: #78909F; margin-bottom: 4px; }
  .green { color: #4FD1C5; }
  .amber { color: #F2A03D; }
  .red { color: #E0555F; }
`;
