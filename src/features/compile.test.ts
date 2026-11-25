import { describe, expect, it } from 'vitest';
import { crc32 } from '../lib/zip';
import type { Message } from '../types';
import { compileStory, toPlainText } from './compile';
import { proofChunks, textHash } from './rewrite';

const msg = (role: Message['role'], content: string): Message => ({ id: content, chatId: 'c', role, createdAt: 0, order: 0, activeSwipe: 0, swipes: [{ content, createdAt: 0 }] }) as Message;

describe('compile', () => {
  const msgs = [msg('user', 'Start [OOC: be dark]'), msg('assistant', 'Rain fell. [note to self]\n\n***\n\nMorning came.'), msg('assistant', 'She *left*.')];
  it('keeps only the story and strips notes', () => {
    const { markdown, words } = compileStory('Tide', msgs, { include: 'story', stripNotes: true, chapters: false });
    expect(markdown).toBe('# Tide\n\nRain fell.\n\n* * *\n\nMorning came.\n\nShe *left*.\n');
    expect(words).toBe(6);
  });
  it('makes chapters at scene breaks and can include your messages', () => {
    const { markdown } = compileStory('Tide', msgs, { include: 'all', stripNotes: false, chapters: true });
    expect(markdown).toContain('## Chapter 1\n\nStart [OOC: be dark]');
    expect(markdown).toContain('## Chapter 2\n\nMorning came.');
  });
  it('plain text drops marks', () => expect(toPlainText('# T\n\nShe **ran** and *hid*.')).toBe('T\n\nShe ran and hid.'));
  it('crc32', () => expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926));
});

describe('whole-story proofread chunks', () => {
  it('keeps short messages whole and splits long ones at paragraph breaks', () => {
    expect(proofChunks('One para.\n\nTwo para.')).toEqual([{ from: 0, to: 20 }]);
    const para = 'word '.repeat(700).trim();
    const text = `${para}\n\n${para}\n\n${para}`;
    const parts = proofChunks(text);
    expect(parts.length).toBe(2);
    expect(parts.map((r) => text.slice(r.from, r.to)).join('\n\n')).toBe(text);
  });
  it('fingerprints text so unchanged messages are skipped', () => {
    expect(textHash('abc')).toBe(textHash('abc'));
    expect(textHash('abc')).not.toBe(textHash('abd'));
  });
});
