// Plain-text views of a story for side jobs (summaries, suggested updates, Helpers, Proofread).
import { codexBooksFor } from '../store/store';
import { activeSwipe, type Chat, type Message } from '../types';
import { useStore } from '../store/store';

export const msgText = (m: Message) => activeSwipe(m).content.trim();

/** "You:" / "Story:" transcript of messages. */
export function transcript(msgs: Message[]): string {
  return msgs
    .filter((m) => msgText(m))
    .map((m) => `${m.role === 'user' ? 'You' : m.role === 'assistant' ? 'Story' : 'Note'}: ${msgText(m)}`)
    .join('\n\n');
}

export interface SetupPart {
  id: 'system' | 'background' | 'steering' | 'outline' | 'tags' | 'styles' | 'stylesOff' | 'codex' | 'summary';
  label: string;
  text: string;
  /** Codex entries one by one, so a budget can keep the relevant ones. */
  items?: { text: string; name: string; keys: string[] }[];
}

/** The story's setup in named parts: system prompt, Background, Steering, Outline, Style, Codex, summary. */
export function setupParts(chat: Chat, opts: { codex?: 'full' | 'names' | 'none'; summary?: boolean; stylesOff?: boolean } = {}): SetupPart[] {
  const parts: SetupPart[] = [];
  const add = (id: SetupPart['id'], label: string, text: string, items?: SetupPart['items']) => { if (text.trim()) parts.push({ id, label, text: text.trim(), items }); };
  add('system', 'System prompt', chat.systemPrompt);
  add('background', 'Background (always sent at the top)', chat.writing.background);
  add('steering', 'Steering (sent just before each reply)', chat.writing.steering);
  if (chat.outline?.text.trim()) add('outline', `Outline${chat.outline.off ? ' (switched off)' : ''} (the line starting with > is the current beat)`, chat.outline.text);
  if (chat.tags?.length) add('tags', 'Story tags', chat.tags.join('; '));
  const styles = useStore.getState().settings.styles ?? [];
  const on = styles.filter((m) => chat.styleIds?.includes(m.id));
  if (on.length) add('styles', 'Style modules switched on', on.map((m) => `### ${m.name}\n${m.text}`).join('\n\n'));
  const off = styles.filter((m) => !chat.styleIds?.includes(m.id));
  if (off.length && (opts.stylesOff ?? opts.codex === 'full')) add('stylesOff', 'Other Style modules in the Library (off for this story)', off.map((m) => `- ${m.name}: ${m.text.slice(0, 120).replace(/\s+/g, ' ')}…`).join('\n'));
  const mode = opts.codex ?? 'full';
  if (mode !== 'none') {
    const entries = codexBooksFor(chat, useStore.getState()).flatMap((b) => b.entries);
    const items = entries.map((e) => ({
      name: e.name,
      keys: e.keys,
      text: mode === 'names' ? `- ${e.name} [${e.keys.join(', ')}]: ${e.text.slice(0, 160).replace(/\s+/g, ' ')}${e.text.length > 160 ? '…' : ''}` : `- ${e.name} (triggers: ${e.keys.join(', ') || 'none'}${e.alwaysOn ? ', always on' : ''}): ${e.text}`,
    }));
    if (items.length) add('codex', 'Codex entries', items.map((i) => i.text).join('\n'), items);
  }
  if (opts.summary !== false && chat.summary?.length) add('summary', 'Story so far', chat.summary.map((p) => p.text).join('\n\n'));
  return parts;
}

/** The story's setup as one block of text: system prompt, Background, Steering, Codex, summary. */
export function setupText(chat: Chat, opts: { codex?: 'full' | 'names' | 'none'; summary?: boolean } = {}): string {
  return setupParts(chat, opts).map((p) => `## ${p.label}\n${p.text}`).join('\n\n');
}
