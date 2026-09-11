"use client";

// Talking to an agent about this task.
//
// Streamed token by token, because the alternative — a spinner for twenty
// seconds and then a wall of text — reads as broken, and the second thing
// somebody does when a thing looks broken is press the button again.
//
// The conversation is yours. It is not on the issue, nobody else can read it,
// and nothing said here moves the task. When something from it matters, put it
// on the issue with the comment box above: that is the record, this is the
// thinking. The heading says so, because a chat box next to a task is exactly
// the thing people assume is shared.

import { useEffect, useRef, useState } from "react";
import { agentName } from "@/app/lib/agents";
import Dispatch, { type Me } from "./dispatch";
import AgentGrid from "./agent-grid";

type Msg = {
  role: "user" | "assistant" | "run";
  content: string;
  cost?: number;
  thinking?: string;
};

/**
 * The little bit of Markdown an agent actually writes.
 *
 * Bold and inline code, and nothing else. The agents emphasise a phrase and
 * name a file, and left as plain text those arrive as `**like this**` and
 * backticks, which reads as broken software rather than as formatting.
 *
 * A full Markdown renderer is a dependency and an escaping problem for two
 * constructs. This returns React nodes, so nothing is ever interpreted as HTML
 * — the answer is a string from a model and must not be able to become markup.
 * Everything it does not recognise stays exactly as written, including the
 * asterisks, because silently eating a character is worse than showing it.
 */
