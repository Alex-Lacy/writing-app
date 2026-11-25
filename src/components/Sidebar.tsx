import { useState } from 'react';
import { deleteChat, duplicateChat, newChat, selectChat, ui, updateChat, useStore } from '../store/store';

export function Sidebar() {
  const chats = useStore((s) => s.chats);
  const currentId = useStore((s) => s.currentChatId);
  const open = useStore((s) => s.sidebarOpen);
  const [q, setQ] = useState('');
  const shown = q ? chats.filter((c) => c.title.toLowerCase().includes(q.toLowerCase()) || `#${c.num}` === q.trim()) : chats;

  return (
    <>
      {open && <div className="scrim" onClick={() => ui.toggleSidebar(false)} />}
      <aside className={`sidebar${open ? ' open' : ''}`}>
        <div className="sidebar-top">
          <button className="primary wide" title="Starts a new story and opens the New story Helper. Or just start typing if you don't want help." onClick={async () => { await newChat(); ui.openHelper('helper-new-story'); }}>+ New story</button>
          <input placeholder="Find a story" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <nav className="chat-list">
          {shown.map((c) => (
            <div key={c.id} className={`chat-item${c.id === currentId ? ' active' : ''}`} onClick={() => selectChat(c.id)}>
              <span className="chat-title"><span className="chat-num">#{c.num}</span> {c.title}</span>
              <span className="chat-item-actions" onClick={(e) => e.stopPropagation()}>
                <button className="icon" title="Rename" onClick={() => { const t = prompt('Rename story', c.title); if (t) updateChat({ title: t }, c.id); }}>✏️</button>
                <button className="icon" title="Duplicate" onClick={() => duplicateChat(c.id)}>⧉</button>
                <button className="icon" title="Delete" onClick={() => confirm(`Delete "${c.title}"?`) && deleteChat(c.id)}>🗑</button>
              </span>
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button className="ghost wide" onClick={() => ui.openLibrary(true)}>📚 Library</button>
          <button className="ghost wide" onClick={() => ui.openSettings(true)}>⚙ Settings</button>
        </div>
      </aside>
    </>
  );
}
