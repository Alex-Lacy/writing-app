import { useState } from 'react';
import { estimateTokens } from '../../context/tokens';
import { newEntry, removeEntry, upsertEntry } from '../../store/codexStore';
import type { CodexBook, CodexEntry } from '../../types';

function EntryEditor({ bookId, e, onDone }: { bookId: string; e: CodexEntry; onDone: () => void }) {
  const [d, setD] = useState(e);
  const [keys, setKeys] = useState(e.keys.join(', '));
  const save = () => {
    void upsertEntry(bookId, { ...d, name: d.name.trim() || 'Untitled', keys: keys.split(',').map((k) => k.trim()).filter(Boolean) });
    onDone();
  };
  return (
    <div className="cx-entry-edit">
      <input value={d.name} onChange={(x) => setD({ ...d, name: x.target.value })} placeholder="Name (e.g. Mara Voss)" />
      <input value={keys} onChange={(x) => setKeys(x.target.value)} placeholder="Trigger words, separated by commas (e.g. Mara, Voss, the detective)" />
      <textarea rows={5} value={d.text} onChange={(x) => setD({ ...d, text: x.target.value })} placeholder="What the model should know when this comes up." />
      <div className="row">
        <label className="switch small" title="Send this entry every time, whether or not its trigger words appear"><input type="checkbox" checked={!!d.alwaysOn} onChange={(x) => setD({ ...d, alwaysOn: x.target.checked })} /> Always on</label>
        <label className="field num small" title="When too many entries match, higher priority ones are kept">
          <span>Priority</span>
          <input type="number" step={1} value={d.priority ?? 0} onChange={(x) => setD({ ...d, priority: Number(x.target.value) || 0 })} />
        </label>
      </div>
      <p className="muted small">A trigger word written as /pattern/ is a regular expression.</p>
      <div className="row">
        <button className="small primary" onClick={save}>Save</button>
        <button className="small ghost" onClick={onDone}>Cancel</button>
        <span className="spacer" />
        <button className="small ghost" onClick={() => { if (confirm(`Delete "${e.name}"?`)) { void removeEntry(bookId, e.id); onDone(); } }}>Delete</button>
      </div>
    </div>
  );
}

/** List and edit the entries of one Codex book. */
export function CodexEditor({ book, onAdd }: { book?: CodexBook; onAdd?: () => Promise<CodexBook> }) {
  const [open, setOpen] = useState<string>();
  const [q, setQ] = useState('');
  const entries = book?.entries ?? [];
  const shown = q ? entries.filter((e) => `${e.name} ${e.keys.join(' ')} ${e.text}`.toLowerCase().includes(q.toLowerCase())) : entries;
  const add = async () => {
    const b = book ?? (await onAdd?.());
    if (!b) return;
    const e = newEntry();
    await upsertEntry(b.id, e);
    setOpen(e.id);
  };
  return (
    <div className="cx-book">
      {entries.length > 8 && <input placeholder="Search entries" value={q} onChange={(e) => setQ(e.target.value)} />}
      {shown.map((e) =>
        open === e.id && book ? (
          <EntryEditor key={e.id} bookId={book.id} e={e} onDone={() => setOpen(undefined)} />
        ) : (
          <div key={e.id} className={`cx-entry${e.enabled ? '' : ' off'}`} onClick={() => setOpen(e.id)}>
            <div className="row">
              <b className="grow">{e.name}</b>
              {e.alwaysOn && <span className="chip">always on</span>}
              <span className="muted tiny">~{estimateTokens(e.text)} tokens</span>
              <input
                type="checkbox" title="Use this entry" checked={e.enabled}
                onClick={(x) => x.stopPropagation()}
                onChange={(x) => book && upsertEntry(book.id, { ...e, enabled: x.target.checked })}
              />
            </div>
            <div className="muted small">{e.keys.length ? e.keys.join(', ') : 'No trigger words'}</div>
          </div>
        ),
      )}
      <button className="small ghost" onClick={add}>+ Add entry</button>
    </div>
  );
}
