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
  if (!chat) return null;
  const tags = chat.tags ?? [];
  const set = (next: string[]) => updateChat({ tags: [...new Set(next.map((t) => t.trim()).filter(Boolean))] });
  const add = () => {
    if (text.trim()) set([...tags, ...parseTags(text)]);
    setText('');
  };
  const has = (t: string) => tags.some((x) => x.toLowerCase() === t);
  return (
    <section className="wt-block src-tags">
      <div className="wt-head"><b>Story tags</b> <em className="muted small">genre, tone, content; sent as one line</em></div>
      <div className="tag-row">
        {tags.map((t) => (
          <span key={t} className="tag">{t}<button className="icon" title="Remove" onClick={() => set(tags.filter((x) => x !== t))}>×</button></span>
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
