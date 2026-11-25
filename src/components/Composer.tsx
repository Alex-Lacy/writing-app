import { useEffect, useRef, useState } from 'react';
import { insertMessage, send, stop, useStore } from '../store/store';

export function Composer() {
  const streaming = useStore((s) => !!s.streamingId);
  const enterToSend = useStore((s) => s.settings.enterToSend);
  const chatId = useStore((s) => s.currentChatId);
  const [text, setText] = useState('');
  const ta = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, window.innerHeight * 0.4) + 'px';
  }, [text]);

  useEffect(() => ta.current?.focus(), [chatId]);

  const submit = () => {
    if (streaming) return;
    const t = text;
    setText('');
    void send(t);
  };

  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

  return (
    <div className="composer">
      <textarea
        ref={ta}
        value={text}
        rows={1}
        placeholder={streaming ? 'Generating…' : 'Message (empty to just generate)'}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && enterToSend && !coarse && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <div className="composer-buttons">
        {streaming ? (
          <button className="stop" onClick={stop}>Stop</button>
        ) : (
          <>
            <button
              className="ghost small"
              title="Add as a message without generating"
              disabled={!text.trim()}
              onClick={() => { void insertMessage('user', text); setText(''); }}
            >Add</button>
            <button className="primary" onClick={submit}>Send</button>
          </>
        )}
      </div>
    </div>
  );
}
