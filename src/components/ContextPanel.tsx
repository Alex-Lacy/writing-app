import { useMemo } from 'react';
import { buildFor, contextLimitFor, currentChat, useStore } from '../store/store';

export function ContextPanel() {
  const chat = useStore((s) => currentChat(s));
  const messages = useStore((s) => s.messages);
  const last = useStore((s) => s.lastContext);
  const streaming = useStore((s) => !!s.streamingId);
  const limit = useStore((s) => contextLimitFor(currentChat(s), s));
  const preview = useMemo(() => (chat ? buildFor(chat, messages) : undefined), [chat, messages]);
  const ctx = streaming ? last : preview;
  if (!chat || !ctx) return null;
  const t = ctx.tokens;

  return (
    <div className="panel-body">
      <p className="muted small">
        {streaming ? 'Being sent now.' : 'What the next generation will send.'} Estimates: system+memory ~{t.top}, notes ~{t.blocks},
        history ~{t.history}, total ~{t.total} of {limit} (reply reserve {chat.params.maxTokens}).
        {ctx.droppedIds.length > 0 && <> <b>{ctx.droppedIds.length} older messages don't fit</b> and are left out.</>}
        {ctx.overflow && <> <b>The latest message alone exceeds the budget.</b></>}
      </p>
      {ctx.messages.map((m, i) => (
        <div key={i} className={`ctx-msg ctx-${m.role}`}>
          <div className="ctx-role">{m.role}</div>
          <pre>{typeof m.content === 'string' ? m.content : m.content.map((p) => (p.type === 'text' ? p.text : '[image]')).join('\n')}</pre>
        </div>
      ))}
    </div>
  );
}
