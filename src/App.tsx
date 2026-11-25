import { useEffect } from 'react';
import { ChatView } from './components/ChatView';
import { ContextModal } from './components/ContextModal';
import { SettingsModal } from './components/SettingsModal';
import { LibraryModal } from './components/LibraryModal';
import { CompileModal } from './components/CompileModal';
import { Sidebar } from './components/Sidebar';
import { StoryPanel } from './components/panel/StoryPanel';
import './features/updates';
import './features/summary';
import './features/filter/filter';
import { TopBar } from './components/TopBar';
import { init, ui, useStore } from './store/store';

export default function App() {
  const ready = useStore((s) => s.ready);
  const panel = useStore((s) => s.panel);
  const settingsOpen = useStore((s) => s.settingsOpen);
  const contextOpen = useStore((s) => s.contextOpen);
  const libraryOpen = useStore((s) => s.libraryOpen);
  const compileOpen = useStore((s) => s.compileOpen);
  const theme = useStore((s) => s.settings.theme);

  useEffect(() => { void init(); }, []);
  const settings = useStore((s) => s.settings);
  useEffect(() => {
    const apply = () => {
      document.documentElement.dataset.theme = theme === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : theme;
    };
    apply();
    if (theme !== 'system') return;
    const mq = matchMedia('(prefers-color-scheme: light)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
  useEffect(() => {
    const st = document.documentElement.style;
    const fonts = { serif: 'var(--serif)', sans: 'var(--sans)', mono: 'ui-monospace, Menlo, Consolas, monospace' };
    st.setProperty('--story-size', `${settings.storyFontSize ?? 17}px`);
    st.setProperty('--story-font', fonts[settings.storyFont ?? 'serif']);
    st.setProperty('--story-lh', String(settings.storyLineHeight ?? 1.65));
    st.setProperty('--story-width', `${settings.storyWidth ?? 820}px`);
    st.setProperty('--ui-size', `${settings.uiFontSize ?? 15}px`);
  }, [settings.storyFontSize, settings.storyFont, settings.storyLineHeight, settings.storyWidth, settings.uiFontSize]);

  const focus = useStore((s) => s.focus);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && useStore.getState().focus) ui.setFocus(false); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  if (!ready) return <div className="loading">Loading…</div>;
  return (
    <div className={`app${focus ? ' focus' : ''}${settings.sidebarHidden ? ' no-sidebar' : ''}`}>
      <Sidebar />
      <main className="main">
        <TopBar />
        <ChatView />
      </main>
      {panel !== 'none' && !focus && <StoryPanel />}
      {focus && <button className="focus-exit" onClick={() => ui.setFocus(false)} title="Leave full-screen reading (Esc)">⤡</button>}
      {contextOpen && <ContextModal />}
      {settingsOpen && <SettingsModal />}
      {libraryOpen && <LibraryModal />}
      {compileOpen && <CompileModal />}
    </div>
  );
}
