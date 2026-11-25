import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { repo } from '../db/db';
import type { Chat, Message } from '../types';
import { importStoryFile, isStoryFile } from './storyFile';

const chat = { id: 'c1', num: 4, title: 'Harbour', systemPrompt: '', writing: { background: '', steering: '' }, createdAt: 0, updatedAt: 0 } as unknown as Chat;
const msg = { id: 'm1', chatId: 'c1', order: 1, role: 'assistant', activeSwipe: 0, swipes: [{ content: 'Rain.', createdAt: 0 }] } as Message;
const file = { writingStudioStory: 1 as const, exportedAt: 0, story: { kind: 'story' as const, id: 'c1', chat, messages: [msg], threads: [] } };

describe('story files', () => {
  it('recognises a story file and imports it; a second import can add a copy', async () => {
    expect(isStoryFile(file)).toBe(true);
    expect(isStoryFile({ chats: [] })).toBe(false);
    await importStoryFile(file, () => true);
    expect((await repo.messages('c1')).map((m) => m.id)).toEqual(['m1']);
    const title = await importStoryFile(file, () => false);
    expect(title).toBe('Harbour (imported)');
    const all = await repo.all('chats');
    expect(all).toHaveLength(2);
    expect(new Set(all.map((c) => c.num)).size).toBe(2);
  });
});
