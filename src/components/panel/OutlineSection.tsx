import { estimateTokens } from '../../context/tokens';
import { moveMarker, outlineBlocks, parseOutline } from '../../context/outline';
import { ui, updateChat } from '../../store/store';
import type { Chat } from '../../types';

/** Setup → Outline: the story's plan, one beat per line, with a marker on the current beat. */
export function OutlineSection({ chat }: { chat: Chat }) {
  const ol = chat.outline ?? { text: '' };
  const set = (p: Partial<NonNullable<Chat['outline']>>) => updateChat({ outline: { ...ol, ...p } });
  const { beats, current } = parseOutline(ol.text);
  const tokens = outlineBlocks(chat).reduce((n, b) => n + estimateTokens(b.text), 0);
  return (
    <div className={`wt-block src-outline${ol.off ? ' off' : ''}`}>
      <div className="wt-head">
        <label className="wt-on" title="Send the Outline (switch off to keep it but leave it out)"><input type="checkbox" checked={!ol.off} onChange={(e) => set({ off: !e.target.checked || undefined })} /> <b>Outline</b></label>
        <em className="muted small">~{tokens} tokens</em>
      </div>
      <p className="muted small">Long-term plan, one beat (about a scene) per line. Start the current beat with "&gt;". Only that beat is sent as the scene goal. The next ones are sent for awareness only, with a note not to steer toward or foreshadow them, so the story doesn't contradict them.</p>
      <textarea rows={6} value={ol.text} onChange={(e) => set({ text: e.target.value })} placeholder={'Mara arrives in Harrowgate and meets Rell.\n> Rell offers her a job she can\'t refuse.\nThe job goes wrong at the docks.\nMara learns Rell set her up.'} />
      {beats.length > 0 && (
        <div className="row outline-nav">
          <button className="small" disabled={current <= 0} onClick={() => set({ text: moveMarker(ol.text, -1) })} title="Back one beat">◀</button>
          <span className="small grow">{current < beats.length ? <>Beat {current + 1} of {beats.length}: <b>{beats[current]}</b></> : 'Every beat is done.'}</span>
          <button className="small" disabled={current >= beats.length} onClick={() => set({ text: moveMarker(ol.text, 1) })} title="This beat has happened: move on">Next beat ▶</button>
        </div>
      )}
      <details>
        <summary className="muted small">Options</summary>
        <label className="switch small"><input type="checkbox" checked={ol.check !== false} onChange={(e) => set({ check: e.target.checked ? undefined : false })} /> After each reply, check whether the beat was reached and offer to move on (uses the quick model)</label>
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
