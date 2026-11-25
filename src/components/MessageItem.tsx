import { memo, useMemo, useState } from 'react';
import { renderMarkdown } from '../lib/markdown';
import {
  deleteFrom, deleteMessage, deleteSwipe, editMessage, modelLabel, regenerate, swipe, useStore,
} from '../store/store';
import { activeSwipe, type Message } from '../types';

interface Props {
  m: Message;
  isLast: boolean;
  outOfContext: boolean;
}

export const MessageItem = memo(function MessageItem({ m, isLast, outOfContext }: Props) {
  const streaming = useStore((s) => s.streamingId === m.id);
  const busy = useStore((s) => !!s.streamingId);
  const model = useStore((s) => s.models.find((x) => x.key === activeSwipe(m).modelKey));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [copied, setCopied] = useState(false);
  const sw = activeSwipe(m);
  const html = useMemo(() => renderMarkdown(sw.content), [sw.content]);

  const startEdit = () => {
    setDraft(sw.content);
    setEditing(true);
  };
  const saveEdit = async (andRegen = false) => {
    await editMessage(m.id, draft);
    setEditing(false);
    if (andRegen) await regenerate(m.id);
  };
  const copy = async () => {
    await navigator.clipboard.writeText(sw.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className={`msg msg-${m.role}${outOfContext ? ' msg-out' : ''}`}>
      <div className="msg-head">
        <span className="msg-role">{m.role === 'assistant' ? modelLabel(model) : m.role === 'user' ? 'You' : 'System'}</span>
        {outOfContext && <span className="badge" title="Older than what fits in the context window">out of context</span>}
        {m.swipes.length > 1 || (m.role === 'assistant' && isLast) ? (
          <span className="swipes">
            <button className="icon" disabled={busy || m.activeSwipe === 0} onClick={() => swipe(m.id, -1)} title="Previous version">‹</button>
            <span>{m.activeSwipe + 1}/{m.swipes.length}</span>
            <button
              className="icon"
              disabled={busy || (m.activeSwipe >= m.swipes.length - 1 && !(m.role === 'assistant' && isLast))}
              onClick={() => swipe(m.id, 1)}
              title={m.activeSwipe >= m.swipes.length - 1 ? 'Generate another version' : 'Next version'}
            >›</button>
          </span>
        ) : null}
      </div>

      {sw.reasoning && (
        <details className="reasoning" open={streaming && !sw.content}>
          <summary>{streaming && !sw.content ? 'Thinking…' : 'Reasoning'}</summary>
          <div className="reasoning-body">{sw.reasoning}</div>
        </details>
      )}

      {editing ? (
        <div className="edit">
          <textarea autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} rows={Math.min(20, draft.split('\n').length + 2)} />
          <div className="row">
            <button onClick={() => saveEdit()}>Save</button>
            {m.role === 'user' && <button onClick={() => saveEdit(true)} disabled={busy}>Save &amp; regenerate</button>}
            <button className="ghost" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="msg-body markdown" dangerouslySetInnerHTML={{ __html: html || (streaming && !sw.reasoning ? '<span class="cursor">▍</span>' : '') }} />
      )}

      {sw.error && <div className="msg-error">⚠ {sw.error}</div>}
      {sw.finishReason === 'length' && <div className="msg-note">Stopped at the max-tokens limit.</div>}

      {!editing && !streaming && (
        <div className="msg-actions">
          <button className="ghost" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
          <button className="ghost" onClick={startEdit} disabled={busy}>Edit</button>
          <button className="ghost" onClick={() => regenerate(m.id)} disabled={busy} title={m.role === 'assistant' ? 'New version of this reply' : 'Regenerate the reply to this'}>Retry</button>
          {m.swipes.length > 1 && <button className="ghost" onClick={() => deleteSwipe(m.id)} disabled={busy}>Delete version</button>}
          <button className="ghost" onClick={() => deleteMessage(m.id)} disabled={busy}>Delete</button>
          {!isLast && (
            <button className="ghost danger" disabled={busy} onClick={() => confirm('Delete this message and everything after it?') && deleteFrom(m.id)}>
              Delete to end
            </button>
          )}
        </div>
      )}
    </div>
  );
});
