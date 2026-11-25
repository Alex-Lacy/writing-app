import { useMemo, useState } from 'react';
import { compileStory, DEFAULT_COMPILE, download, fileName, toDocx, toPlainText, type CompileOptions } from '../features/compile';
import { renderMarkdown } from '../lib/markdown';
import { currentChat, ui, useStore } from '../store/store';

/** Export: the story as a clean manuscript. */
export function CompileModal() {
  const chat = useStore((s) => currentChat(s));
  const messages = useStore((s) => s.messages);
  const [o, setO] = useState<CompileOptions>(DEFAULT_COMPILE);
  const [copied, setCopied] = useState(false);
  const title = chat?.title || 'Story';
  const { markdown, words } = useMemo(() => compileStory(title, messages, o), [title, messages, o]);
  const html = useMemo(() => renderMarkdown(markdown), [markdown]);
  const close = () => ui.openCompile(false);
  const set = (p: Partial<CompileOptions>) => setO({ ...o, ...p });
  const copy = async () => {
    await navigator.clipboard.writeText(toPlainText(markdown));
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <div className="modal-scrim" onClick={close}>
      <div className="modal compile" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>Export story</h2>
          <button className="icon" onClick={close}>✕</button>
        </header>
        <div className="modal-body">
          <div className="compile-opts">
            <label className="field small">
              <span>Include</span>
              <select value={o.include} onChange={(e) => set({ include: e.target.value as CompileOptions['include'] })}>
                <option value="all">The whole story: your parts and the AI's</option>
                <option value="story">Only the AI's replies</option>
              </select>
            </label>
            <label className="switch small"><input type="checkbox" checked={o.stripNotes} onChange={(e) => set({ stripNotes: e.target.checked })} /> Remove [bracketed notes]</label>
            <label className="switch small"><input type="checkbox" checked={o.chapters} onChange={(e) => set({ chapters: e.target.checked })} /> Start a chapter at each scene break (***)</label>
          </div>
          <div className="row">
            <button onClick={() => download(fileName(title, 'docx'), toDocx(markdown))}>Word (.docx)</button>
            <button className="ghost" onClick={() => download(fileName(title, 'md'), markdown, 'text/markdown')}>Markdown</button>
            <button className="ghost" onClick={() => download(fileName(title, 'txt'), toPlainText(markdown))}>Text</button>
            <button className="ghost" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
            <span className="muted small">{words.toLocaleString()} words</span>
          </div>
          <div className="compile-preview markdown" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </div>
    </div>
  );
}
