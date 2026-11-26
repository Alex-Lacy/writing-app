import { useMemo, useState } from 'react';
import { pickableModels, jobModelName } from '../ai/jobs';
import { applyRetcon, ignoreRetcon, retconScope, startRetcon, stopRetcon, undoRetcon, useRetcon } from '../features/retcon';
import { currentChat, saveSettings, ui, useStore } from '../store/store';
import { SuggestionCard } from './panel/SuggestionCard';
import { unreject } from '../store/suggestions';
import { useDraft } from './useDraft';

const COUNTS = [5, 10, 20, 0];

/** Retcon: one note about a changed fact, checked against a stretch of the story; only the sentences that clash get edited. */
export function RetconModal() {
  const open = useStore((s) => s.retconOpen);
  const chat = useStore((s) => currentChat(s));
  const messages = useStore((s) => s.messages);
  const suggestions = useStore((s) => s.suggestions);
  const models = useStore((s) => s.models);
  const picked = useStore((s) => s.settings.jobModels?.retcon);
  const run = useRetcon();
  const [note, setNote] = useDraft(chat ? `retcon:${chat.id}` : undefined);
  const [count, setCount] = useState(open?.fromId ? -1 : 10);
  const choices = useMemo(() => pickableModels(chat), [chat, models]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open || !chat) return null;
  const scope = count === -1 ? { fromId: open.fromId } : { count: count || undefined };
  const n = retconScope(messages, scope).length;
  const mine = run.chatId === chat.id && run.group ? run.group : undefined;
  // In story order, with the notes update last.
  const order = (x: (typeof suggestions)[number]) => (x.target.kind === 'passage' ? messages.findIndex((m) => m.id === (x.target as { messageId: string }).messageId) * 1e6 + x.target.from : 1e12);
  const cards = mine ? suggestions.filter((x) => x.group === mine).sort((a, b) => order(a) - order(b)) : [];
  const pending = cards.filter((x) => x.status === 'pending').length;
  const applied = cards.filter((x) => x.status === 'accepted').length;
  const ignored = cards.filter((x) => x.status === 'rejected' && !x.failed);
  const close = () => ui.openRetcon(undefined);
  const where = (id?: string) => {
    const i = messages.findIndex((m) => m.id === id);
    return i < 0 ? '' : `Message ${i + 1}`;
  };
  return (
    <div className="modal-scrim" onClick={close}>
      <div className="modal retcon-modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>Retcon</h2>
          <button className="icon" onClick={close} title="Close (a running retcon keeps going)">✕</button>
        </header>
        <div className="modal-body">
          <p className="muted small">Describe what should be true now. The model reads the part of the story you pick and changes only the sentences that contradict it, as little as it can.</p>
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Subaru is coming back from Pristella, by way of the Sanctuary." />
          <div className="row retcon-opts">
            <label className="field small"><span>Look through</span>
              <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
                {open.fromId && <option value={-1}>From the chosen message to the end</option>}
                {COUNTS.map((c) => <option key={c} value={c}>{c ? `The last ${c} messages` : 'The whole story'}</option>)}
              </select>
            </label>
            <label className="field small"><span>Model</span>
              <select value={picked && choices.some((c) => c.key === picked) ? picked : ''} onChange={(e) => void saveSettings({ jobModels: { ...useStore.getState().settings.jobModels, retcon: e.target.value || undefined } })}>
                <option value="">Default ({jobModelName('retcon', chat, { noOverride: true }) ?? 'story model'})</option>
                {choices.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
              </select>
            </label>
          </div>
          <div className="row">
            {run.running
              ? <button onClick={stopRetcon}>Stop</button>
              : <button className="primary" disabled={!note.trim() || !n} onClick={() => void startRetcon(chat.id, note, scope)}>Find what to change ({n} message{n === 1 ? '' : 's'})</button>}
            {run.running && <span className="muted small"><span className="spinner" /> Reading{run.total > 1 ? ` part ${Math.min(run.done + 1, run.total)} of ${run.total}` : ''}…</span>}
          </div>
          {run.error && run.chatId === chat.id && <p className="muted small">{run.error}</p>}
          {mine && !run.running && !cards.length && !run.error && <p className="muted small">Nothing in that part of the story contradicts the note.</p>}
          {cards.length > 0 && (
            <>
              <div className="row retcon-top">
                <b className="grow">{cards.length} edit{cards.length === 1 ? '' : 's'}{applied ? ` · ${applied} applied` : ''}</b>
                {pending > 0 && <button className="small primary" onClick={() => void applyRetcon(mine!)}>Apply all</button>}
                {pending > 0 && <button className="small ghost" onClick={() => void ignoreRetcon(mine!)}>Ignore the rest</button>}
                {applied > 0 && <button className="small ghost" onClick={() => void undoRetcon(mine!)}>Undo all</button>}
                {ignored.length > 0 && <button className="small ghost" onClick={() => { for (const x of ignored) void unreject(x.id); }}>Bring back ignored</button>}
              </div>
              {cards.map((x) => (
                <div key={x.id} className="retcon-edit">
                  {x.target.kind === 'passage' && <span className="muted small">{where(x.target.messageId)}</span>}
                  <SuggestionCard x={x} hideSource />
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
