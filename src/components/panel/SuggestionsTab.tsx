import { useState } from 'react';
import { checkForUpdates } from '../../features/updates';
import { currentChat, DEFAULT_UPDATES_EVERY, saveSettings, updateChat, useStore } from '../../store/store';
import { acceptAll } from '../../store/suggestions';
import { SuggestionCard } from './SuggestionCard';

const UPDATE_OPTIONS: [number, string][] = [
  [0, 'Off'],
  [1, 'After every reply'],
  [500, 'Every ~500 words'],
  [1500, 'Every ~1,500 words (about a scene)'],
  [3000, 'Every ~3,000 words'],
];

export function SuggestionsTab() {
  const chat = useStore((s) => currentChat(s));
  const all = useStore((s) => s.suggestions);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  if (!chat) return null;
  const mine = all.filter((x) => x.chatId === chat.id).sort((a, b) => b.createdAt - a.createdAt);
  const pending = mine.filter((x) => x.status === 'pending');
  const done = mine.filter((x) => x.status !== 'pending').slice(0, 20);
  const every = chat.updatesEvery ?? DEFAULT_UPDATES_EVERY;

  const runNow = async () => {
    setBusy(true);
    setNote('');
    try {
      const n = await checkForUpdates(chat.id);
      setNote(n ? '' : 'No changes needed right now.');
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel-body">
      <section>
        <h3>Suggested updates</h3>
        <p className="muted small">The AI reads the new story and suggests changes to the Codex and Background. Nothing changes until you accept.</p>
        <label className="field">
          <span>Check for updates</span>
          <select value={every} onChange={(e) => updateChat({ updatesEvery: Number(e.target.value) })}>
            {UPDATE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <div className="row">
          <button className="small" disabled={busy} onClick={runNow}>{busy ? 'Checking…' : 'Update notes now'}</button>
          <button className="small ghost" onClick={() => saveSettings({ defaultUpdatesEvery: every })} title="New chats start with this setting">Use for new chats</button>
        </div>
        {note && <p className="muted small">{note}</p>}
      </section>

      <section>
        <div className="row">
          <h3 className="grow">Waiting for you ({pending.length})</h3>
          {pending.length > 1 && <button className="small ghost" onClick={() => acceptAll(chat.id)}>Accept all</button>}
        </div>
        {pending.length === 0 && <p className="muted small">Nothing to review.</p>}
        {pending.map((x) => <SuggestionCard key={x.id} x={x} />)}
      </section>

      {done.length > 0 && (
        <details className="section">
          <summary><b>Recent</b> <span className="muted small">accepted and rejected, with Undo</span></summary>
          {done.map((x) => <SuggestionCard key={x.id} x={x} />)}
        </details>
      )}
    </div>
  );
}
