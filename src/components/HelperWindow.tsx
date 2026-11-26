import { currentChat, ui, useStore } from '../store/store';
import { HelperTab } from './panel/HelperTab';

/** Trial: the Helper chat in a large window over the story. Its chat and unsent text are the same as in the panel. */
export function HelperWindow() {
  const chat = useStore((s) => currentChat(s));
  if (!chat) return null;
  return (
    <div className="modal-scrim helper-scrim">
      <div className="modal helper-window" role="dialog" aria-label="Helper">
        <header className="modal-head">
          <h2>Helper <span className="muted small">· {chat.title || 'Untitled story'}</span></h2>
          <button className="icon" onClick={() => ui.popHelper(false)} title="Back to the sidebar">✕</button>
        </header>
        <HelperTab popped />
      </div>
    </div>
  );
}
