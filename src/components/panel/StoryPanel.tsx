import { currentChat, ui, useStore, type PanelTab } from '../../store/store';
import { CodexTab } from './CodexTab';
import { FilterTab } from './FilterTab';
import { HelperTab } from './HelperTab';
import { SetupTab } from './SetupTab';
import { SuggestionsTab } from './SuggestionsTab';

const TABS: [PanelTab, string][] = [
  ['setup', 'Setup'],
  ['codex', 'Codex'],
  ['helper', 'Helper'],
  ['filter', 'Cliché Filter'],
  ['suggestions', 'Suggestions'],
];

/** The right-hand panel: everything that shapes one story, one tab per tool. */
export function StoryPanel() {
  const tab = useStore((s) => s.panelTab);
  const chat = useStore((s) => currentChat(s));
  const pending = useStore((s) => s.suggestions.filter((x) => x.chatId === s.currentChatId && x.status === 'pending').length);
  if (!chat) return null;
  return (
    <aside className="panel">
      <header className="panel-head">
        <b>#{chat.num} Story panel</b>
        <span className="spacer" />
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
