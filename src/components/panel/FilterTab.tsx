import { useMemo, useState } from 'react';
import { clichesIn, DEFAULT_AUTO_LIMIT, filterMode } from '../../features/filter/filter';
import { compileRules } from '../../features/filter/rules';
import { currentChat, saveSettings, updateChat, useStore } from '../../store/store';
import { activeSwipe, type FilterMode } from '../../types';

const MODES: [FilterMode, string, string][] = [
  ['off', 'Off', 'No checking.'],
  ['highlight', 'Highlight', 'Marks stock phrases in replies. Free: no AI involved.'],
  ['suggest', 'Suggest fixes', 'After each reply, a quick model rewrites the sentences they’re in, as cards you accept.'],
  ['auto', 'Fix automatically', 'Same, but applied straight away. Undo any of them from Suggestions.'],
];

export function FilterTab() {
  const chat = useStore((s) => currentChat(s));
  const messages = useStore((s) => s.messages);
  const userRules = useStore((s) => s.settings.filterRules);
  const userLists = useStore((s) => s.settings.filterLists);
  const [q, setQ] = useState('');
  const { rules, errors } = useMemo(() => compileRules(userRules, userLists), [userRules, userLists]);
  // How often each rule fires in this story's replies (all rules, so switched-off ones show counts too).
  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const m of messages) {
      if (m.role !== 'assistant') continue;
      for (const h of clichesIn(activeSwipe(m).content, { ...chat!, filter: { mode: 'highlight' } })) c.set(h.ruleId, (c.get(h.ruleId) ?? 0) + 1);
    }
    return c;
  }, [messages, chat, rules]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!chat) return null;
  const mode = filterMode(chat);
  const disabled = chat.filter?.disabled ?? [];
  const setFilter = (patch: Partial<NonNullable<typeof chat.filter>>) => updateChat({ filter: { mode, ...chat.filter, ...patch } });
  const total = [...counts].filter(([id]) => !disabled.includes(id)).reduce((a, [, n]) => a + n, 0);
  const shown = rules
    .filter((r) => !q || `${r.id} ${r.description}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0));
  return (
    <div className="panel-body">
      <section>
        <p className="muted small">Catches the stock phrases that make AI prose sound machine-written (“a shiver ran down her spine”, “eyes sparkling with mischief”).</p>
        {MODES.map(([v, label, hint]) => (
          <label key={v} className="switch small radio">
            <input type="radio" name="filter-mode" checked={mode === v} onChange={() => setFilter({ mode: v })} />
            <span><b>{label}</b> <span className="muted">{hint}</span></span>
          </label>
        ))}
        <p className="muted small">In any mode, the “N clichés” chip under a reply lists them, with Fix buttons.</p>
        {mode === 'auto' && (
          <label className="field small">
            <span>Most fixes per reply</span>
            <input type="number" min={1} max={12} value={chat.filter?.autoLimit ?? DEFAULT_AUTO_LIMIT} onChange={(e) => setFilter({ autoLimit: Math.max(1, Number(e.target.value) || DEFAULT_AUTO_LIMIT) })} />
          </label>
        )}
      </section>

      <section>
        <h3>Rules <span className="muted small">{total} hit{total === 1 ? '' : 's'} in this story</span></h3>
        <input placeholder="Search rules" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="rule-list">
          {shown.map((r) => {
            const n = counts.get(r.id) ?? 0;
            return (
              <label key={r.id} className="switch small" title={r.patterns.map((p) => p.source).join('\n').slice(0, 600)}>
                <input type="checkbox" checked={!disabled.includes(r.id)} onChange={(e) => setFilter({ disabled: e.target.checked ? disabled.filter((x) => x !== r.id) : [...disabled, r.id] })} />
                <span className="grow">{r.description}{!r.builtIn && <span className="chip">yours</span>}</span>
                {n > 0 && <span className="chip">{n}</span>}
              </label>
            );
          })}
        </div>
        <p className="muted small">Switching a rule off applies to this story only.</p>
      </section>

      <details>
        <summary>Your own rules</summary>
        <p className="muted small">
          One rule per block: a header line <code>#! [my-rule] What it catches</code>, then one or more <code>/regex/i</code> lines.
          Word lists like <code>EYES== eyes|gaze</code> go in the second box and are used as <code>%EYES%</code>. Built-in lists: SUBJ, OBJ, POSS, SELF, EMOTION, SENSATION.
        </p>
        <textarea rows={6} defaultValue={userRules ?? ''} placeholder={'#! [my-rule] Breath catching\n/\\b%POSS% breath (?:caught|hitched)\\b/i'} onBlur={(e) => saveSettings({ filterRules: e.target.value })} />
        <textarea rows={3} defaultValue={userLists ?? ''} placeholder="EYES== eyes|gaze" onBlur={(e) => saveSettings({ filterLists: e.target.value })} />
        {errors.length > 0 && <ul className="msg-error small">{errors.slice(0, 8).map((x, i) => <li key={i}>{x}</li>)}</ul>}
      </details>
    </div>
  );
}
