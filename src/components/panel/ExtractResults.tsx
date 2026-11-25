import { useEffect, useState } from 'react';
import { addExtracted, closeExtract, stopExtract, useExtract } from '../../features/extract';
import type { Chat } from '../../types';

const PHASE: Record<string, string> = { sent: 'waiting for the model', busy: 'the model is busy, waiting', thinking: 'thinking', writing: 'writing entries' };

/** Entries the Helper found in a file or pasted text: one line each, open to read, Add or Add all. */
export function ExtractResults({ chat }: { chat: Chat }) {
  const run = useExtract((s) => s.run);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!run?.running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [run?.running]);
  if (!run || run.chatId !== chat.id) return null;

  const p = run.progress;
  const left = run.found.filter((f) => !run.added.includes(f.entry.id));
  const secs = Math.max(0, Math.round((now - run.startedAt) / 1000));
  return (
    <div className="card extract">
      <p className="small"><b>{run.source}</b>{p && ` · ${p.parts} part${p.parts === 1 ? '' : 's'}`} · {run.found.length} found</p>
      {run.running && (
        <>
          <div className="meter-bar"><div style={{ width: `${p ? ((p.part - (p.phase ? 1 : 0)) / p.parts) * 100 : 0}%` }} /></div>
          <p className="muted small">
            <span className="spinner" /> Reading part {p?.part ?? 1} of {p?.parts ?? '…'}{p?.phase && `, ${PHASE[p.phase]}`} · {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}{' '}
            <button className="small" onClick={stopExtract}>Stop</button>
          </p>
        </>
      )}
      {run.note && <p className="muted small">{run.note}</p>}
      {run.found.length > 0 && (
        <div className="lore-list">
          {run.found.map((f) => {
            const added = run.added.includes(f.entry.id);
            return (
              <div key={f.entry.id} className="extract-row">
                <details>
                  <summary>
                    <b>{f.entry.name}</b> <span className="muted small">{f.category}</span>
                    {f.existing && <span className="tag-dupe"> adds to your entry</span>}
                  </summary>
                  <p className="muted small">Trigger words: {f.entry.keys.join(', ') || 'none'}</p>
                  <p className="small pre">{f.entry.text}</p>
                </details>
                {added ? <span className="muted small">Added ✓</span> : <button className="small" disabled={run.running} onClick={() => void addExtracted([f.entry.id])}>Add</button>}
              </div>
            );
          })}
        </div>
      )}
      <div className="row">
        {left.length > 1 && <button className="small primary" disabled={run.running} onClick={() => void addExtracted(left.map((f) => f.entry.id))}>Add all {left.length}</button>}
        {run.running && run.found.length > 0 && <span className="muted small">You can add entries once it has read everything, or after Stop.</span>}
        {!run.running && <button className="small ghost" onClick={closeExtract}>Close</button>}
      </div>
    </div>
  );
}
