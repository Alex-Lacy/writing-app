import { countWords } from '../../context/length';
import { currentChat, ui, useStore, type PanelTab } from '../../store/store';
import { activeSwipe } from '../../types';
import { CodexTab } from './CodexTab';
import { FilterTab } from './FilterTab';
import { HelperTab } from './HelperTab';
import { SetupTab } from './SetupTab';
import { SuggestionsTab } from './SuggestionsTab';

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
  const words = useStore((s) => s.messages.reduce((n, m) => (m.role === 'system' ? n : n + countWords(activeSwipe(m).content)), 0));
  if (!chat) return null;
  return (
    <aside className="panel">
      <header className="panel-head">
        <b>#{chat.num} Story panel</b>
        {words > 0 && <span className="muted word-count">{words.toLocaleString()} words</span>}
        <span className="spacer" />
        <button className="small" onClick={() => ui.openCompile(true)} title="Turn the story into a clean manuscript: copy it, or save as Word, Markdown or text">Export</button>
        <button className="small" onClick={() => ui.openContext(true)} title="See exactly what gets sent to the model, in order">View context</button>
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
