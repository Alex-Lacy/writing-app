import { useEffect, useRef, useState } from 'react';
import { LENGTH_BUCKETS, LENGTH_ORDER, type LengthBucket } from '../context/length';
import { cancelWait, currentChat, insertMessage, modelFor, send, stop, updateChat, useStore } from '../store/store';
import type { Attachment, ThinkingMode } from '../types';
import { readAttachment } from '../lib/attach';

export function Composer() {
  const streaming = useStore((s) => !!s.streamingId);
  const waiting = useStore((s) => s.waiting);
  const enterToSend = useStore((s) => s.settings.enterToSend);
  const chatId = useStore((s) => s.currentChatId);
  const chat = useStore((s) => currentChat(s));
  const model = useStore((s) => modelFor(currentChat(s), s));
  const [text, setText] = useState('');
  const [atts, setAtts] = useState<Attachment[]>([]);
  const file = useRef<HTMLInputElement>(null);
  const ta = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, window.innerHeight * 0.4) + 'px';
  }, [text]);

  useEffect(() => ta.current?.focus(), [chatId]);
  // Attachments picked in one story must not go out with a message in another.
  const [attsChat, setAttsChat] = useState(chatId);
  if (attsChat !== chatId) {
    setAttsChat(chatId);
    setAtts([]);
  }

  const submit = () => {
    if (streaming || waiting) return;
    const t = text;
    const a = atts;
    setText('');
    setAtts([]);
    void send(t, a);
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
    {atts.length > 0 && (
      <div className="attach-row">
        {atts.map((a) => (
          <span key={a.id} className="attach">
            {a.kind === 'image' ? <img src={a.dataUrl} alt="" /> : <span>📄</span>}
            <span className="attach-name">{a.name}</span>
            <button className="icon" title="Remove" onClick={() => setAtts(atts.filter((x) => x.id !== a.id))}>×</button>
          </span>
        ))}
        {atts.some((a) => a.kind === 'image') && model?.vision !== true && <span className="muted small">This model may not be able to see images; pick one marked Vision.</span>}
      </div>
    )}
    <div className="composer">
      <input
        ref={file} type="file" multiple hidden accept="image/*,text/*,.md,.txt,.json,.csv"
        onChange={async (e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          for (const f of files) {
            try {
              const a = await readAttachment(f);
              setAtts((x) => [...x, a]);
            } catch (err) {
              useStore.setState({ error: (err as Error).message });
            }
          }
        }}
      />
      <button className="icon attach-btn" title="Attach images or text files" onClick={() => file.current?.click()} disabled={streaming}>📎</button>
      <textarea
        ref={ta}
        value={text}
        rows={1}
        placeholder={waiting ?? (streaming ? 'Writing…' : 'Write the next part, or send empty to let the AI go on')}
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => {
          const imgs = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'));
          if (!imgs.length) return;
          e.preventDefault();
          for (const f of imgs) readAttachment(f).then((a) => setAtts((x) => [...x, a]), (err) => useStore.setState({ error: (err as Error).message }));
        }}
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
              title="Add your text to the story without asking the AI for a reply"
              disabled={!text.trim() || !!waiting}
              onClick={() => { void insertMessage('user', text, atts.length ? atts : undefined); setText(''); setAtts([]); }}
            >Add only</button>
            {waiting
              ? <button onClick={cancelWait} title="Don't send this reply; the side job carries on">Cancel</button>
              : <button className="primary" onClick={submit}>Send</button>}
          </>
        )}
      </div>
    </div>
    </div>
  );
}
