import { useEffect } from 'react';
import { ChatSettingsPanel } from './components/ChatSettingsPanel';
import { ChatView } from './components/ChatView';
import { ContextPanel } from './components/ContextPanel';
import { SettingsModal } from './components/SettingsModal';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { init, ui, useStore } from './store/store';

export default function App() {
  const ready = useStore((s) => s.ready);
  const panel = useStore((s) => s.panel);
  const settingsOpen = useStore((s) => s.settingsOpen);
  const theme = useStore((s) => s.settings.theme);

  useEffect(() => { void init(); }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);

  if (!ready) return <div className="loading">Loading…</div>;
  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        <TopBar />
        <ChatView />
      </main>
      {panel !== 'none' && (
        <aside className="panel">
          <header className="panel-head">
            <div className="tabs">
              <button className={panel === 'chat-settings' ? 'tab active' : 'tab'} onClick={() => useStore.setState({ panel: 'chat-settings' })}>Chat settings</button>
              <button className={panel === 'context' ? 'tab active' : 'tab'} onClick={() => useStore.setState({ panel: 'context' })}>Context</button>
            </div>
            <button className="icon" onClick={() => ui.setPanel('none')}>✕</button>
          </header>
          {panel === 'chat-settings' ? <ChatSettingsPanel /> : <ContextPanel />}
        </aside>
      )}
      {settingsOpen && <SettingsModal />}
    </div>
  );
}
