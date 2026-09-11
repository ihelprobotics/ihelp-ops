"use client";

// Choosing an agent, on the task it will work on.
//
// This grid used to sit on the board, armed by selecting a row. It lives beside
// the conversation now, next to the issue the agent will read. The rule from
// docs/06 travels with it: a tile you cannot run stays visible and says why —
// a greyed tile that explains itself teaches, a hidden one confuses.
//
// Every tile can be talked to. What a tile's last line tells you is whether you
// can also run it, which is the one thing tiers and the draft rule gate.

import { AGENTS, DRAFT_AGENTS, canDispatch } from "@/app/lib/agents";
import type { Me } from "./dispatch";

export default function AgentGrid({
  value, me, disabled, onPick,
}: {
  value: string;
  me: Me;
  disabled: boolean;
  onPick: (id: string) => void;
}) {
  const tile = (id: string, title: string, blurb: string, status: string, runnable: boolean, why?: string) => (
    <button
      key={id}
      type="button"
      role="radio"
      aria-checked={value === id}
      title={why}
      disabled={disabled}
      className={"atile" + (value === id ? " on" : "") + (runnable ? "" : " talk")}
      onClick={() => onPick(id)}
    >
      <b>{title}</b>
      <span>{blurb}</span>
      <em>{status}</em>
    </button>
  );

  return (
    <div className="agrid" role="radiogroup" aria-label="Agent">
      {AGENTS.map((a) => {
        const d = canDispatch(a.id, me);
        const status = !me
          ? "Sign in to run"
          : !me.login
          ? "Talk · link GitHub to run"
          : d.ok
          ? "Talk or run"
          : `Talk · run unlocks at ${a.tier}`;
        return tile(a.id, a.name, a.blurb, status, !!me?.login && d.ok, d.ok ? undefined : d.why);
      })}
      {DRAFT_AGENTS.map((a) => tile(a.id, a.name, a.blurb, "Talk · its human owner runs it", false, a.why))}
    </div>
  );
}
