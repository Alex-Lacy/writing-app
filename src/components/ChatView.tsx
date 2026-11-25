import { useDeferredValue, useMemo } from 'react';
import { previewFor, currentChat, modelFor, useStore } from '../store/store';
import { MessageItem } from './MessageItem';
import { useStickyScroll } from './useStickyScroll';
import { Composer } from './Composer';
import { SelectionToolbar } from './MessageTools';

export function ChatView() {
  const messages = useStore((s) => s.messages);
  const chat = useStore((s) => currentChat(s));
  const streamingId = useStore((s) => s.streamingId);
  const error = useStore((s) => s.error);
  const helperOpen = useStore((s) => s.panel === 'chat-settings' && s.panelTab === 'helper');
  const hasModel = useStore((s) => !!modelFor(currentChat(s), s));
  const scroll = useStickyScroll<HTMLDivElement>(messages);

  // Which messages fall outside the context window right now.
  const lazyChat = useDeferredValue(chat);
  const dropped = useMemo(() => {
    if (!lazyChat || streamingId) return new Set<string>();
    return new Set(previewFor(lazyChat, messages).droppedIds);
  }, [lazyChat, messages, streamingId]);


  return (
    <div className="chat">
      <div
        className="messages"
        ref={scroll.ref}
        onScroll={scroll.onScroll}
      >
        {messages.length === 0 && (
          <div className="empty">
            <h2>{chat ? 'Start writing' : 'Writing Studio'}</h2>
            {helperOpen && chat ? (
              <p>Describe your story to the Helper on the right, then accept its suggestions. Or just start writing below.</p>
            ) : (
              <p>{hasModel ? 'Just start writing below.' : 'Pick a model up top, then start writing.'} For a guided setup, use <b>+ New story</b> or the Helper in the Story panel (▤).</p>
            )}
            {!chat && location.protocol === 'https:' && !matchMedia('(display-mode: standalone)').matches && (
              <p className="muted small">
                Tip: install it as an app so it opens full-screen and works offline. On iPhone or iPad: Share, then
                Add to Home Screen. On Android or desktop: the install option in your browser's menu.
              </p>
            )}
          </div>
        )}
        {messages.map((m, i) => (
          <MessageItem key={m.id} m={m} isLast={i === messages.length - 1} outOfContext={dropped.has(m.id)} />
        ))}
        {scroll.away && <button className="jump-latest" onClick={scroll.jump}>{streamingId ? '↓ Follow the reply' : '↓ Latest'}</button>}
      </div>
      {error && (
        <div className="error-bar" onClick={() => useStore.setState({ error: undefined })}>
          {error} <span className="muted">(tap to dismiss)</span>
        </div>
      )}
      <SelectionToolbar />
      <Composer />
    </div>
  );
}
