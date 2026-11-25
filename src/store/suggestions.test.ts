import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { codexBlocks, matchKey, tagsBlocks, triggeredEntries } from '../context/codex';
import { splitReply } from '../features/helper';
import { nextStretch } from '../features/summary';
import { toSuggestions } from '../features/updates';
import type { CodexEntry, Message } from '../types';
import { ownBook } from './codexStore';
import { newChat, updateChat, useStore } from './store';
import { accept, addSuggestions, OWN_BOOK, reject, undo } from './suggestions';

const entry = (p: Partial<CodexEntry>): CodexEntry => ({ id: p.name ?? 'x', name: 'x', keys: [], text: 't', enabled: true, ...p });

beforeEach(async () => {
  useStore.setState({ ready: true, chats: [], codex: [], suggestions: [], messages: [], currentChatId: undefined });
  await newChat();
});
const chat = () => useStore.getState().chats[0];

describe('Codex triggers', () => {
  it('matches whole words case-insensitively, and regex keys', () => {
    expect(matchKey(entry({ keys: ['Rell'] }), 'captain rell waved')).toBe('Rell');
    expect(matchKey(entry({ keys: ['Rell'] }), 'Farrelly')).toBeUndefined();
    expect(matchKey(entry({ keys: ['/kess?ler/i'] }), 'the Kesler crates')).toBe('/kess?ler/i');
    expect(matchKey(entry({ keys: ['Zoë'] }), 'and Zoë said')).toBe('Zoë');
  });
  it('keeps always-on and higher-priority entries within the budget', () => {
    const book = { id: 'b', name: 'B', entries: [entry({ name: 'a', keys: ['a'], text: 'x'.repeat(300) }), entry({ name: 'b', keys: ['b'], priority: 5, text: 'x'.repeat(300) }), entry({ name: 'c', alwaysOn: true, text: 'short' })], createdAt: 0, updatedAt: 0 };
    const { hits, dropped } = triggeredEntries([book], 'a b', 120);
    expect(hits.map((h) => h.entry.name)).toEqual(['b', 'c']);
    expect(dropped.map((h) => h.entry.name)).toEqual(['a']);
    expect(codexBlocks(hits)[0].label).toBe('b (b)');
  });
});

describe('suggestions', () => {
  it('accepts and undoes a Background change', async () => {
    const [x] = await addSuggestions(chat().id, [{ source: 'helper', target: { kind: 'background' }, before: '', after: 'New world' }]);
    await accept(x.id);
    expect(chat().writing.background).toBe('New world');
    expect(chat().writing.enabled).toBe(true);
    await undo(x.id);
    expect(chat().writing.background).toBe('');
  });
  it('creates the story Codex on the first accepted entry, and undo removes the entry', async () => {
    const e = entry({ id: 'e1', name: 'Rell', keys: ['Rell'], text: 'old' });
    const [x] = await addSuggestions(chat().id, [{ source: 'updates', target: { kind: 'codex-add', bookId: OWN_BOOK, entry: e }, before: '', after: 'Harbour captain' }]);
    await accept(x.id, 'Edited text');
    const book = useStore.getState().codex.find((b) => b.id === chat().codexId)!;
    expect(book.entries).toEqual([{ ...e, text: 'Edited text' }]);
    await undo(x.id);
    expect(useStore.getState().codex.find((b) => b.id === chat().codexId)!.entries).toEqual([]);
  });
  it('reject leaves things alone', async () => {
    const [x] = await addSuggestions(chat().id, [{ source: 'helper', target: { kind: 'title' }, before: 'New chat', after: 'Other' }]);
    await reject(x.id);
    expect(chat().title).toBe('New chat');
    expect(useStore.getState().suggestions[0].status).toBe('rejected');
  });
});

