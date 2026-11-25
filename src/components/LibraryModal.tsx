import { useState } from 'react';
import { runJob } from '../ai/jobs';
import { estimateTokens } from '../context/tokens';
import { BUILTIN_HELPERS } from '../features/starters';
import { helpersList } from '../features/helper';
import { uid } from '../lib/id';
import { deleteSharedBook, newSharedBook, putBook } from '../store/codexStore';
import { currentChat, saveSettings, ui, useStore } from '../store/store';
import type { CodexBook, HelperDef, StyleModule } from '../types';
import { CodexEditor } from './panel/CodexEditor';

type Tab = 'codex' | 'styles' | 'notes' | 'helpers';

/** Things shared across stories: Codex books, Style modules, Global notes, Helpers. */
export function LibraryModal() {
  const [tab, setTab] = useState<Tab>('codex');
  const close = () => ui.openLibrary(false);
  return (
    <div className="modal-scrim" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>Library</h2>
          <button className="icon" onClick={close}>✕</button>
        </header>
        <div className="tabs">
          {([['codex', 'Codex books'], ['styles', 'Style modules'], ['notes', 'Global notes'], ['helpers', 'Helpers']] as [Tab, string][]).map(([t, l]) => (
            <button key={t} className={tab === t ? 'tab active' : 'tab'} onClick={() => setTab(t)}>{l}</button>
          ))}
        </div>
        <div className="modal-body">
          {tab === 'codex' && <Books />}
          {tab === 'styles' && <Styles />}
          {tab === 'notes' && <Notes />}
          {tab === 'helpers' && <Helpers />}
        </div>
      </div>
    </div>
  );
}

