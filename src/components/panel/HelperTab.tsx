import { useEffect, useRef, useState } from 'react';
import { askHelper, clearThread, deleteHelperMessage, editHelperMessage, helpersList, retryHelper, stopHelper } from '../../features/helper';
import { renderMarkdown } from '../../lib/markdown';
import { currentChat, ui, useStore } from '../../store/store';
import { jobModelName } from '../../ai/jobs';
import { SuggestionCard } from './SuggestionCard';
import { useStickyScroll } from '../useStickyScroll';
import { useDraft } from '../useDraft';
import { accept } from '../../store/suggestions';

/** Talk to a Helper about this story; its proposed changes show as cards right in the conversation. */
export function HelperTab() {
  const chat = useStore((s) => currentChat(s));
  const chosen = useStore((s) => s.helperId);
  const threads = useStore((s) => s.helperThreads);
  const suggestions = useStore((s) => s.suggestions);
  const hasStory = useStore((s) => s.messages.length > 0);
  const modelName = useStore((s) => jobModelName('helper', currentChat(s)));
  const box = useRef<HTMLTextAreaElement>(null);
  const anyLive = useStore((s) => s.helperLive);
  const helpers = helpersList();
  const fresh = !hasStory && !chat?.writing.background.trim();
  const helper = helpers.find((h) => h.id === chosen) ?? helpers.find((h) => h.id === (fresh ? 'helper-new-story' : 'helper-setup'))!;
  // Unsent text is kept per story and Helper, through tab switches and reloads.
  const [text, setText] = useDraft(chat ? `helper:${chat.id}:${helper.id}` : undefined);
  // Grows upward with what's typed (the box sits at the bottom), up to half the window.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 64), window.innerHeight * 0.5)}px`;
  }, [text]);
  const thread = chat && threads.find((t) => t.chatId === chat.id && t.helperId === helper.id);
  // The reply runs in the background, so it is shown from the store: closing the panel loses nothing.
  const mine = anyLive && chat && anyLive.chatId === chat.id && anyLive.helperId === helper.id ? anyLive : undefined;
  const live = mine && !mine.error ? mine.text : undefined;
  const busy = !!anyLive && !anyLive.error; // one Helper reply at a time
  // Follow the reply only while you're at the bottom, so you can read back or press Accept.
  const scroll = useStickyScroll<HTMLDivElement>(`${thread?.messages.length}:${live?.length}:${mine?.phase}`);
  if (!chat) return null;

  const send = () => {
    const t = text.trim();
    if (!t || busy) return;
    setText('');
    void askHelper(chat.id, helper.id, t);
  };
  const edit = async (i: number) => {
    setText(await editHelperMessage(chat.id, helper.id, i));
    requestAnimationFrame(() => box.current?.focus());
  };
  const count = thread?.messages.length ?? 0;

  return (
    <div className="panel-body helper" ref={scroll.ref} onScroll={scroll.onScroll}>
      <div className="row">
        <select value={helper.id} onChange={(e) => ui.openHelper(e.target.value)}>
          {helpers.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
        <span className="spacer" />
        {count > 0 && <button className="small ghost" onClick={() => confirm('Clear this conversation? Its open suggestions stay in Suggestions.') && clearThread(chat.id, helper.id)}>Start over</button>}
      </div>
      <p className="muted small">
        {helper.blurb} It sees this story's setup and recent text, and suggests changes for you to accept.{' '}
        {modelName && <span title="Change it in Settings, Advanced: models for side jobs">Model: <b>{modelName}</b>.</span>}
      </p>
      <div className="helper-log">
        {thread?.messages.map((m, i) => (
          m.role === 'tool' ? (
            <details key={i} className="helper-lookups">
              <summary className="muted small">🔎 {m.lookups?.map((l) => l.label).join(' · ') || 'Looked things up'}</summary>
              {m.lookups?.some((l) => l.sources.length) && (
                <ul className="small">
                  {m.lookups.flatMap((l) => l.sources).map((x) => <li key={x.url}><a href={x.url} target="_blank" rel="noreferrer">{x.title}</a></li>)}
                </ul>
              )}
              <pre className="lookup-text small">{m.content.slice(0, 4000)}{m.content.length > 4000 ? '\n…' : ''}</pre>
            </details>
          ) : (
          <div key={i} className={`helper-msg ${m.role}`}>
            {m.role === 'user' ? <p>{m.content}</p> : <div className="markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }} />}
            {!busy && (
              <div className="helper-actions">
                <button className="ghost" onClick={() => void navigator.clipboard.writeText(m.content)}>Copy</button>
                {m.role === 'user' && <button className="ghost" onClick={() => void edit(i)} title={i < count - 1 ? 'Edit and send again (the replies after it are removed)' : 'Edit and send again'}>Edit</button>}
                {m.role === 'assistant' && i === count - 1 && <button className="ghost" onClick={() => void retryHelper(chat.id, helper.id)} title="Ask again for this reply">Retry</button>}
                {m.role === 'user' && i === count - 1 && <button className="ghost" onClick={() => void retryHelper(chat.id, helper.id)} title="Send this again">Resend</button>}
                <button className="ghost" onClick={() => void deleteHelperMessage(chat.id, helper.id, i)}>Delete</button>
              </div>
            )}
            {m.suggestionIds?.map((id) => {
              const x = suggestions.find((s) => s.id === id);
              return x ? <SuggestionCard key={id} x={x} hideSource /> : null;
            })}
            {(m.suggestionIds?.filter((id) => suggestions.some((s) => s.id === id && s.status === 'pending')).length ?? 0) > 1 && (
              <button className="small primary" onClick={async () => { for (const id of m.suggestionIds!) await accept(id); }}>Accept all</button>
            )}
          </div>
          )
        ))}
        {live !== undefined && mine && (
          <div className="helper-msg assistant">
            {live.replace(/```changes[\s\S]*$/i, '').trim() && <div className="markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(live.replace(/```changes[\s\S]*$/i, '')) }} />}
            <HelperProgress live={mine} />
          </div>
        )}
        {mine?.error && (
          <p className="error small">
            {mine.error} <button className="small ghost" onClick={() => void retryHelper(chat.id, helper.id)}>Try again</button>
          </p>
        )}
      </div>
      <div className="helper-input">
        {scroll.away && <button className="jump-latest" onClick={scroll.jump}>{live !== undefined ? '↓ Follow the reply' : '↓ Latest'}</button>}
        <textarea
          ref={box}
          rows={2}
          value={text}
          placeholder={helper.id === 'helper-new-story' ? 'Describe the story you want to write…' : helper.id === 'helper-research' ? 'What should we look into? e.g. "The Witcher: Yennefer and Geralt before the books start"' : 'What would you like to change?'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
        />
        {live !== undefined
          ? <button onClick={stopHelper} title="Stop; what it has written so far is kept">Stop</button>
          : <button className="primary" disabled={!text.trim() || busy} onClick={send} title={busy ? 'Another Helper is replying' : undefined}>Send</button>}
      </div>
    </div>
  );
}

