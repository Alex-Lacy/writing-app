import { useMemo, useRef, useState } from 'react';
import { importEntries, parseLorebook, sameName, tidyEntries, type DuplicateMode, type ParsedLorebook } from '../../features/lorebook';
import { ui, useStore } from '../../store/store';
import type { Chat, CodexEntry } from '../../types';

/** Codex → Import: read a NovelAI or SillyTavern lorebook, pick entries, import. No AI involved. */
export function LorebookImport({ chat }: { chat: Chat }) {
  const books = useStore((s) => s.codex);
  const file = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedLorebook & { fileName: string }>();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [to, setTo] = useState<'story' | 'book'>('story');
  const [bookName, setBookName] = useState('');
  const [dupes, setDupes] = useState<DuplicateMode>('skip');
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ text: string; entries: CodexEntry[] }>();
  const [tidy, setTidy] = useState<{ note: string; running: boolean }>();
  const stopTidy = useRef<AbortController>(undefined);

  const own = books.find((b) => b.id === chat.codexId);
  const groups = useMemo(() => {
    const m = new Map<string, ParsedLorebook['entries']>();
    for (const x of parsed?.entries ?? []) m.set(x.category, [...(m.get(x.category) ?? []), x]);
    return [...m];
  }, [parsed]);
  const isDupe = (e: CodexEntry) => to === 'story' && !!own?.entries.some((x) => sameName(x.name, e.name));
  const chosen = parsed?.entries.filter((x) => picked.has(x.entry.id)) ?? [];
  const dupeCount = chosen.filter((x) => isDupe(x.entry)).length;

  const open = async (f?: File) => {
    if (!f) return;
    setError('');
    setDone(undefined);
    setTidy(undefined);
    try {
      const p = parseLorebook(await f.text());
      if (!p.entries.length) throw new Error('This lorebook has no entries.');
      const name = f.name.replace(/\.(lorebook|scenario|json)$/i, '');
      setParsed({ ...p, fileName: name });
      setBookName(name);
      setPicked(new Set(p.entries.filter((x) => !x.off && x.entry.text).map((x) => x.entry.id)));
    } catch (e) {
      setParsed(undefined);
      setError((e as Error).message);
    }
    if (file.current) file.current.value = '';
  };

  const toggle = (ids: string[], on: boolean) => {
    const next = new Set(picked);
    for (const id of ids) if (on) next.add(id); else next.delete(id);
    setPicked(next);
  };

  const run = async () => {
    const entries = chosen.map((x) => x.entry);
    const r = await importEntries(chat, entries, to === 'story' ? 'story' : { newBook: bookName.trim() || parsed!.fileName }, dupes);
    const parts = [`${r.added} added`, r.replaced && `${r.replaced} replaced`, r.skipped && `${r.skipped} skipped as duplicates`].filter(Boolean);
    const kept = r.book.entries.filter((e) => entries.some((x) => sameName(x.name, e.name)));
    setDone({ text: `Imported: ${parts.join(', ')}.`, entries: kept });
    setParsed(undefined);
  };

  const runTidy = async () => {
    if (!done) return;
    stopTidy.current = new AbortController();
    setTidy({ note: 'Starting…', running: true });
    try {
      const n = await tidyEntries(chat.id, done.entries, (d, t, c) => setTidy({ note: `Checked ${d} of ${t} · ${c} suggestion${c === 1 ? '' : 's'} so far`, running: d < t }), stopTidy.current.signal);
      setTidy({ note: n ? `Done: ${n} suggested clean-up${n === 1 ? '' : 's'}, waiting in Suggestions.` : 'Done: nothing needed tidying.', running: false });
    } catch (e) {
      setTidy({ note: (e as Error).name === 'AbortError' ? 'Stopped. Suggestions so far are in Suggestions.' : (e as Error).message, running: false });
    }
  };

  return (
    <section className="lore-import">
      <div className="row">
        <button className="small" onClick={() => file.current?.click()} title="NovelAI .lorebook or .scenario, SillyTavern world info, or a character card's lorebook (JSON)">Import lorebook…</button>
        <input ref={file} type="file" accept=".lorebook,.scenario,.json,application/json" hidden onChange={(e) => void open(e.target.files?.[0])} />
      </div>
      {error && <p className="error small">{error}</p>}

      {parsed && (
        <div className="card">
          <p className="small"><b>{parsed.fileName}</b> · {parsed.format} · {parsed.entries.length} entries. Untick any you don't want; entries switched off in the file start unticked.</p>
          <div className="lore-list">
            {groups.map(([cat, xs]) => {
              const ids = xs.map((x) => x.entry.id);
              const all = ids.every((id) => picked.has(id));
              return (
                <div key={cat}>
                  {groups.length > 1 && (
                    <label className="lore-cat"><input type="checkbox" checked={all} onChange={(e) => toggle(ids, e.target.checked)} /> <b>{cat}</b> <span className="muted small">({xs.length})</span></label>
                  )}
                  {xs.map((x) => (
                    <label key={x.entry.id} className="lore-entry">
                      <input type="checkbox" checked={picked.has(x.entry.id)} onChange={(e) => toggle([x.entry.id], e.target.checked)} />
                      <span>
                        <b>{x.entry.name}</b>
                        {isDupe(x.entry) && <span className="tag-dupe"> already in Codex</span>}
                        {x.entry.alwaysOn && <span className="muted small"> · always on</span>}
                        <span className="muted small"> · {x.entry.keys.length ? x.entry.keys.slice(0, 5).join(', ') : 'no trigger words'}</span>
                        <span className="lore-text muted small">{x.entry.text.slice(0, 140) || '(empty)'}{x.entry.text.length > 140 ? '…' : ''}</span>
                      </span>
                    </label>
                  ))}
                </div>
              );
            })}
          </div>
          <div className="grid2">
            <label className="field" title="A shared book lives in the Library and can be used by other stories too"><span>Import into</span>
              <select value={to} onChange={(e) => setTo(e.target.value as 'story' | 'book')}>
                <option value="story">This story</option>
                <option value="book">New shared book</option>
              </select>
            </label>
            {to === 'book' ? (
              <label className="field"><span>Book name</span><input value={bookName} onChange={(e) => setBookName(e.target.value)} /></label>
            ) : dupeCount > 0 ? (
              <label className="field"><span>{dupeCount} with the same name as an entry you have</span>
                <select value={dupes} onChange={(e) => setDupes(e.target.value as DuplicateMode)}>
                  <option value="skip">Keep mine, skip these</option>
                  <option value="replace">Replace mine with these</option>
                  <option value="both">Keep both</option>
                </select>
              </label>
            ) : <span />}
          </div>
          <div className="row">
            <button className="primary" disabled={!chosen.length} onClick={() => void run()}>Import {chosen.length} entr{chosen.length === 1 ? 'y' : 'ies'}</button>
            <button className="ghost" onClick={() => setParsed(undefined)}>Cancel</button>
          </div>
        </div>
      )}

      {done && (
        <div className="card">
          <p className="small">{done.text}</p>
          {done.entries.length > 0 && (
            <>
              <p className="muted small">Optional: have the quick model look over them, a few at a time, for leftover formatting from the other app and weak trigger words. Its changes come as cards you accept or reject.</p>
              <div className="row">
                {!tidy?.running && <button className="small" onClick={() => void runTidy()}>Tidy with Helper</button>}
                {tidy?.running && <button className="small" onClick={() => stopTidy.current?.abort()}>Stop</button>}
                {tidy && !tidy.running && <button className="small ghost" onClick={() => ui.openPanel('suggestions')}>Open Suggestions</button>}
                <button className="small ghost" onClick={() => { setDone(undefined); setTidy(undefined); }}>Close</button>
              </div>
              {tidy && <p className="muted small">{tidy.running && <span className="spinner" />} {tidy.note}</p>}
            </>
          )}
        </div>
      )}
    </section>
  );
}
