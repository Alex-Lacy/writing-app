import { useEffect, useMemo, useRef } from 'react';
import { buildFor, currentChat, useStore } from '../store/store';
import { MessageItem } from './MessageItem';
import { Composer } from './Composer';

export function ChatView() {
  const messages = useStore((s) => s.messages);
  const chat = useStore((s) => currentChat(s));
  const streamingId = useStore((s) => s.streamingId);
  const error = useStore((s) => s.error);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  // Which messages fall outside the context window right now.
  const dropped = useMemo(() => {
    if (!chat || streamingId) return new Set<string>();
    return new Set(buildFor(chat, messages).droppedIds);
  }, [chat, messages, streamingId]);

  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div className="chat">
      <div
        className="messages"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {messages.length === 0 && (
          <div className="empty">
            <h2>{chat ? 'Start writing' : 'Writing Studio'}</h2>
            <p>Pick a model up top, set a system prompt or turn on Writing tools in the chat settings, then send a message.</p>
          </div>
        )}
        {messages.map((m, i) => (
          <MessageItem key={m.id} m={m} isLast={i === messages.length - 1} outOfContext={dropped.has(m.id)} />
        ))}
      </div>
      {error && (
        <div className="error-bar" onClick={() => useStore.setState({ error: undefined })}>
          {error} <span className="muted">(tap to dismiss)</span>
        </div>
      )}
      <Composer />
    </div>
  );
}