function rich(text: string) {
  const parts: React.ReactNode[] = [];
  const pattern = /`([^`\n]+)`|\*\*([^*\n]+)\*\*/g;
  let at = 0;
  let m: RegExpExecArray | null;

  while ((m = pattern.exec(text))) {
    if (m.index > at) parts.push(text.slice(at, m.index));
    parts.push(
      m[1] !== undefined
        ? <code key={m.index}>{m[1]}</code>
        : <strong key={m.index}>{m[2]}</strong>
    );
    at = m.index + m[0].length;
  }
  if (at < text.length) parts.push(text.slice(at));
  return parts;
}

export default function Chat({
  owner, name, issue, initialAgent, history, me, picker = true,
}: {
  owner: string;
  name: string;
  issue: number;
  initialAgent: string;
  history: { agent: string; messages: Msg[] };
  me: Me;
  /** False where the page has its own agent list, as /agents does. */
  picker?: boolean;
}) {
  const [agent, setAgent] = useState(initialAgent);
  const [msgs, setMsgs] = useState<Msg[]>(history.agent === initialAgent ? history.messages : []);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [spent, setSpent] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [msgs, busy]);

  // What to put in the brief box as a starting point: the last thing this
  // person actually asked for. The agent's reply is not used — it is the
  // agent's words, and what gets published should be the person's.
  const lastAsked = [...msgs].reverse().find((m) => m.role === "user")?.content ?? "";

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;

    setDraft("");
    setErr("");
    setBusy(true);
    setMsgs((m) => [...m, { role: "user", content: text }, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner, name, issue, agent, message: text }),
      });

      const type = res.headers.get("content-type") ?? "";

      // A session that lapsed while this page sat open is bounced to the
      // sign-in screen by the middleware, so what comes back is HTML. Saying
      // "the server did not answer" would send somebody to the network tab
      // over an expired cookie.
      if (res.redirected || type.includes("text/html")) {
        setErr("Your session has expired. Reload the page, sign in again, and your conversation will still be here.");
        setMsgs((m) => m.slice(0, -1));
        return;
      }

      // Any other error before the stream starts comes back as ordinary JSON.
      if (!type.includes("text/event-stream")) {
        const out = await res.json().catch(() => ({ error: `The server answered with ${res.status} and no conversation.` }));
        setErr(out.error);
        setMsgs((m) => m.slice(0, -1));
        return;
      }

      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });

        // SSE frames are separated by a blank line; a partial frame stays in
        // the buffer until the rest of it arrives.
        const frames = buf.split("\n\n");
        buf = frames.pop() ?? "";

        for (const frame of frames) {
          const ev = /^event: (.+)$/m.exec(frame)?.[1];
          const raw = /^data: (.+)$/m.exec(frame)?.[1];
          if (!ev || !raw) continue;
          const data = JSON.parse(raw);

          if (ev === "thinking") {
            setMsgs((m) => {
              const next = [...m];
              const last = next[next.length - 1];
              next[next.length - 1] = { ...last, thinking: (last.thinking ?? "") + data.delta };
              return next;
            });
          } else if (ev === "text") {
            setMsgs((m) => {
              const next = [...m];
              next[next.length - 1] = { role: "assistant", content: next[next.length - 1].content + data.delta };
              return next;
            });
          } else if (ev === "error") {
            setErr(data.error);
          } else if (ev === "done") {
            setSpent((s) => s + data.cost);
            setMsgs((m) => {
              const next = [...m];
              next[next.length - 1] = { ...next[next.length - 1], cost: data.cost };
              return next;
            });
          }
        }
      }
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  function switchAgent(next: string) {
    setAgent(next);
    setMsgs([]);
    setErr("");
    // Each agent keeps its own thread. Switching shows an empty box rather than
    // the previous agent's conversation; reload the page to see the stored one.
  }

  return (
    <div className="chat">
      {picker && <AgentGrid value={agent} me={me} disabled={busy} onPick={switchAgent} />}

      {spent > 0 && (
        <div className="chat-top">
          <span className="muted small">{`$${spent.toFixed(4)} this session`}</span>
        </div>
      )}

      <div className="msgs">
        {msgs.length === 0 && !busy && (
          <p className="muted small" style={{ margin: 0 }}>
            Ask {agentName(agent)} about this task — what it needs, how the code
            around it works, whether the approach is right. Talking changes
            nothing. When you know what should happen,{" "}
            <strong>Have {agentName(agent)} do this</strong> starts a real run —
            right here through the Claude API, or in GitHub Actions — which opens
            a pull request. You do not have to talk to it first.
          </p>
        )}
        {msgs.map((m, i) => (
          <div className={"msg " + m.role} key={i}>
            <span className="from">
              {m.role === "user" ? "You" : m.role === "run" ? "Run" : agentName(agent)}
            </span>
            {m.thinking && !m.content && (
              <p className="thinking">{m.thinking}</p>
            )}
            {(m.content || !m.thinking) && (
              <p className="body">
                {m.role === "assistant" && m.content
                  ? rich(m.content)
                  : m.content || (busy && i === msgs.length - 1 ? "…" : "")}
              </p>
            )}
            {m.cost ? <span className="muted small">{`$${m.cost.toFixed(4)}`}</span> : null}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {err && <div className="error">{err}</div>}

      {/* Where the conversation becomes work. The chat cannot change anything;
          a run — through the Claude API or in GitHub Actions — can. */}
      <Dispatch
        owner={owner}
        name={name}
        issue={issue}
        agent={agent}
        suggested={lastAsked}
        me={me}
        onDispatched={(line) =>
          // Local only, and deliberately not written to chat_message: the
          // record of a run is the agent_run row and the pull request. This
          // line is a receipt for the person who pressed the button, not a
          // second copy of the truth.
          setMsgs((m) => [...m, { role: "run", content: line }])
        }
      />

      <form className="ask" onSubmit={send}>
        <textarea
          value={draft}
          disabled={busy}
          placeholder={`Ask ${agentName(agent)} about this task…`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter is a new line — the way every chat box
            // people already use behaves.
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(e as any); }
          }}
          rows={2}
        />
        <button className="go" disabled={busy || !draft.trim()}>{busy ? "…" : "Send"}</button>
      </form>

      <p className="muted small" style={{ margin: 0 }}>
        This conversation is yours alone — not on the issue, not visible to your
        lead or the CTO, and not a record of work. If something here matters, say
        it on the issue above.
      </p>
    </div>
  );
}
