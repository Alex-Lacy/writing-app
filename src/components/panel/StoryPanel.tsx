import { countWords } from '../../context/length';
import { useRef } from 'react';
import { currentChat, saveSettings, ui, useStore, type PanelTab } from '../../store/store';
import { activeSwipe, type Message } from '../../types';
import { CodexTab } from './CodexTab';
import { FilterTab } from './FilterTab';
import { HelperTab } from './HelperTab';
import { SetupTab } from './SetupTab';
import { SuggestionsTab } from './SuggestionsTab';

// Messages are replaced when they change, so a count per message object stays right.
const counted = new WeakMap<Message, number>();
function wordsIn(m: Message) {
  let n = counted.get(m);
  if (n === undefined) counted.set(m, (n = m.role === 'system' ? 0 : countWords(activeSwipe(m).content)));
  return n;
}

const TABS: [PanelTab, string][] = [
  ['setup', 'Setup'],
  ['codex', 'Codex'],
  ['helper', 'Helper'],
  ['filter', 'Clichés'],
  ['suggestions', 'Suggestions'],
];

/** The right-hand panel: everything that shapes one story, one tab per tool. */
export function StoryPanel() {
  const tab = useStore((s) => s.panelTab);
  const chat = useStore((s) => currentChat(s));
  const pending = useStore((s) => s.suggestions.filter((x) => x.chatId === s.currentChatId && x.status === 'pending').length);
  const words = useStore((s) => s.messages.reduce((n, m) => n + wordsIn(m), 0));
  const width = useStore((s) => s.settings.panelWidth);
  const wide = useStore((s) => !!s.settings.panelWide);
  const ref = useRef<HTMLElement>(null);
  if (!chat) return null;

  // Drag the left edge to resize (desktop); the width is remembered.
  const drag = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el) return;
    e.preventDefault();
    const right = el.getBoundingClientRect().right;
    const clamp = (x: number) => Math.round(Math.max(320, Math.min(window.innerWidth * 0.75, right - x)));
    const move = (ev: PointerEvent) => el.style.setProperty('--pw', `${clamp(ev.clientX)}px`);
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      void saveSettings({ panelWidth: clamp(ev.clientX), panelWide: undefined });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <aside ref={ref} className={`panel${wide ? ' wide' : ''}`} style={width ? ({ '--pw': `${width}px` } as React.CSSProperties) : undefined}>
      <div className="panel-resize" onPointerDown={drag} onDoubleClick={() => void saveSettings({ panelWidth: undefined, panelWide: undefined })} title="Drag to resize; double-click for the usual width" />
      <header className="panel-head">
        <b>#{chat.num} Story panel</b>
        {words > 0 && <span className="muted word-count">{words.toLocaleString()} words</span>}
        <span className="spacer" />
        <button className="small" onClick={() => ui.openCompile(true)} title="Turn the story into a clean manuscript: copy it, or save as Word, Markdown or text">Export</button>
        <button className="small" onClick={() => ui.openContext(true)} title="See exactly what gets sent to the model, in order">View context</button>
        <button className="icon panel-wide" onClick={() => void saveSettings({ panelWide: !wide || undefined })} title={wide ? 'Back to the narrow panel' : 'Widen the panel to half the window'}>{wide ? '⇥' : '⇤'}</button>
        <button className="icon" onClick={() => ui.setPanel('none')} title="Close">✕</button>
      </header>
      <nav className="tabs panel-tabs">
        {TABS.map(([id, label]) => (
          <button key={id} className={`tab${tab === id ? ' active' : ''}`} onClick={() => ui.setPanelTab(id)}>
            {label}
            {id === 'suggestions' && pending > 0 && <span className="badge">{pending}</span>}
          </button>
        ))}
      </nav>
      {tab === 'setup' && <SetupTab />}
      {tab === 'codex' && <CodexTab />}
      {tab === 'helper' && <HelperTab />}
      {tab === 'filter' && <FilterTab />}
      {tab === 'suggestions' && <SuggestionsTab />}
    </aside>
  );
}
