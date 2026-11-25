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

/** The story's setup as one block of text: system prompt, Background, Steering, Codex, summary. */
export function setupText(chat: Chat, opts: { codex?: 'full' | 'names' | 'none'; summary?: boolean } = {}): string {
  const parts: string[] = [];
  if (chat.systemPrompt.trim()) parts.push(`## System prompt\n${chat.systemPrompt.trim()}`);
  if (chat.writing.background.trim()) parts.push(`## Background (always sent at the top)\n${chat.writing.background.trim()}`);
  if (chat.writing.steering.trim()) parts.push(`## Steering (sent just before each reply)\n${chat.writing.steering.trim()}`);
  const styles = useStore.getState().settings.styles ?? [];
  const on = styles.filter((m) => chat.styleIds?.includes(m.id));
  if (on.length) parts.push(`## Style modules switched on\n${on.map((m) => `### ${m.name}\n${m.text}`).join('\n\n')}`);
  const off = styles.filter((m) => !chat.styleIds?.includes(m.id));
  if (off.length && opts.codex === 'full') parts.push(`## Other Style modules in the Library (off for this story)\n${off.map((m) => `- ${m.name}: ${m.text.slice(0, 120).replace(/\s+/g, ' ')}…`).join('\n')}`);
  const mode = opts.codex ?? 'full';
  if (mode !== 'none') {
    const books = codexBooksFor(chat, useStore.getState());
    const lines = books.flatMap((b) => b.entries.map((e) => (mode === 'names' ? `- ${e.name} [${e.keys.join(', ')}]: ${e.text.slice(0, 160).replace(/\s+/g, ' ')}${e.text.length > 160 ? '…' : ''}` : `- ${e.name} (triggers: ${e.keys.join(', ') || 'none'}${e.alwaysOn ? ', always on' : ''}): ${e.text}`)));
    if (lines.length) parts.push(`## Codex entries\n${lines.join('\n')}`);
  }
  if (opts.summary !== false && chat.summary?.length) parts.push(`## Story so far\n${chat.summary.map((p) => p.text).join('\n\n')}`);
  return parts.join('\n\n');
}
