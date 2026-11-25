import { useEffect, useRef, useState } from 'react';
import { askHelper, clearThread, helpersList } from '../../features/helper';
import { renderMarkdown } from '../../lib/markdown';
import { currentChat, ui, useStore } from '../../store/store';
import { SuggestionCard } from './SuggestionCard';
import { accept } from '../../store/suggestions';

/** Talk to a Helper about this story; its proposed changes show as cards right in the conversation. */
export function HelperTab() {
  const chat = useStore((s) => currentChat(s));
  const chosen = useStore((s) => s.helperId);
  const threads = useStore((s) => s.helperThreads);
  const suggestions = useStore((s) => s.suggestions);
  const hasStory = useStore((s) => s.messages.length > 0);
  const [text, setText] = useState('');
  const [live, setLive] = useState<string>();
  const [error, setError] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const helpers = helpersList();
  const fresh = !hasStory && !chat?.writing.background.trim();
  const helper = helpers.find((h) => h.id === chosen) ?? helpers.find((h) => h.id === (fresh ? 'helper-new-story' : 'helper-setup'))!;
  const thread = chat && threads.find((t) => t.chatId === chat.id && t.helperId === helper.id);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [thread?.messages.length, live]);
  if (!chat) return null;

  const send = async () => {
    const t = text.trim();
    if (!t || live !== undefined) return;
    setText('');
    setError('');
    setLive('');
    try {
      await askHelper(chat.id, helper.id, t, (x) => setLive(x.replace(/```changes[\s\S]*$/i, '')));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLive(undefined);
    }
  };

  return (
    <div className="panel-body helper">
      <div className="row">
        <select value={helper.id} onChange={(e) => ui.openHelper(e.target.value)}>
          {helpers.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
        <span className="spacer" />
        {thread && thread.messages.length > 0 && <button className="small ghost" onClick={() => clearThread(chat.id, helper.id)}>Start over</button>}
      </div>
      <p className="muted small">{helper.blurb} It sees this story's setup and recent text, and suggests changes for you to accept.</p>
      <div className="helper-log">
        {thread?.messages.map((m, i) => (
          <div key={i} className={`helper-msg ${m.role}`}>
            {m.role === 'user' ? <p>{m.content}</p> : <div className="markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }} />}
            {m.suggestionIds?.map((id) => {
              const x = suggestions.find((s) => s.id === id);
              return x ? <SuggestionCard key={id} x={x} hideSource /> : null;
            })}
            {(m.suggestionIds?.filter((id) => suggestions.some((s) => s.id === id && s.status === 'pending')).length ?? 0) > 1 && (
              <button className="small primary" onClick={async () => { for (const id of m.suggestionIds!) await accept(id); }}>Accept all</button>
            )}
          </div>
        ))}
        {live !== undefined && <div className="helper-msg assistant"><div className="markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(live) || '<span class="muted">Thinking…</span>' }} /></div>}
        {error && <p className="error small">{error}</p>}
        <div ref={end} />
      </div>
      <div className="helper-input">
        <textarea
          rows={3}
          value={text}
          placeholder={helper.id === 'helper-new-story' ? 'Describe the story you want to write…' : 'What would you like to change?'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
        />
        <button className="primary" disabled={!text.trim() || live !== undefined} onClick={send}>Send</button>
      </div>
    </div>
  );
}
