import { useState } from 'react';
import { editPart, refreshPart, summariseNext, unsummarise } from '../../features/summary';
import { estimateTokens } from '../../context/tokens';
import { currentChat, saveSettings, updateChat, useStore } from '../../store/store';

/** Auto-summary: the switch, and the summary parts with edit, refresh and un-summarise. */
export function SummarySection() {
  const chat = useStore((s) => currentChat(s));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [editing, setEditing] = useState<string>();
  const [text, setText] = useState('');
  if (!chat) return null;
  const parts = chat.summary ?? [];
  const on = chat.autoSummary !== false;

  const now = async () => {
    setBusy(true);
    setMsg('');
    try {
      if (!(await summariseNext(chat.id, { force: true }))) setMsg('Not enough older story to summarise yet (the newest messages are always kept in full).');
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="wt-block src-summary">
      <div className="wt-head">
        <label className="switch"><input type="checkbox" checked={on} onChange={(e) => updateChat({ autoSummary: e.target.checked })} /> <b>Auto-summary</b></label>
        {parts.length > 0 && <em className="muted small">~{estimateTokens(parts.map((p) => p.text).join(' '))} tokens</em>}
      </div>
      <p className="muted small">
        When the story nears the context limit, the oldest part is summarised into <b>Story so far</b>. The original
        messages stay in the chat; they're just not sent in full. The first summary asks you first.
      </p>
      <label className="switch small"><input type="checkbox" checked={!!chat.summaryAlwaysAsk} onChange={(e) => updateChat({ summaryAlwaysAsk: e.target.checked })} /> Always ask before adding a summary</label>
      {parts.map((p, i) => (
        <div key={p.id} className="sum-part">
          <div className="row">
            <b className="grow small">{p.merged ? 'Earlier story' : `Part ${i + 1}`} <span className="muted">· {p.messageIds.length} messages</span></b>
            {p.stale && <button className="small ghost" title="A message in this part was edited" onClick={() => refreshPart(chat.id, p.id)}>Out of date: refresh</button>}
            <button className="small ghost" onClick={() => { setEditing(p.id); setText(p.text); }}>Edit</button>
            <button className="small ghost" title="Put these messages back into the context in full" onClick={() => unsummarise(chat.id, p.id)}>Un-summarise</button>
          </div>
          {editing === p.id ? (
            <>
              <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} />
              <div className="row">
                <button className="small primary" onClick={() => { void editPart(chat.id, p.id, text); setEditing(undefined); }}>Save</button>
                <button className="small ghost" onClick={() => setEditing(undefined)}>Cancel</button>
              </div>
            </>
          ) : <p className="small">{p.text}</p>}
        </div>
      ))}
      <div className="row">
        <button className="small ghost" disabled={busy} onClick={now}>{busy ? 'Summarising…' : 'Summarise older story now'}</button>
        <button className="small ghost" onClick={() => saveSettings({ defaultAutoSummary: on })}>Use for new chats</button>
      </div>
      {msg && <p className="muted small">{msg}</p>}
    </section>
  );
}
