import { useEffect, useRef, useState } from 'react';
import { LENGTH_BUCKETS, LENGTH_ORDER, type LengthBucket } from '../context/length';
import { currentChat, insertMessage, modelFor, send, stop, updateChat, useStore } from '../store/store';
import type { ThinkingMode } from '../types';

export function Composer() {
  const streaming = useStore((s) => !!s.streamingId);
  const enterToSend = useStore((s) => s.settings.enterToSend);
  const chatId = useStore((s) => s.currentChatId);
  const chat = useStore((s) => currentChat(s));
  const model = useStore((s) => modelFor(currentChat(s), s));
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
    <div className="composer-wrap">
      {chat && (
        <div className="composer-opts">
          <label title="How long replies should be. Sent to the model as a soft instruction; replies that run far past it stop at a clean sentence or paragraph end.">
            <span>Length</span>
            <select value={chat.length ?? 'any'} onChange={(e) => updateChat({ length: e.target.value as LengthBucket })}>
              {LENGTH_ORDER.map((b) => <option key={b} value={b}>{LENGTH_BUCKETS[b].label}</option>)}
            </select>
          </label>
          {model?.thinking && (
            <label title={model.thinking === 'always' ? 'This model always thinks; you can set how hard.' : 'Turn thinking off for speed, or ask for light or deep reasoning.'}>
              <span>Thinking</span>
              <select value={chat.thinking ?? 'default'} onChange={(e) => updateChat({ thinking: e.target.value as ThinkingMode })}>
                <option value="default">Model default</option>
                {model.thinking === 'optional' && <option value="off">Off</option>}
                <option value="light">Light</option>
                <option value="deep">Deep</option>
              </select>
            </label>
          )}
        </div>
      )}
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
    </div>
  );
}
