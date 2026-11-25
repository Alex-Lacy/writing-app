import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { Chat, Message } from '../types';
import { hashUnit, mergeStories, plan, stableStringify, type Manifest, type StoryUnit } from './units';

const item = (id: string, hash: string) => ({ id, kind: 'story' as const, title: id, hash, updatedAt: 0 });
const man = (items: ReturnType<typeof item>[], gone: Record<string, number> = {}): Manifest => ({ deviceId: 'd', deviceName: 'D', items, gone });
const steps = (p: ReturnType<typeof plan>) => Object.fromEntries(p.map((x) => [x.id, x.step]));

describe('sync plan', () => {
  it('copies one-sided changes and new stories, skips matches', () => {
    const here = man([item('same', 'a'), item('mineChanged', 'h2'), item('theirsChanged', 'b'), item('onlyHere', 'x')]);
    const there = man([item('same', 'a'), item('mineChanged', 'h1'), item('theirsChanged', 'b2'), item('onlyThere', 'y')]);
    const base = { mineChanged: 'h1', theirsChanged: 'b' };
    expect(steps(plan(here, there, base))).toEqual({ mineChanged: 'give', theirsChanged: 'take', onlyHere: 'give', onlyThere: 'take' });
  });
  it('flags stories changed on both devices since the last sync', () => {
    expect(steps(plan(man([item('s', 'h')]), man([item('s', 't')]), { s: 'old' }))).toEqual({ s: 'check' });
    // Never synced and different: also checked, never silently overwritten.
    expect(steps(plan(man([item('s', 'h')]), man([item('s', 't')]), {}))).toEqual({ s: 'check' });
  });
  it('passes deletions on, unless the other side changed it since', () => {
    expect(steps(plan(man([], { s: 1 }), man([item('s', 'a')]), { s: 'a' }))).toEqual({ s: 'delete-there' });
    expect(steps(plan(man([], { s: 1 }), man([item('s', 'b')]), { s: 'a' }))).toEqual({ s: 'conflict' });
    expect(steps(plan(man([item('s', 'a')]), man([], { s: 1 }), { s: 'a' }))).toEqual({ s: 'delete-here' });
  });
});

const chat = { id: 'c', num: 1, title: 'T', systemPrompt: '', writing: { background: '', steering: '' }, createdAt: 0, updatedAt: 1 } as unknown as Chat;
const msg = (id: string, order: number, content: string) => ({ id, chatId: 'c', order, role: 'assistant', activeSwipe: 0, swipes: [{ content, createdAt: 0 }] }) as Message;
const story = (messages: Message[], c: Partial<Chat> = {}): StoryUnit => ({ kind: 'story', id: 'c', chat: { ...chat, ...c }, messages, threads: [] });

describe('merging a story changed on both', () => {
  it('takes the longer one when the other only lacks new messages', () => {
    const a = story([msg('1', 1, 'one')]);
    const b = story([msg('1', 1, 'one'), msg('2', 2, 'two')], { updatedAt: 5 });
    expect(mergeStories(a, b)?.messages.map((m) => m.id)).toEqual(['1', '2']);
    expect(mergeStories(b, a)?.messages.map((m) => m.id)).toEqual(['1', '2']);
  });
  it('is a conflict when both wrote new messages, a shared one was edited, or the setup differs', () => {
    expect(mergeStories(story([msg('1', 1, 'one'), msg('2', 2, 'mine')]), story([msg('1', 1, 'one'), msg('3', 2, 'theirs')]))).toBeUndefined();
    expect(mergeStories(story([msg('1', 1, 'one')]), story([msg('1', 1, 'ONE'), msg('2', 2, 'two')]))).toBeUndefined();
    expect(mergeStories(story([msg('1', 1, 'one')], { title: 'A' }), story([msg('1', 1, 'one'), msg('2', 2, 'x')], { title: 'B' }))).toBeUndefined();
  });
  it('ignores device-only bookkeeping and key order when fingerprinting', async () => {
    const a = story([msg('1', 1, 'one')], { updatedAt: 1, proofChecked: { 1: 'x' } });
    const b = story([msg('1', 1, 'one')], { updatedAt: 9 });
    expect(await hashUnit(a)).toBe(await hashUnit(b));
    expect(stableStringify({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
  });
});