describe('model proposals', () => {
  it('turns an add for an existing entry into an edit, and skips no-ops', async () => {
    const book = await ownBook(chat());
    await updateChat({ codexId: book.id });
    useStore.setState({ codex: [{ ...book, entries: [entry({ id: 'r', name: 'Captain Rell', keys: ['Rell'], text: 'Harbourmaster.' })] }] });
    const out = toSuggestions(chat(), [
      { type: 'codex-add', name: 'captain rell', text: 'Harbourmaster with a scar.' },
      { type: 'codex-add', name: 'Tobias Finch', keys: ['Finch'], text: 'Keeps the harbour books.' },
      { type: 'background', text: '' },
      { type: 'length', value: 'scene' },
      { type: 'length', value: 'nonsense' },
      { type: 'codex-remove', entry: 'Nobody' },
    ]);
    expect(out.map((x) => x.target.kind)).toEqual(['codex-edit', 'codex-add', 'length']);
  });
  it('splits a Helper reply into words and a changes block', () => {
    const r = splitReply('Here you go.\n\n```changes\n[{"type":"title","text":"Harbour Lights"}]\n```');
    expect(r.say).toBe('Here you go.');
    expect(r.changes).toEqual([{ type: 'title', text: 'Harbour Lights' }]);
    expect(splitReply('No changes.').changes).toEqual([]);
  });
});

describe('auto-summary stretch', () => {
  const msg = (i: number, words: number, role: 'user' | 'assistant' = i % 2 ? 'assistant' : 'user'): Message => ({ id: `m${i}`, chatId: 'c', order: i, role, activeSwipe: 0, swipes: [{ content: 'word '.repeat(words), createdAt: 0 }] });
  it('takes the oldest messages up to a reply past ~3,000 words, keeping the newest six', () => {
    const msgs = Array.from({ length: 20 }, (_, i) => msg(i, 500));
    const s = nextStretch(msgs);
    expect(s[0].id).toBe('m0');
    expect(s.at(-1)!.role).toBe('assistant');
    expect(s.length).toBe(6);
  });
  it('skips messages already summarised and does nothing when too little is left', () => {
    const msgs = Array.from({ length: 8 }, (_, i) => ({ ...msg(i, 40), condensed: i < 1 }));
    expect(nextStretch(msgs)).toEqual([]);
  });
});

describe('passage cards', () => {
  const put = (content: string) => {
    const m = { id: 'm1', chatId: chat().id, role: 'assistant', createdAt: 0, order: 0, activeSwipe: 0, swipes: [{ content, createdAt: 0 }] } as Message;
    useStore.setState({ messages: [m] });
  };
  const text = () => useStore.getState().messages[0].swipes[0].content;
  const card = (from: number, before: string, after: string) => ({ source: 'proofread' as const, target: { kind: 'passage' as const, messageId: 'm1', swipe: 0, from, to: from + before.length }, before, after });

  it('changes the right copy of repeated text, shifts later cards, and undoes in place', async () => {
    put('its fine. She said its late. its');
    const [a, b] = await addSuggestions(chat().id, [card(0, 'its', 'it is'), card(18, 'its', "it's")]);
    await accept(a.id);
    expect(text()).toBe('it is fine. She said its late. its');
    await accept(b.id);
    expect(text()).toBe("it is fine. She said it's late. its");
    await undo(a.id);
    expect(text()).toBe("its fine. She said it's late. its");
    await undo(b.id);
    expect(text()).toBe('its fine. She said its late. its');
  });

  it('says why when the text is gone', async () => {
    put('Hello there.');
    const [a] = await addSuggestions(chat().id, [card(0, 'Goodbye', 'Bye')]);
    await accept(a.id);
    const x = useStore.getState().suggestions.find((s) => s.id === a.id)!;
    expect(x.status).toBe('rejected');
    expect(x.failed).toMatch(/edited/);
  });
});

describe('story tags', () => {
  it('turns a helper proposal into a card and applies it as a list', async () => {
    const [c] = toSuggestions(chat(), [{ type: 'tags', tags: ['noir', ' slow burn ', 'noir'] }], 'helper');
    expect(c.after).toBe('noir; slow burn');
    const [x] = await addSuggestions(chat().id, [c]);
    await accept(x.id);
    expect(chat().tags).toEqual(['noir', 'slow burn']);
    expect(tagsBlocks(chat().tags)[0].text).toBe('[Tags: noir; slow burn]');
    await undo(x.id);
    expect(chat().tags).toBeUndefined();
  });
});
