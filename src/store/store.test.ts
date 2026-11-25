import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StreamEvent } from '../providers/openai';

// A fake server: each call records its request and streams whatever the test feeds it.
const calls: { messages: { role: string; content: unknown }[]; extra?: Record<string, unknown> }[] = [];
let feed: (signal?: AbortSignal) => AsyncGenerator<StreamEvent>;
vi.mock('../providers/openai', async (orig) => ({
  ...(await orig<typeof import('../providers/openai')>()),
  streamChat: (_p: unknown, _m: string, messages: never, _params: unknown, signal?: AbortSignal, extra?: Record<string, unknown>) => {
    calls.push({ messages, extra });
    return feed(signal);
  },
}));

const { useStore, newChat, send, continueReply, deleteChat, selectChat, updateChat, SAVE_EVERY_MS, withAttachments, insertMessage, duplicateChat } = await import('./store');
const { repo } = await import('../db/db');

const words = (text: string): (() => AsyncGenerator<StreamEvent>) => async function* () {
  yield { type: 'content', text } as StreamEvent;
  yield { type: 'done', finishReason: 'stop' } as StreamEvent;
};
/** Streams until aborted, one chunk at a time, waiting for `release` between chunks. */
function slow() {
  let release!: () => void;
  let next = new Promise<void>((r) => (release = r));
  const gen = async function* (signal?: AbortSignal) {
    while (!signal?.aborted) {
      await next;
      next = new Promise<void>((r) => (release = r));
      if (signal?.aborted) break;
      yield { type: 'content', text: 'word ' } as StreamEvent;
    }
    throw Object.assign(new Error('aborted'), { name: 'AbortError' });
  };
  return { gen, tick: () => release() };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(async () => {
  calls.length = 0;
  useStore.setState({
    ready: true,
    providers: [{ id: 'p', name: 'Test', baseUrl: 'http://localhost/v1', apiKey: 'k' } as never],
    models: [{ key: 'm', providerId: 'p', modelId: 'small-model' }],
    settings: { ...useStore.getState().settings, defaultModelKey: 'm', activeProviderId: 'p' },
    chats: [], messages: [], currentChatId: undefined, streamingId: undefined,
  });
  await newChat();
});

describe('Continue', () => {
  it('keeps the half reply last when Length and the Author\'s Note are on', async () => {
    await updateChat({ length: 'scene', writing: { ...useStore.getState().chats[0].writing, enabled: true, steering: 'Dark tone', steeringMode: 'inline', steeringDepth: 1 } });
    feed = words('Half a reply');
    await send('Write a scene.');
    feed = words(' and the rest.');
    const reply = useStore.getState().messages.at(-1)!;
    await continueReply(reply.id);
    const req = calls.at(-1)!;
    expect(req.messages.at(-1)).toEqual({ role: 'assistant', content: 'Half a reply' });
    expect(String(req.messages.at(-2)!.content)).toContain('Dark tone');
    expect(String(req.messages.at(-2)!.content)).toContain('[Length:');
    expect(req.extra).toMatchObject({ continue_final_message: true, add_generation_prompt: false });
    expect(useStore.getState().messages.at(-1)!.swipes[0].content).toBe('Half a reply and the rest.');
  });
});

describe('chat switching and deleting while a reply streams', () => {
  it('tapping the chat you are in does not stop the reply', async () => {
    const s = slow();
    feed = s.gen;
    const done = send('Hi');
    await flush();
    s.tick();
    await flush();
    expect(useStore.getState().streamingId).toBeTruthy();
    await selectChat(useStore.getState().currentChatId!);
    s.tick();
    await new Promise((r) => setTimeout(r, 20));
    expect(useStore.getState().streamingId).toBeTruthy();
    const { stop } = await import('./store');
    stop();
    s.tick();
    await done;
  });

  it('deleting the chat mid-reply leaves nothing behind', async () => {
    const s = slow();
    feed = s.gen;
    const chatId = useStore.getState().currentChatId!;
    const done = send('Hi');
    await flush();
    s.tick();
    await flush();
    await deleteChat(chatId);
    s.tick();
    await done;
    await flush();
    expect(await repo.messages(chatId)).toEqual([]);
    expect(useStore.getState().streamingId).toBeUndefined();
  });
});

describe('saving while streaming', () => {
  it('writes the reply to storage before it finishes', async () => {
    vi.useFakeTimers({ toFake: ['performance'] });
    try {
      const s = slow();
      feed = s.gen;
      const chatId = useStore.getState().currentChatId!;
      const done = send('Hi');
      await vi.waitFor(() => expect(useStore.getState().streamingId).toBeTruthy());
      for (let i = 0; i < 3; i++) {
        vi.advanceTimersByTime(SAVE_EVERY_MS / 2 + 10);
        s.tick();
        await new Promise((r) => setTimeout(r, 0));
      }
      await vi.waitFor(async () => {
        const saved = (await repo.messages(chatId)).find((m) => m.role === 'assistant');
        expect(saved?.swipes[0].content).toContain('word');
      });
      expect(useStore.getState().streamingId).toBeTruthy();
      const { stop } = await import('./store');
      stop();
      s.tick();
      await done;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('attachments', () => {
  const atts = [
    { id: 'a', kind: 'image' as const, name: 'map.jpg', mime: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,AAAA' },
    { id: 'b', kind: 'file' as const, name: 'notes.md', mime: 'text/markdown', text: 'Rell is the captain.' },
  ];
  it('sends images as parts to vision models and text files inline', () => {
    const c = withAttachments('Look', atts, true);
    expect(Array.isArray(c)).toBe(true);
    expect(c).toEqual([{ type: 'text', text: '[Attached file: notes.md]\nRell is the captain.\n[End of notes.md]\n\nLook' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } }]);
  });
  it('tells other models an image was left out', () => {
    expect(withAttachments('', atts, false)).toContain('[Image attached earlier: map.jpg, not sent with this request]');
  });
});

describe('branch', () => {
  it('copies the story up to the chosen message into a new chat', async () => {
    const c = await newChat();
    await insertMessage('user', 'one');
    await insertMessage('assistant', 'two');
    await insertMessage('user', 'three');
    const second = useStore.getState().messages[1];
    await duplicateChat(c.id, second.id);
    const s = useStore.getState();
    expect(s.currentChatId).not.toBe(c.id);
    expect(s.chats.find((x) => x.id === s.currentChatId)?.title).toContain('(branch)');
    expect(s.messages.map((m) => m.swipes[0].content)).toEqual(['one', 'two']);
  });
});
