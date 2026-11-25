import { useState } from 'react';
import { CODEX_SCAN, CODEX_SHARE } from '../../context/codex';
import { makeReusable, ownBook, setAttached } from '../../store/codexStore';
import { currentChat, ui, useStore } from '../../store/store';
import { CodexEditor } from './CodexEditor';

export function CodexTab() {
  const chat = useStore((s) => currentChat(s));
  const books = useStore((s) => s.codex);
  const [pick, setPick] = useState('');
  if (!chat) return null;
  const own = books.find((b) => b.id === chat.codexId);
  const attached = books.filter((b) => chat.sharedCodexIds?.includes(b.id));
  const library = books.filter((b) => !b.chatId && !b.archived && !chat.sharedCodexIds?.includes(b.id));

  return (
    <div className="panel-body">
      <p className="muted small">
        Entries for characters, places, items and rules. An entry is sent only when one of its trigger words appears in
        the last {CODEX_SCAN} messages (or always, if you switch that on), so a big Codex costs nothing until it's
        needed. It uses at most {Math.round(CODEX_SHARE * 100)}% of the context.
      </p>
      <section>
        <h3>This story</h3>
        <CodexEditor book={own} onAdd={() => ownBook(chat)} />
        {own && own.entries.length > 0 && (
          <button className="small ghost" title="Move these entries into a shared book in the Library, so other stories can use them too" onClick={() => {
            const name = prompt('Name for the shared Codex book (e.g. the world or series):', chat.title);
            if (name) void makeReusable(chat, name);
          }}>Make reusable…</button>
        )}
      </section>

      {attached.map((b) => (
        <section key={b.id}>
          <div className="row">
            <h3 className="grow">{b.name} {b.series && <span className="muted small">· {b.series}</span>}</h3>
            <button className="small ghost" title="Stop using this shared book in this story (it stays in the Library)" onClick={() => setAttached(chat, b.id, false)}>Detach</button>
          </div>
          <p className="muted small">Shared from the Library: changes here apply to every story that uses it.</p>
          <CodexEditor book={b} />
        </section>
      ))}

      <section>
        <h3>Shared books</h3>
        {library.length ? (
          <div className="row">
            <select value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Attach a book from the Library…</option>
              {library.map((b) => <option key={b.id} value={b.id}>{b.series ? `${b.series}: ` : ''}{b.name}</option>)}
            </select>
            <button className="small" disabled={!pick} onClick={() => { void setAttached(chat, pick, true); setPick(''); }}>Attach</button>
          </div>
        ) : <p className="muted small">No shared books yet. Once this story has entries, “Make reusable” turns them into one; or create one in the Library.</p>}
        <button className="small ghost" onClick={() => ui.openLibrary(true)}>Open the Library</button>
      </section>
    </div>
  );
}
