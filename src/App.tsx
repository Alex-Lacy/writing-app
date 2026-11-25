import { useEffect } from 'react';
import { ChatSettingsPanel } from './components/ChatSettingsPanel';
import { ChatView } from './components/ChatView';
import { ContextModal } from './components/ContextModal';
import { SettingsModal } from './components/SettingsModal';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { init, ui, useStore } from './store/store';

export default function App() {
  const ready = useStore((s) => s.ready);
  const panel = useStore((s) => s.panel);
  const settingsOpen = useStore((s) => s.settingsOpen);
  const contextOpen = useStore((s) => s.contextOpen);
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
            <b>Chat settings</b>
            <button className="icon" onClick={() => ui.setPanel('none')}>✕</button>
          </header>
          <ChatSettingsPanel />
        </aside>
      )}
      {contextOpen && <ContextModal />}
      {settingsOpen && <SettingsModal />}
    </div>
  );
}
