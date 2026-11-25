import { useMemo, useState } from 'react';
import type { Part } from '../context/build';
import { buildFor, contextLimitFor, currentChat, replyReserve, sendMaxTokens, ui, useStore } from '../store/store';

// How each message is sent. The legend and chips name the content; this names the role.
const ROLE_LABEL = { system: 'sent as system instructions', user: 'sent as your turn', assistant: 'sent as the AI\'s turn' } as const;

function PartView({ p }: { p: Part }) {
  const [open, setOpen] = useState(false);
  const long = p.text.length > 700;
  return (
    <div className={`cx-part src-${p.source}`}>
      <div className="cx-part-head">
        <span className="cx-chip">{p.label}</span>
        <span className="muted tiny">~{p.tokens.toLocaleString()} tokens</span>
      </div>
      <pre>{long && !open ? p.text.slice(0, 700) + '…' : p.text}</pre>
      {long && <button className="ghost small" onClick={() => setOpen(!open)}>{open ? 'Show less' : 'Show all'}</button>}
    </div>
  );
}

/** Full-screen view of exactly what the next request sends, in order, colour-coded by source. */
export function ContextModal() {
  const chat = useStore((s) => currentChat(s));
  const messages = useStore((s) => s.messages);
  const last = useStore((s) => s.lastContext);
  const streaming = useStore((s) => !!s.streamingId);
  const limit = useStore((s) => contextLimitFor(currentChat(s), s));
  const margin = useStore((s) => s.settings.safetyMargin);
  const preview = useMemo(() => (chat ? buildFor(chat, messages) : undefined), [chat, messages]);
  const ctx = streaming ? last : preview;
  const [copied, setCopied] = useState(false);
  if (!chat || !ctx) return null;

  const room = replyReserve(chat);
  const maxReply = sendMaxTokens(chat, ctx);
  const used = ctx.totals.reduce((n, t) => n + t.tokens, 0);
  const free = Math.max(0, limit - used - room - margin);
  const seg = (n: number) => `${Math.max(0.4, (n / limit) * 100)}%`;
  const close = () => ui.openContext(false);

  return (
    <div className="modal-scrim" onClick={close}>
      <div className="modal cx-modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>Context {streaming ? 'being sent now' : 'for the next reply'}</h2>
          <button className="icon" onClick={close}>✕</button>
        </header>
        <div className="modal-body">
          <div className="cx-bar" title="Your context window">
            {ctx.totals.map((t) => <div key={t.source} className={`src-${t.source}`} style={{ width: seg(t.tokens) }} />)}
            <div className="cx-reply" style={{ width: seg(room) }} />
          </div>
          <table className="cx-legend">
            <tbody>
              {ctx.totals.map((t) => (
                <tr key={t.source}>
                  <td><span className={`cx-swatch src-${t.source}`} /></td>
                  <td>{t.label}{t.count > 1 ? ` × ${t.count}` : ''}</td>
                  <td className="num">~{t.tokens.toLocaleString()}</td>
                </tr>
              ))}
              <tr>
                <td><span className="cx-swatch cx-reply" /></td>
                <td>Kept free for the reply <span className="muted small">(set by Length{room > 4000 ? ' and thinking' : ''})</span></td>
                <td className="num">{room.toLocaleString()}</td>
              </tr>
              <tr className="muted">
                <td />
                <td>Unused</td>
                <td className="num">{free.toLocaleString()}</td>
              </tr>
              <tr className="cx-total">
                <td />
                <td>Context window</td>
                <td className="num">{limit.toLocaleString()}</td>
              </tr>
            </tbody>
          </table>
          <p className="muted small">
            Token counts are estimates. The reply may use up to ~{maxReply.toLocaleString()} tokens, thinking included
            {chat.params.hardCap ? ` (your hard cap is ${chat.params.hardCap.toLocaleString()})` : ''}.
            {ctx.droppedIds.length > 0 && <> <b>{ctx.droppedIds.length} older message{ctx.droppedIds.length > 1 ? 's' : ''} didn't fit and {ctx.droppedIds.length > 1 ? 'are' : 'is'} left out.</b></>}
            {ctx.overflow && <> <b>The latest message alone is bigger than the space available.</b></>}
          </p>

          <div className="row">
            <h3 className="grow">Sent in this order</h3>
            <button className="ghost small" onClick={async () => { await navigator.clipboard.writeText(JSON.stringify(ctx.messages, null, 2)); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>
              {copied ? 'Copied' : 'Copy raw messages'}
            </button>
          </div>
          {ctx.annotated.map((m, i) => (
            <div key={i} className={`cx-msg role-${m.role}`}>
              <div className="cx-msg-head">
                <b>Message {i + 1}</b>
                <span className="muted tiny">{ROLE_LABEL[m.role]}</span>
              </div>
              {m.parts.map((p, j) => <PartView key={j} p={p} />)}
            </div>
          ))}
          <p className="muted small">
            Some models (DeepSeek, for one) move every message sent as system instructions to the very top of the prompt, whatever its
            position here. That is why the Author's Note and Length go inside your message by default.
          </p>
        </div>
      </div>
    </div>
  );
}