function Books() {
  const allBooks = useStore((s) => s.codex);
  const books = allBooks.filter((b) => !b.chatId);
  const chats = useStore((s) => s.chats);
  const [open, setOpen] = useState<string>();
  const [q, setQ] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const shown = books.filter((b) => (showArchived || !b.archived) && (!q || `${b.name} ${b.series ?? ''}`.toLowerCase().includes(q.toLowerCase())));
  const groups = new Map<string, CodexBook[]>();
  for (const b of shown.sort((a, b) => a.name.localeCompare(b.name))) groups.set(b.series || 'No series', [...(groups.get(b.series || 'No series') ?? []), b]);

  return (
    <>
      <p className="muted small">
        Shared Codex books can be attached to several stories, for a world or cast you reuse. Each story also has its own
        Codex (in its Story panel), which never shows up here.
      </p>
      <div className="row">
        <input placeholder="Search books" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="switch small"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived</label>
        <span className="spacer" />
        <button className="small" onClick={async () => { const n = prompt('Name for the new shared Codex book:'); if (n) setOpen((await newSharedBook(n)).id); }}>+ New book</button>
      </div>
      {books.length === 0 && <p className="muted">No shared books yet.</p>}
      {[...groups].map(([series, list]) => (
        <section key={series}>
          <h3>{series}</h3>
          {list.map((b) => {
            const users = chats.filter((c) => c.sharedCodexIds?.includes(b.id));
            return (
              <div key={b.id} className={`lib-item${b.archived ? ' off' : ''}`}>
                <div className="row" onClick={() => setOpen(open === b.id ? undefined : b.id)}>
                  <b className="grow">{b.name}</b>
                  <span className="muted small">{b.entries.length} entries · {users.length ? `used by ${users.map((c) => `#${c.num}`).join(', ')}` : 'not used'}</span>
                </div>
                {open === b.id && (
                  <>
                    <div className="row">
                      <button className="small ghost" onClick={() => { const n = prompt('Rename book:', b.name); if (n) void putBook({ ...b, name: n }); }}>Rename</button>
                      <button className="small ghost" onClick={() => { const n = prompt('Series or world (leave empty for none):', b.series ?? ''); if (n !== null) void putBook({ ...b, series: n.trim() || undefined }); }}>Set series</button>
                      <button className="small ghost" onClick={() => putBook({ ...b, archived: !b.archived })}>{b.archived ? 'Unarchive' : 'Archive'}</button>
                      <button className="small ghost" onClick={() => confirm(`Delete "${b.name}"? Stories using it will lose these entries.`) && deleteSharedBook(b.id)}>Delete</button>
                    </div>
                    <CodexEditor book={b} />
                  </>
                )}
              </div>
            );
          })}
        </section>
      ))}
    </>
  );
}

function Styles() {
  const styles = useStore((s) => s.settings.styles) ?? [];
  const chat = useStore((s) => currentChat(s));
  const [open, setOpen] = useState<string>();
  const [draft, setDraft] = useState<StyleModule>();
  const [condensed, setCondensed] = useState<{ id: string; text: string }>();
  const [busy, setBusy] = useState(false);
  const save = (list: StyleModule[]) => saveSettings({ styles: list });
  const edit = (m: StyleModule) => { setOpen(m.id); setDraft(m); setCondensed(undefined); };

  const condense = async (m: StyleModule) => {
    setBusy(true);
    try {
      const res = await runJob({
        job: 'helper', chat, label: 'Condensing a Style module', maxTokens: 2500, temperature: 0.3,
        messages: [
          { role: 'system', content: 'You condense writing-style instructions for an AI fiction writer. Keep every rule and example that changes how it writes; cut repetition, explanation and filler. Keep the original voice and any word lists that matter. Output only the condensed instructions.' },
          { role: 'user', content: m.text },
        ],
      });
      setCondensed({ id: m.id, text: res.text });
    } catch (e) {
      useStore.setState({ error: `Condense failed: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p className="muted small">
        Reusable instructions about <i>how</i> to write: voice, vocabulary, typography, pacing. Switch them on per story in
        its Setup tab; they're sent right after Background. The Style editor Helper can write, split or condense them for you.
      </p>
      <button className="small" onClick={() => { const m = { id: uid(), name: 'New module', text: '' }; void save([...styles, m]); edit(m); }}>+ New module</button>
      {styles.map((m) => (
        <div key={m.id} className="lib-item">
          <div className="row" onClick={() => (open === m.id ? setOpen(undefined) : edit(m))}>
            <b className="grow">{m.name}</b>
            {m.defaultOn && <span className="chip">on in new stories</span>}
            <span className="muted small">~{estimateTokens(m.text)} tokens</span>
          </div>
          {open === m.id && draft && (
            <>
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              <textarea rows={10} value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
              <label className="switch small"><input type="checkbox" checked={!!draft.defaultOn} onChange={(e) => setDraft({ ...draft, defaultOn: e.target.checked })} /> Switch on in new stories</label>
              <div className="row">
                <button className="small primary" onClick={() => { void save(styles.map((x) => (x.id === m.id ? draft : x))); setOpen(undefined); }}>Save</button>
                <button className="small ghost" disabled={busy || !draft.text.trim()} onClick={() => condense(draft)}>{busy ? 'Condensing…' : 'Condense with AI'}</button>
                <span className="spacer" />
                <button className="small ghost" onClick={() => { if (confirm(`Delete "${m.name}"?`)) { void save(styles.filter((x) => x.id !== m.id)); setOpen(undefined); } }}>Delete</button>
              </div>
              {condensed?.id === m.id && (
                <div className="sg-card">
                  <div className="sg-head"><b>Condensed version</b><span className="muted small">~{estimateTokens(condensed.text)} tokens, was ~{estimateTokens(draft.text)}</span></div>
                  <div className="sg-after">{condensed.text}</div>
                  <div className="row">
                    <button className="small primary" onClick={() => { setDraft({ ...draft, text: condensed.text }); setCondensed(undefined); }}>Use this (then Save)</button>
                    <button className="small ghost" onClick={() => setCondensed(undefined)}>Discard</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      ))}
      <button className="small ghost" onClick={() => { close(); if (chat) ui.openHelper('helper-style'); }} hidden={!chat}>Ask the Style editor Helper</button>
    </>
  );
  function close() { ui.openLibrary(false); }
}

function Notes() {
  const notes = useStore((s) => s.settings.globalNotes ?? '');
  const [text, setText] = useState(notes);
  return (
    <>
      <p className="muted small">
        Short notes for every story, such as “British spelling” or “never write for my character”. Sent at the top, after
        the system prompt. Each story can switch them off in its Setup tab.
      </p>
      <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} onBlur={() => saveSettings({ globalNotes: text })} placeholder="Notes for every story…" />
      <p className="muted small">~{estimateTokens(text)} tokens · saved when you click away</p>
    </>
  );
}

function Helpers() {
  const list = helpersList();
  const mine = useStore((s) => s.settings.helpers) ?? [];
  const [open, setOpen] = useState<string>();
  const [draft, setDraft] = useState<HelperDef>();
  const save = (h: HelperDef) => saveSettings({ helpers: [...mine.filter((x) => x.id !== h.id), h] });
  const builtIn = (id: string) => BUILTIN_HELPERS.find((b) => b.id === id);
  return (
    <>
      <p className="muted small">Helpers set up and tune stories for you. You can edit their instructions or add your own.</p>
      <button className="small" onClick={() => { const h = { id: uid(), name: 'My helper', blurb: '', instructions: '' }; setOpen(h.id); setDraft(h); }}>+ New helper</button>
      {[...list, ...(draft && !list.some((h) => h.id === draft.id) ? [draft] : [])].map((h) => (
        <div key={h.id} className="lib-item">
          <div className="row" onClick={() => { setOpen(open === h.id ? undefined : h.id); setDraft(h); }}>
            <b className="grow">{h.name}</b>
            <span className="muted small">{h.blurb}</span>
          </div>
          {open === h.id && draft && (
            <>
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              <input value={draft.blurb} placeholder="One line on what it's for" onChange={(e) => setDraft({ ...draft, blurb: e.target.value })} />
              <textarea rows={12} value={draft.instructions} onChange={(e) => setDraft({ ...draft, instructions: e.target.value })} />
              <div className="row">
                <button className="small primary" onClick={() => { void save(draft); setOpen(undefined); }}>Save</button>
                {builtIn(h.id) && mine.some((x) => x.id === h.id) && <button className="small ghost" onClick={() => saveSettings({ helpers: mine.filter((x) => x.id !== h.id) })}>Reset to built-in</button>}
                {!builtIn(h.id) && <button className="small ghost" onClick={() => saveSettings({ helpers: mine.filter((x) => x.id !== h.id) })}>Delete</button>}
              </div>
            </>
          )}
        </div>
      ))}
    </>
  );
}
