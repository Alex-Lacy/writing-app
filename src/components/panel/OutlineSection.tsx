import { estimateTokens } from '../../context/tokens';
import { useState } from 'react';
import { chaptersOf, moveMarker, outlineBlocks, parseOutline } from '../../context/outline';
import { planNextChapter, stopPlanning } from '../../features/outline';
import { ui, updateChat } from '../../store/store';
import type { Chat } from '../../types';

/** Setup → Outline: the story's plan, one beat per line, with a marker on the current beat. */
export function OutlineSection({ chat }: { chat: Chat }) {
  const ol = chat.outline ?? { text: '' };
  const set = (p: Partial<NonNullable<Chat['outline']>>) => updateChat({ outline: { ...ol, ...p } });
  const { beats, current } = parseOutline(ol.text);
  const nextOpen = chaptersOf(ol.text).find((c) => c.open);
  const [planning, setPlanning] = useState(false);
  const tokens = outlineBlocks(chat).reduce((n, b) => n + estimateTokens(b.text), 0);
  return (
    <div className={`wt-block src-outline${ol.off ? ' off' : ''}`}>
      <div className="wt-head">
        <label className="wt-on" title="Send the Outline (switch off to keep it but leave it out)"><input type="checkbox" checked={!ol.off} onChange={(e) => set({ off: !e.target.checked || undefined })} /> <b>Outline</b></label>
        <em className="muted small">~{tokens} tokens</em>
      </div>
      <p className="muted small">Lines starting with "#" are chapters (a title and a line on what happens). Under a chapter, a "!" line is a moment you want, and other lines are scene beats; chapters without scene beats get them written automatically when the story gets there, keeping your "!" moments. "&gt;" marks the current beat. Only that beat is sent as the scene goal. The next ones are sent for awareness only, with a note not to steer toward or foreshadow them, so the story doesn't contradict them.</p>
      <textarea rows={6} value={ol.text} onChange={(e) => set({ text: e.target.value })} placeholder={'# Chapter 1: Harrowgate. Mara takes a job from Rell.\n> Mara arrives and meets Rell, who knows more than he says.\nRell offers her a job she can\'t refuse.\n# Chapter 2: The docks. The job goes wrong.\n! Mara sees Rell\'s ship leaving without her.\n# Chapter 3: Mara learns Rell set her up.'} />
      {beats.length > 0 && (
        <div className="row outline-nav">
          <button className="small" disabled={current <= 0} onClick={() => set({ text: moveMarker(ol.text, -1) })} title="Back one beat">◀</button>
          <span className="small grow">{current < beats.length ? <>Beat {current + 1} of {beats.length}: <b>{beats[current]}</b></> : 'Every beat is done.'}</span>
          <button className="small" disabled={current >= beats.length} onClick={() => set({ text: moveMarker(ol.text, 1) })} title="This beat has happened: move on">Next beat ▶</button>
        </div>
      )}
      {nextOpen && (
        <p className="muted small">
          {nextOpen.title}: scenes not written out yet. They're planned automatically as the story gets close{nextOpen.pins.length ? `, keeping your ${nextOpen.pins.length} "!" moment${nextOpen.pins.length === 1 ? '' : 's'}` : ''}.{' '}
          {planning
            ? <><span className="spinner" /> Planning… <button className="small ghost" onClick={() => stopPlanning(chat.id)}>■ Stop</button></>
            : <button className="small ghost" onClick={() => { setPlanning(true); void planNextChapter(chat.id, true).catch(() => {}).finally(() => setPlanning(false)); }}>Plan them now</button>}
        </p>
      )}
      <details>
        <summary className="muted small">Options</summary>
        <label className="field small"><span>When a beat has happened (the quick model checks after each reply)</span>
          <select value={ol.check === false ? 'off' : ol.advance ?? 'auto'} onChange={(e) => set(e.target.value === 'off' ? { check: false } : { check: undefined, advance: e.target.value as 'auto' | 'ask' })}>
            <option value="auto">Move on by itself (undo in Suggestions)</option>
            <option value="ask">Ask me with a card</option>
            <option value="off">Don't check; I'll press Next beat</option>
          </select>
        </label>
        <label className="field small num"><span>Beats hinted ahead</span>
          <select value={ol.ahead ?? 2} onChange={(e) => set({ ahead: Number(e.target.value) })}>
            {[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <button className="small ghost" onClick={() => ui.openHelper('helper-plot')}>Plan or revise with the Plot ideas Helper</button>
      </details>
    </div>
  );
}
