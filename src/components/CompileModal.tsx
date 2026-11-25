import { useEffect, useMemo, useState } from 'react';
import { proofreadStory, stopStoryProofread, textHash } from '../features/rewrite';
import { activeSwipe } from '../types';
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
          <StoryProofSection include={o.include} onReview={() => { close(); ui.openPanel('suggestions'); }} />
          <div className="compile-preview markdown" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </div>
    </div>
  );
}

/** "Proofread before publishing": every message, in the background, as correction cards. */
function StoryProofSection({ include, onReview }: { include: CompileOptions['include']; onReview: () => void }) {
  const chat = useStore((s) => currentChat(s));
  const messages = useStore((s) => s.messages);
  const run = useStore((s) => (s.storyProof?.chatId === s.currentChatId ? s.storyProof : undefined));
  const pending = useStore((s) => s.suggestions.filter((x) => x.chatId === s.currentChatId && x.status === 'pending' && x.source === 'proofread').length);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!run?.running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [run?.running]);
  if (!chat) return null;
  const all = messages.filter((m) => m.role !== 'system' && (include === 'all' || m.role === 'assistant') && activeSwipe(m).content.trim());
  const left = all.filter((m) => chat.proofChecked?.[m.id] !== textHash(activeSwipe(m).content)).length;
  const mins = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  return (
    <details className="story-proof" open={!!run}>
      <summary><b>Proofread before publishing</b> <span className="muted small">{left ? `${left} of ${all.length} messages to check` : 'all messages checked'}</span></summary>
      <p className="muted small">
        Checks every message for typos, spelling, grammar, punctuation and continuity slips (names, facts, who is where), with the story around it for context.
        Each message takes about a minute on the strong model, so a long story can take an hour; it runs in the background, so you can close this and keep reading.
        Fixes come as cards under each message and in Suggestions. Messages already checked and unchanged are skipped, so you can stop and carry on later.
      </p>
      {run && (
        <p className="small">
          {run.running && <span className="spinner" />} Checked {run.done} of {run.total} · {run.cards} correction{run.cards === 1 ? '' : 's'}
          {run.running && ` · ${mins(now - run.startedAt)}`}
          {run.running && run.done > 0 && ` · about ${mins(((now - run.startedAt) / run.done) * (run.total - run.done))} left`}
          {run.note && <span className="muted"> · {run.note}</span>}
        </p>
      )}
      <div className="row">
        {run?.running ? (
          <button onClick={stopStoryProofread}>Stop</button>
        ) : (
          <>
            <button className="primary" disabled={!left} onClick={() => void proofreadStory(chat.id, include)}>{left < all.length && left ? `Carry on (${left} left)` : 'Proofread the whole story'}</button>
            {left < all.length && <button className="ghost" onClick={() => confirm('Check every message again, including ones already checked?') && void proofreadStory(chat.id, include, true)}>Check everything again</button>}
          </>
        )}
        {pending > 0 && <button className="ghost" onClick={onReview}>Review {pending} correction{pending === 1 ? '' : 's'}</button>}
      </div>
    </details>
  );
}
