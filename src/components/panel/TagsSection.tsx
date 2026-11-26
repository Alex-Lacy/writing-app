import { useState } from 'react';
import { parseTags } from '../../context/codex';
import { currentChat, updateChat, useStore } from '../../store/store';

const IDEAS: [string, string[]][] = [
  ['Genre', ['fantasy', 'dark fantasy', 'sci-fi', 'romance', 'mystery', 'thriller', 'horror', 'historical', 'slice of life', 'literary', 'fanfiction']],
  ['Tone', ['dark', 'gritty', 'lighthearted', 'humorous', 'cozy', 'melancholy', 'tense', 'whimsical']],
  ['Pacing', ['slow burn', 'fast-paced', 'character-driven', 'plot-driven', 'dialogue-heavy']],
  ['Content', ['explicit', 'fade to black', 'violence', 'gore', 'mature themes', 'no sexual content']],
];

/** Story tags: genre, tone and content notes, sent as one line after Background. */
export function TagsSection() {
  const chat = useStore((s) => currentChat(s));
  const [text, setText] = useState('');
  const [ideas, setIdeas] = useState(false);
  const [editing, setEditing] = useState<number>();
  const [drag, setDrag] = useState<{ from: number; over: number }>();
  if (!chat) return null;
  const tags = chat.tags ?? [];
  const set = (next: string[]) => updateChat({ tags: [...new Set(next.map((t) => t.trim()).filter(Boolean))] });
  const add = () => {
    if (text.trim()) set([...tags, ...parseTags(text)]);
    setText('');
  };
  // Click a tag to edit it in place (empty removes it); drag it (mouse or finger) to move it.
  const finishEdit = (i: number, v: string) => {
    setEditing(undefined);
    const parts = parseTags(v);
    set([...tags.slice(0, i), ...parts, ...tags.slice(i + 1)]);
  };
  const startDrag = (e: React.PointerEvent, from: number) => {
    if (e.button > 0) return;
    const x0 = e.clientX, y0 = e.clientY;
    let moved = false, over = from;
    const move = (m: PointerEvent) => {
      if (!moved && Math.hypot(m.clientX - x0, m.clientY - y0) < 6) return;
      moved = true;
      const el = document.elementFromPoint(m.clientX, m.clientY)?.closest<HTMLElement>('.src-tags .tag[data-i]');
      if (el) over = Number(el.dataset.i);
      setDrag({ from, over });
    };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
      setDrag(undefined);
      if (!moved) return setEditing(from);
      if (over === from) return;
      const next = [...tags];
      const [t] = next.splice(from, 1);
      next.splice(over, 0, t);
      set(next);
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
  };
  const has = (t: string) => tags.some((x) => x.toLowerCase() === t);
  return (
    <section className="wt-block src-tags">
      <div className="wt-head"><b>Story tags</b> <em className="muted small">genre, tone, content; sent as one line</em></div>
      <div className="tag-row">
        {tags.map((t, i) => (
          editing === i ? (
            <input
              key={`edit-${t}`} className="tag-edit" autoFocus defaultValue={t} size={Math.max(4, t.length)}
              onBlur={(e) => finishEdit(i, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); finishEdit(i, e.currentTarget.value); }
                if (e.key === 'Escape') setEditing(undefined);
              }}
            />
          ) : (
            <span
              key={t} data-i={i} className={`tag${drag?.from === i ? ' dragging' : ''}${drag && drag.over === i && drag.from !== i ? ' drop' : ''}`}
              title="Click to edit, drag to move" onPointerDown={(e) => startDrag(e, i)}
            >
              {t}<button className="icon" title="Remove" onPointerDown={(e) => e.stopPropagation()} onClick={() => set(tags.filter((x) => x !== t))}>×</button>
            </span>
          )
        ))}
        <input
          className="tag-input" value={text} placeholder={tags.length ? 'Add…' : 'e.g. noir, slow burn, explicit'}
          onChange={(e) => setText(e.target.value)} onBlur={add}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add();
            }
          }}
        />
      </div>
      <button className="small ghost" onClick={() => setIdeas(!ideas)}>{ideas ? 'Hide ideas' : 'Ideas'}</button>
      {ideas && IDEAS.map(([group, list]) => (
        <div key={group} className="tag-ideas">
          <span className="muted small">{group}</span>
          {list.filter((t) => !has(t)).map((t) => <button key={t} className="chip" onClick={() => set([...tags, t])}>+ {t}</button>)}
        </div>
      ))}
    </section>
  );
}
