// Suggested updates: after enough new story, a quick model proposes changes to the Codex and
// Background (a new character, a fact that changed, an entry that's out of date) as cards.
import { parseJson, runJob } from '../ai/jobs';
import { countWords, LENGTH_ORDER, type LengthBucket } from '../context/length';
import { repo } from '../db/db';
import { newEntry } from '../store/codexStore';
import { codexBooksFor, DEFAULT_UPDATES_EVERY, replyHooks, updateChat, useStore } from '../store/store';
import { reject, addSuggestions, OWN_BOOK } from '../store/suggestions';
import type { Chat, Message, StyleModule, Suggestion } from '../types';
import { setupText, transcript } from './storyText';

export type Proposal =
  | { type: 'codex-add'; name: string; keys?: string[]; text: string; reason?: string }
  | { type: 'codex-edit'; entry: string; text: string; keys?: string[]; reason?: string }
  | { type: 'codex-remove'; entry: string; reason?: string }
  | { type: 'background' | 'steering' | 'system' | 'title'; text: string; reason?: string }
  | { type: 'length'; value: string; reason?: string }
  | { type: 'style-add'; name: string; text: string; reason?: string }
  | { type: 'style-edit'; style: string; text: string; reason?: string }
  | { type: 'style-on' | 'style-off'; style: string; reason?: string }
  | { type: 'tags'; tags: string[]; reason?: string };

const SYSTEM = `You maintain the notes for a piece of fiction: a Background (always-true facts) and a Codex (entries for characters, places, items and rules, each with trigger words).
Read the new story text and propose only changes that matter for writing what comes next: a new named character, place or item that will likely come up again; a lasting fact that changed (a relationship, an injury, a location, a secret revealed); an entry that is now wrong. Ignore passing details and anything already covered.
Write entry text in the present tense, as compact notes (1 to 4 sentences). Trigger words are the names and nicknames people would use in the story, lowercase is fine.
Reply with JSON only, no other text:
{"suggestions":[
 {"type":"codex-add","name":"...","keys":["..."],"text":"...","reason":"..."},
 {"type":"codex-edit","entry":"<existing entry name>","text":"<full new text>","keys":["..."],"reason":"..."},
 {"type":"codex-remove","entry":"<existing entry name>","reason":"..."},
 {"type":"background","text":"<full new Background>","reason":"..."}
]}
At most 5 suggestions. If nothing needs changing, reply {"suggestions":[]}.`;

/** Runs a check on the story since the last one (or on the given messages). Returns how many cards it made. */
export async function checkForUpdates(chatId: string): Promise<number> {
  const s = useStore.getState();
  const chat = s.chats.find((c) => c.id === chatId);
  if (!chat) return 0;
  const all = chatId === s.currentChatId ? s.messages : await repo.messages(chatId);
  const from = chat.checkedUpTo ? all.findIndex((m) => m.id === chat.checkedUpTo) + 1 : 0;
  const msgs = all.slice(Math.max(0, from));
  // Keep the newest ~8,000 words.
  let words = 0;
  const picked: Message[] = [];
  for (const m of [...msgs].reverse()) {
    words += countWords(m.swipes[m.activeSwipe]?.content ?? '');
    if (words > 8000 && picked.length) break;
    picked.unshift(m);
  }
  const text = transcript(picked);
  if (!text) return 0;
  const res = await runJob({
    job: 'updates',
    chat,
    label: 'Checking for note updates',
    maxTokens: 1500,
    temperature: 0.3,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `# Current notes\n${setupText(chat, { codex: 'full', summary: false }) || '(none yet)'}\n\n# New story text\n${text}` },
    ],
  });
  await updateChat({ checkedUpTo: all.at(-1)?.id, wordsSinceCheck: 0 }, chat.id);
  const props = parseJson<{ suggestions?: Proposal[] }>(res.text)?.suggestions ?? [];
  const cards = toSuggestions(useStore.getState().chats.find((c) => c.id === chatId) ?? chat, props);
  // A newer suggestion for the same entry replaces an older one still waiting.
  const edited = new Set(cards.flatMap((c) => (c.target.kind === 'codex-edit' ? [c.target.entryId] : [])));
  for (const x of await repo.byChat('suggestions', chatId)) if (x.status === 'pending' && x.target.kind === 'codex-edit' && edited.has(x.target.entryId)) await reject(x.id);
  return (await addSuggestions(chat.id, cards)).length;
}

type NewSuggestion = Omit<Suggestion, 'id' | 'chatId' | 'status' | 'createdAt'>;