/** What the Helper is doing and for how long, so a slow reply doesn't look stuck. */
function HelperProgress({ live }: { live: NonNullable<ReturnType<typeof useStore.getState>['helperLive']> }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = Math.max(0, Math.floor((now - (live.startedAt ?? now)) / 1000));
  const time = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  // Suggestions are written as a block after the words; count them as they arrive.
  const block = live.text.match(/```changes([\s\S]*)$/i)?.[1];
  const cards = block ? (block.match(/"type"\s*:/g) ?? []).length : 0;
  const words = Math.round((live.reasoning ?? 0) / 5.5);
  const what =
    block !== undefined ? `Writing suggestions${cards ? ` (${cards} so far)` : ''}`
    : live.phase === 'writing' ? 'Writing'
    : live.phase === 'thinking' ? `Thinking it through (~${words.toLocaleString()} words)`
    : live.phase === 'sent' ? 'Waiting for the model to start'
    : live.phase === 'looking' ? (live.doing || 'Looking things up')
    : live.phase === 'busy' ? 'Your plan is busy with another request; trying again shortly'
    : 'Queued behind another job';
  return (
    <p className="helper-progress muted small">
      <span className="spinner" /> {what} · {time}
      {secs > 20 && live.phase !== 'writing' && block === undefined && <span> · You can close this panel; the reply will wait here.</span>}
    </p>
  );
}
