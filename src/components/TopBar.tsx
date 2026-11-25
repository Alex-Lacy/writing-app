import { useMemo } from 'react';
import { replyReserve, saveSettings, buildFor, contextLimitFor, currentChat, modelLabel, ui, updateChat, useStore } from '../store/store';

export function TopBar() {
  const chat = useStore((s) => currentChat(s));
  const models = useStore((s) => s.models);
  const defaultKey = useStore((s) => s.settings.defaultModelKey);
  const messages = useStore((s) => s.messages);
  const streaming = useStore((s) => !!s.streamingId);
  const panel = useStore((s) => s.panel);
  const limit = useStore((s) => contextLimitFor(currentChat(s), s));
  const jobs = useStore((s) => s.jobs);
  const pending = useStore((s) => s.suggestions.filter((x) => x.chatId === s.currentChatId && x.status === 'pending').length);

  const stats = useMemo(() => (chat && !streaming ? buildFor(chat, messages) : undefined), [chat, messages, streaming]);
  const used = stats ? stats.tokens.total : 0;
  const pct = Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
  const sorted = [...models].sort((a, b) => modelLabel(a).localeCompare(modelLabel(b)));
  const value = chat?.modelKey ?? defaultKey ?? '';

  return (
    <header className="topbar">
      <button className="icon menu" onClick={() => ui.toggleSidebar()} title="Chats">☰</button>
      <select
        className="model-picker"
        value={models.some((m) => m.key === value) ? value : ''}
        onChange={(e) => {
          if (e.target.value === '__manage') return ui.openSettings(true, 'models');
          if (chat) updateChat({ modelKey: e.target.value });
          else saveSettings({ defaultModelKey: e.target.value });
        }}
      >
        {!models.some((m) => m.key === value) && <option value="">Choose a model…</option>}
        {sorted.map((m) => (
          <option key={m.key} value={m.key}>{modelLabel(m)}</option>
        ))}
        <option value="__manage">＋ Add / manage models…</option>
      </select>
      <div className="spacer" />
      {chat && (
        <div
          className={`meter${stats?.droppedIds.length ? ' warn' : ''}`}
          title={`~${used.toLocaleString()} prompt tokens + ${replyReserve(chat)} kept for the reply, of ${limit.toLocaleString()}${stats?.droppedIds.length ? `. ${stats.droppedIds.length} older messages don't fit.` : ''}`}
          onClick={() => ui.openContext(true)}
        >
          <div className="meter-bar"><div style={{ width: `${pct}%` }} /></div>
          <span>{(used / 1000).toFixed(1)}k/{Math.round(limit / 1000)}k</span>
        </div>
      )}
      {chat && (
        <button className={`toggle${chat.writing.enabled ? ' on' : ''}`} onClick={() => updateChat({ writing: { ...chat.writing, enabled: !chat.writing.enabled } })} title="Writing tools (Background, Steering)">
          ✎<span className="label"> Writing</span>
        </button>
      )}
      {chat && (
        <button className={`toggle small${chat.autoSummary !== false ? ' on' : ''}`} onClick={() => updateChat({ autoSummary: chat.autoSummary === false })} title="Auto-summary: when the story nears the context limit, older messages are summarised so nothing important falls out. Click to switch.">
          Σ<span className="label"> Auto-summary {chat.autoSummary !== false ? 'on' : 'off'}</span>
        </button>
      )}
      {jobs.length > 0 && <span className="jobs muted small" title={jobs.map((j) => j.label).join(', ')}>⟳ {jobs[0].label}…</span>}
      {chat && (
        <button className={`icon panel-btn${panel === 'chat-settings' ? ' active' : ''}`} onClick={() => (pending ? ui.openPanel('suggestions') : ui.setPanel('chat-settings'))} title={pending ? `${pending} suggestions to review` : 'Story panel: setup, Codex, Helper, suggestions'}>
          ☰{pending > 0 && <span className="badge">{pending}</span>}
        </button>
      )}
    </header>
  );
}