/** Turns model proposals into suggestion cards, skipping duplicates and anything malformed. */
export function toSuggestions(chat: Chat, props: Proposal[], source: Suggestion['source'] = 'updates'): NewSuggestion[] {
  const s = useStore.getState();
  const books = codexBooksFor(chat, s);
  const find = (name: string) => {
    const n = name?.trim().toLowerCase();
    for (const b of books) for (const e of b.entries) if (e.name.trim().toLowerCase() === n) return { b, e };
    return undefined;
  };
  const pendingNames = new Set(s.suggestions.filter((x) => x.chatId === chat.id && x.status === 'pending' && x.target.kind === 'codex-add').map((x) => (x.target as { entry: { name: string } }).entry.name.toLowerCase()));
  const out: NewSuggestion[] = [];
  for (const p of Array.isArray(props) ? props.slice(0, 8) : []) {
    if (!p || typeof p !== 'object') continue;
    const keys = Array.isArray((p as { keys?: unknown }).keys) ? ((p as { keys: unknown[] }).keys.filter((k) => typeof k === 'string') as string[]) : undefined;
    if (p.type === 'codex-add' && p.name && p.text) {
      const hit = find(p.name);
      if (hit) {
        if (hit.e.text.trim() !== p.text.trim()) out.push({ source, target: { kind: 'codex-edit', bookId: hit.b.id, entryId: hit.e.id, entry: { ...hit.e, keys: keys?.length ? keys : hit.e.keys } }, before: hit.e.text, after: p.text, reason: p.reason });
      } else if (!pendingNames.has(p.name.toLowerCase())) {
        pendingNames.add(p.name.toLowerCase());
        out.push({ source, target: { kind: 'codex-add', bookId: OWN_BOOK, entry: newEntry({ name: p.name.trim(), keys: keys?.length ? keys : [p.name.trim()], text: p.text }) }, before: '', after: p.text, reason: p.reason });
      }
    } else if (p.type === 'codex-edit' && p.entry && p.text) {
      const hit = find(p.entry);
      if (hit && hit.e.text.trim() !== p.text.trim()) out.push({ source, target: { kind: 'codex-edit', bookId: hit.b.id, entryId: hit.e.id, entry: { ...hit.e, keys: keys?.length ? keys : hit.e.keys } }, before: hit.e.text, after: p.text, reason: p.reason });
    } else if (p.type === 'codex-remove' && p.entry) {
      const hit = find(p.entry);
      if (hit) out.push({ source, target: { kind: 'codex-remove', bookId: hit.b.id, entryId: hit.e.id }, before: hit.e.text, after: '', reason: p.reason });
    } else if ((p.type === 'background' || p.type === 'steering') && p.text && p.text.trim() !== chat.writing[p.type].trim()) {
      out.push({ source, target: { kind: p.type }, before: chat.writing[p.type], after: p.text, reason: p.reason });
    } else if (p.type === 'system' && p.text && p.text.trim() !== chat.systemPrompt.trim()) {
      out.push({ source, target: { kind: 'system' }, before: chat.systemPrompt, after: p.text, reason: p.reason });
    } else if (p.type === 'title' && p.text && p.text.trim() !== chat.title) {
      out.push({ source, target: { kind: 'title' }, before: chat.title, after: p.text.trim().slice(0, 80), reason: p.reason });
    } else if (p.type === 'style-add' && p.name && p.text) {
      out.push({ source, target: { kind: 'style-add', module: { id: newEntry().id, name: p.name.trim() } as StyleModule }, before: '', after: p.text, reason: p.reason });
    } else if ((p.type === 'style-edit' || p.type === 'style-on' || p.type === 'style-off') && p.style) {
      const mod = (s.settings.styles ?? []).find((m) => m.name.trim().toLowerCase() === p.style.trim().toLowerCase());
      if (!mod) continue;
      if (p.type === 'style-edit' && p.text && p.text.trim() !== mod.text.trim()) out.push({ source, target: { kind: 'style-edit', styleId: mod.id, name: mod.name }, before: mod.text, after: p.text, reason: p.reason });
      if (p.type !== 'style-edit' && (p.type === 'style-on') !== !!chat.styleIds?.includes(mod.id)) out.push({ source, target: { kind: 'style-toggle', styleId: mod.id, name: mod.name, on: p.type === 'style-on' }, before: '', after: '', reason: p.reason });
    } else if (p.type === 'tags' && Array.isArray(p.tags)) {
      const tags = [...new Set(p.tags.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim().slice(0, 40)))].slice(0, 20);
      if (tags.length && tags.join('; ') !== (chat.tags ?? []).join('; ')) out.push({ source, target: { kind: 'tags', tags }, before: (chat.tags ?? []).join('; '), after: tags.join('; '), reason: p.reason });
    } else if (p.type === 'length' && LENGTH_ORDER.includes(p.value as LengthBucket) && p.value !== chat.length) {
      out.push({ source, target: { kind: 'length', value: p.value }, before: '', after: p.value, reason: p.reason });
    }
  }
  return out;
}

// After each reply: count new words and check once enough story has built up.
replyHooks.push(async ({ chatId, newText }) => {
  const chat = useStore.getState().chats.find((c) => c.id === chatId);
  if (!chat) return;
  const every = chat.updatesEvery ?? DEFAULT_UPDATES_EVERY;
  if (every <= 0) return;
  const words = (chat.wordsSinceCheck ?? 0) + countWords(newText);
  if (every === 1 || words >= every) await checkForUpdates(chatId);
  else await updateChat({ wordsSinceCheck: words }, chatId);
});
