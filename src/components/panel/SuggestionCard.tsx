import { useState } from 'react';
import { accept, reject, undo } from '../../store/suggestions';
import { useStore } from '../../store/store';
import type { Suggestion } from '../../types';

const SOURCE: Record<Suggestion['source'], string> = {
  helper: 'Helper',
  updates: 'Suggested update',
  summary: 'Auto-summary',
  proofread: 'Proofread',
  rewrite: 'Rewrite',
  filter: 'Cliché Filter',
};

function title(x: Suggestion, bookName: (id: string) => string): string {
  const t = x.target;
  switch (t.kind) {
    case 'system': return 'System prompt';
    case 'title': return 'Story title';
    case 'background': return 'Background';
    case 'steering': return 'Steering';
    case 'length': return `Length: ${t.value}`;
    case 'codex-add': return `New Codex entry: ${t.entry.name}`;
    case 'codex-edit': return `Update Codex entry: ${t.entry.name}`;
    case 'codex-remove': return `Remove Codex entry${bookName(t.bookId) ? ` from ${bookName(t.bookId)}` : ''}`;
    case 'summary': return t.replaces?.length ? (t.part.merged ? 'Merged summary' : 'Refreshed summary part') : 'Summary of older story';
    case 'passage': return x.source === 'proofread' ? 'Correction' : x.source === 'filter' ? 'Cliché fix' : 'Rewrite';
    case 'style-add': return `New Style module: ${t.module.name}`;
    case 'style-edit': return `Update Style module: ${t.name}`;
    case 'tags': return 'Story tags';
    case 'style-toggle': return `${t.on ? 'Turn on' : 'Turn off'} Style module: ${t.name}`;
  }
}

/** One proposed change: before and after, with Accept, Edit and Reject (or Undo once accepted). */
export function SuggestionCard({ x }: { x: Suggestion }) {
  const books = useStore((s) => s.codex);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(x.after);
  const bookName = (id: string) => books.find((b) => b.id === id)?.name ?? '';
  const t = x.target;
  const keys = t.kind === 'codex-add' || t.kind === 'codex-edit' ? t.entry.keys : undefined;
  return (
    <div className={`sg-card sg-${x.status}`}>
      <div className="sg-head">
        <b>{title(x, bookName)}</b>
        <span className="chip">{SOURCE[x.source]}</span>
      </div>
      {x.reason && <p className="muted small">{x.reason}</p>}
      {keys && keys.length > 0 && <p className="muted small">Triggers: {keys.join(', ')}</p>}
      {x.before && t.kind !== 'summary' && <div className="sg-before">{x.before}</div>}
      {t.kind !== 'codex-remove' && t.kind !== 'style-toggle' && (editing ? (
        <textarea rows={Math.min(12, Math.max(3, Math.ceil(text.length / 45)))} value={text} onChange={(e) => setText(e.target.value)} />
      ) : (
        <div className="sg-after">{x.after}</div>
      ))}
      <div className="row">
        {x.status === 'pending' && (
          <>
            <button className="small primary" onClick={() => accept(x.id, editing ? text : undefined)}>{editing ? 'Save and accept' : 'Accept'}</button>
            {t.kind !== 'codex-remove' && t.kind !== 'style-toggle' && !editing && <button className="small ghost" onClick={() => setEditing(true)}>Edit</button>}
            <button className="small ghost" onClick={() => reject(x.id)}>Reject</button>
          </>
        )}
        {x.status === 'accepted' && (
          <>
            <span className="muted small">Accepted</span>
            <button className="small ghost" onClick={() => undo(x.id)}>Undo</button>
          </>
        )}
        {x.status === 'rejected' && <span className={x.failed ? 'msg-error small' : 'muted small'}>{x.failed ?? 'Rejected'}</span>}
      </div>
    </div>
  );
}
