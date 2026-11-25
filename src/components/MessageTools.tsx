// Per-message writing tools: Cliché Filter marks, the Rewrite / Proofread box, and the
// suggestion cards for edits to this message, shown right under it.
import { useEffect, useMemo, useRef, useState } from 'react';
import { fixCliches } from '../features/filter/filter';
import { locate } from './messageHooks';
import type { Hit } from '../features/filter/rules';
import { proofread, rewriteMessage, rewritePassage } from '../features/rewrite';
import { ui, useStore } from '../store/store';
import { activeSwipe, type Message } from '../types';
import { SuggestionCard } from './panel/SuggestionCard';

// ---------- Cliché chip ----------

export function ClicheChip({ m, hits }: { m: Message; hits: Hit[] }) {
  const chatId = useStore((s) => s.currentChatId);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!hits.length || !chatId) return null;
  const fix = async (which: Hit[]) => {
    setBusy(true);
    try {
      await fixCliches(chatId, m.id, which);
    } catch (e) {
      useStore.setState({ error: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="cliche">
      <button className="chip cliche-chip" onClick={() => setOpen(!open)} title="Cliché Filter">
        {hits.length} cliché{hits.length === 1 ? '' : 's'} {open ? '▾' : '▸'}
      </button>
      {open && (
        <div className="cliche-list">
          {hits.map((h, i) => (
            <div key={i} className="cliche-item">
              <span><mark>{h.text}</mark> <span className="muted small">{h.description}</span></span>
              <button className="small ghost" disabled={busy} onClick={() => fix([h])}>Fix</button>
            </div>
          ))}
          <div className="row">
            <button className="small" disabled={busy} onClick={() => fix(hits)}>{busy ? 'Fixing…' : 'Fix all'}</button>
            <button className="small ghost" onClick={() => ui.openPanel('filter')}>Filter settings</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Rewrite / Proofread box ----------

export function RewriteBox({ m }: { m: Message }) {
  const target = useStore((s) => s.rewriteTarget);
  const chatId = useStore((s) => s.currentChatId);
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState<'' | 'rewrite' | 'proofread'>('');
  const [note, setNote] = useState('');
  const open = !!target && target.messageId === m.id;
  // Bring the box into view (on phones it can open below the fold). Braces: no return value.
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) box.current?.scrollIntoView({ block: 'nearest' });
  }, [open]);
  if (!target || !open || !chatId) return null;
  const content = activeSwipe(m).content;
  const part = target.from !== undefined && target.to !== undefined ? { from: target.from, to: target.to } : undefined;
  const quote = part ? content.slice(part.from, part.to) : '';

  const run = async (what: 'rewrite' | 'proofread') => {
    setBusy(what);
    setNote('');
    try {
      if (what === 'proofread') {
        const n = await proofread(chatId, m.id, part);
        if (!n) setNote('No problems found.');
        else ui.openRewrite(undefined);
      } else if (part) {
        const card = await rewritePassage({ chatId, messageId: m.id, ...part, feedback: feedback.trim() || 'Improve this passage.' });
        if (card) ui.openRewrite(undefined);
        else setNote('The model gave back the same text. Try a more specific instruction.');
      } else {
        ui.openRewrite(undefined);
        await rewriteMessage(chatId, m.id, feedback.trim() || 'Improve this.');
      }
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="rewrite-box" ref={box}>
      {quote && <blockquote className="rewrite-quote">{quote.length > 400 ? `${quote.slice(0, 400)}…` : quote}</blockquote>}
      <textarea
        autoFocus rows={3} value={feedback} onChange={(e) => setFeedback(e.target.value)}
        placeholder={part ? 'What should change? e.g. “less flowery”, “make her angrier”' : 'What should change? e.g. “slower, more dialogue”. Becomes a new version.'}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void run('rewrite');
          }
          if (e.key === 'Escape') ui.openRewrite(undefined);
        }}
      />
      <div className="row">
        <button className="small" disabled={!!busy} onClick={() => run('rewrite')}>{busy === 'rewrite' ? 'Rewriting…' : 'Rewrite'}</button>
        <button className="small ghost" disabled={!!busy} onClick={() => run('proofread')} title={m.role === 'user' ? 'Consistency, facts, spelling and grammar' : 'Consistency and facts against your notes and the story'}>
          {busy === 'proofread' ? 'Checking…' : 'Proofread'}
        </button>
        <button className="small ghost" onClick={() => ui.openRewrite(undefined)}>Cancel</button>
        {note && <span className="muted small">{note}</span>}
      </div>
    </div>
  );
}

// ---------- Cards for this message ----------

export function MessageCards({ m }: { m: Message }) {
  const all = useStore((s) => s.suggestions);
  const cards = useMemo(
    () => all.filter((x) => x.status === 'pending' && x.target.kind === 'passage' && x.target.messageId === m.id).sort((a, b) => a.createdAt - b.createdAt),
    [all, m.id],
  );
  const [open, setOpen] = useState(true);
  if (!cards.length) return null;
  return (
    <div className="msg-cards">
      <button className="chip" onClick={() => setOpen(!open)}>{cards.length} suggested edit{cards.length === 1 ? '' : 's'} {open ? '▾' : '▸'}</button>
      {open && cards.map((x) => <SuggestionCard key={x.id} x={x} />)}
    </div>
  );
}

// ---------- Selection toolbar ----------

export function SelectionToolbar() {
  const [pos, setPos] = useState<{ x: number; y: number; messageId: string; from: number; to: number }>();
  const busy = useStore((s) => !!s.streamingId);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const check = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const sel = getSelection();
        if (!sel || sel.isCollapsed || !sel.rangeCount) return setPos(undefined);
        const range = sel.getRangeAt(0);
        const el = (range.commonAncestorContainer instanceof Element ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement)?.closest('.msg-body');
        const id = el?.closest<HTMLElement>('[data-mid]')?.dataset.mid;
        const m = id && useStore.getState().messages.find((x) => x.id === id);
        if (!m) return setPos(undefined);
        const source = activeSwipe(m).content;
        // Where the selection starts in the rendered text, scaled to the source, to tell repeats apart.
        const pre = document.createRange();
        pre.setStart(el!, 0);
        pre.setEnd(range.startContainer, range.startOffset);
        const shown = el!.textContent?.length || 1;
        const where = locate(source, sel.toString(), Math.round((pre.toString().length / shown) * source.length));
        if (!where) return setPos(undefined);
        const r = range.getBoundingClientRect();
        // Phones show their own copy/paste menu above a selection, so go below it there.
        const below = matchMedia('(pointer: coarse)').matches;
        setPos({ x: r.left + r.width / 2, y: below ? r.bottom + 56 : r.top, messageId: id, ...where });
      }, 250);
    };
    document.addEventListener('selectionchange', check);
    return () => {
      document.removeEventListener('selectionchange', check);
      clearTimeout(t);
    };
  }, []);
  if (!pos || busy) return null;
  const open = () => {
    ui.openRewrite({ messageId: pos.messageId, from: pos.from, to: pos.to });
    getSelection()?.removeAllRanges();
    setPos(undefined);
  };
  return (
    <div className="sel-bar" style={{ left: Math.max(70, Math.min(pos.x, innerWidth - 70)), top: Math.max(8, pos.y - 44) }} onMouseDown={(e) => e.preventDefault()}>
      <button className="small" onClick={open}>Rewrite or proofread…</button>
    </div>
  );
}
