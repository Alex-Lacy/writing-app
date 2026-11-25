import { create } from 'zustand';
import { repo } from '../db/db';
import { buildContext, writingBlocks, type BuildResult, type HistoryItem } from '../context/build';
import { friendlyError, streamChat, type ProviderError, type WireMessage } from '../providers/openai';
import {
  activeSwipe, DEFAULT_SETTINGS, FEATHERLESS_PRESET,
  type AppSettings, type Chat, type Message, type ModelEntry, type Preset, type ProviderConfig, type Swipe,
} from '../types';
import { uid } from '../lib/id';

type Panel = 'none' | 'chat-settings' | 'context';
export type SettingsTab = 'providers' | 'models' | 'presets' | 'general' | 'data';

interface State {
  ready: boolean;
  settings: AppSettings;
  providers: ProviderConfig[];
  models: ModelEntry[];
  presets: Preset[];
  chats: Chat[];
  currentChatId?: string;
  messages: Message[];
  streamingId?: string;
  error?: string;
  sidebarOpen: boolean;
  panel: Panel;
  settingsOpen: boolean;
  settingsTab: SettingsTab;
  lastContext?: BuildResult;
}

let abort: AbortController | null = null;

export const useStore = create<State>()(() => ({
  ready: false,
  settings: DEFAULT_SETTINGS,
  providers: [],
  models: [],
  presets: [],
  chats: [],
  messages: [],
  sidebarOpen: false,
  panel: 'none',
  settingsOpen: false,
  settingsTab: 'providers',
}));

const get = useStore.getState;
const set = useStore.setState;

export const currentChat = (s: State = get()) => s.chats.find((c) => c.id === s.currentChatId);

export function modelFor(chat: Chat | undefined, s: State = get()) {
  const key = chat?.modelKey ?? s.settings.defaultModelKey;
  return s.models.find((m) => m.key === key);
}
export function providerFor(model: ModelEntry | undefined, s: State = get()) {
  return s.providers.find((p) => p.id === model?.providerId) ?? s.providers.find((p) => p.id === s.settings.activeProviderId);
}
export function contextLimitFor(chat: Chat | undefined, s: State = get()) {
  const m = modelFor(chat, s);
  const p = providerFor(m, s);
  const cap = p?.contextLimit ?? 8192;
  return m?.contextLength ? Math.min(cap, m.contextLength) : cap;
}
export const modelLabel = (m?: ModelEntry) => (m ? m.nickname || m.modelId.split('/').pop() || m.modelId : 'No model');

const sortChats = (c: Chat[]) => [...c].sort((a, b) => b.updatedAt - a.updatedAt);

// ---------- init & settings ----------

let initP: Promise<void> | null = null;
export function init(force = false) {
  if (!initP || force) initP = doInit();
  return initP;
}

async function doInit() {
  const [settings, providers, models, presets, chats] = await Promise.all([
    repo.getSettings(), repo.all('providers'), repo.all('models'), repo.all('presets'), repo.all('chats'),
  ]);
  let provs = providers;
  if (provs.length === 0) {
    const fl: ProviderConfig = { ...FEATHERLESS_PRESET, id: uid(), apiKey: '' };
    await repo.put('providers', fl);
    provs = [fl];
  }
  const s: AppSettings = { ...DEFAULT_SETTINGS, ...settings };
  s.activeProviderId ??= provs[0].id;
  set({ ready: true, settings: s, providers: provs, models, presets, chats: sortChats(chats), settingsOpen: !provs.some((p) => p.apiKey) });
  const first = sortChats(chats)[0];
  if (first) await selectChat(first.id);
}

export async function saveSettings(patch: Partial<AppSettings>) {
  const settings = { ...get().settings, ...patch };
  set({ settings });
  await repo.putSettings(settings);
}

export async function upsertProvider(p: ProviderConfig) {
  set({ providers: [...get().providers.filter((x) => x.id !== p.id), p] });
  await repo.put('providers', p);
}
export async function deleteProvider(id: string) {
  set({ providers: get().providers.filter((x) => x.id !== id), models: get().models.filter((m) => m.providerId !== id) });
  await repo.del('providers', id);
  for (const m of (await repo.all('models')).filter((m) => m.providerId === id)) await repo.del('models', m.key);
}

export async function upsertModel(m: ModelEntry) {
  set({ models: [...get().models.filter((x) => x.key !== m.key), m] });
  await repo.put('models', m);
  if (!get().settings.defaultModelKey) await saveSettings({ defaultModelKey: m.key });
}
export async function deleteModel(key: string) {
  set({ models: get().models.filter((x) => x.key !== key) });
  await repo.del('models', key);
}

export async function upsertPreset(p: Preset) {
  set({ presets: [...get().presets.filter((x) => x.id !== p.id), p] });
  await repo.put('presets', p);
}
export async function deletePreset(id: string) {
  set({ presets: get().presets.filter((x) => x.id !== id) });
  await repo.del('presets', id);
}

// ---------- chats ----------

export async function newChat(): Promise<Chat> {
  const s = get().settings;
  const cur = currentChat();
  const chat: Chat = {
    id: uid(),
    title: 'New chat',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    modelKey: cur?.modelKey ?? s.defaultModelKey,
    systemPrompt: s.defaultSystemPrompt,
    params: { ...s.defaultParams },
    writing: { ...s.defaultWriting },
  };
  await repo.put('chats', chat);
  set({ chats: sortChats([chat, ...get().chats]), currentChatId: chat.id, messages: [], sidebarOpen: false, lastContext: undefined });
  return chat;
}

export async function selectChat(id: string) {
  if (get().streamingId) stop();
  const messages = await repo.messages(id);
  set({ currentChatId: id, messages, sidebarOpen: false, error: undefined, lastContext: undefined });
}

export async function updateChat(patch: Partial<Chat>, id = get().currentChatId) {
  const chat = get().chats.find((c) => c.id === id);
  if (!chat) return;
  const next = { ...chat, ...patch, updatedAt: Date.now() };
  set({ chats: sortChats(get().chats.map((c) => (c.id === id ? next : c))) });
  await repo.put('chats', next);
}

export async function duplicateChat(id: string) {
  const src = get().chats.find((c) => c.id === id);
  if (!src) return;
  const chat: Chat = { ...structuredClone(src), id: uid(), title: `${src.title} (copy)`, createdAt: Date.now(), updatedAt: Date.now() };
  await repo.put('chats', chat);
  for (const m of await repo.messages(id)) await repo.put('messages', { ...structuredClone(m), id: uid(), chatId: chat.id });
  set({ chats: sortChats([chat, ...get().chats]) });
  await selectChat(chat.id);
}

export async function deleteChat(id: string) {
  await repo.deleteChat(id);
  const chats = get().chats.filter((c) => c.id !== id);
  set({ chats });
  if (get().currentChatId === id) {
    if (chats[0]) await selectChat(chats[0].id);
    else set({ currentChatId: undefined, messages: [] });
  }
}

// ---------- messages ----------

async function putMessage(m: Message) {
  set({ messages: get().messages.map((x) => (x.id === m.id ? m : x)) });
  await repo.put('messages', m);
}

async function appendMessage(role: Message['role'], content: string): Promise<Message> {
  const list = get().messages;
  const m: Message = {
    id: uid(),
    chatId: get().currentChatId!,
    order: (list.at(-1)?.order ?? 0) + 1,
    role,
    swipes: [{ content, createdAt: Date.now() }],
    activeSwipe: 0,
  };
  set({ messages: [...list, m] });
  await repo.put('messages', m);
  return m;
}

function historyItems(msgs: Message[]): HistoryItem[] {
  return msgs
    .filter((m) => !m.condensed)
    .map((m) => ({ id: m.id, role: m.role, content: activeSwipe(m).content }))
    .filter((h) => h.content !== '');
}

/** Builds the exact request for the history before `uptoIndex` (exclusive). Used by generation and the context viewer. */
export function buildFor(chat: Chat, msgs: Message[]): BuildResult {
  const s = get();
  return buildContext({
    systemPrompt: chat.systemPrompt,
    blocks: [...writingBlocks(chat.writing) /* Phase 2: lorebook, summary */],
    history: historyItems(msgs),
    contextLimit: contextLimitFor(chat, s),
    maxTokens: replyReserve(chat, s),
    safetyMargin: s.settings.safetyMargin,
  });
}

/** Thinking models spend thousands of tokens reasoning before they write, so keep more room for them. */
export const THINKING_RESERVE = 6144;
export function replyReserve(chat: Chat, s: State = get()) {
  const m = modelFor(chat, s);
  return m?.thinking ? Math.max(chat.params.maxTokens, THINKING_RESERVE) : chat.params.maxTokens;
}

/** max_tokens actually sent: with auto on, everything left in the context window after the prompt. */
export function sendMaxTokens(chat: Chat, ctx: BuildResult, s: State = get()) {
  const reserve = replyReserve(chat, s);
  if (chat.params.autoMaxTokens === false) return chat.params.maxTokens;
  const room = contextLimitFor(chat, s) - s.settings.safetyMargin - ctx.tokens.total;
  return Math.max(reserve, Math.floor(room));
}

export async function send(text: string) {
  if (get().streamingId) return;
  let chat = currentChat();
  if (!chat) chat = await newChat();
  if (text.trim()) {
    await appendMessage('user', text);
    if (chat.title === 'New chat') await updateChat({ title: text.trim().replace(/\s+/g, ' ').slice(0, 60) });
  }
  await generate();
}

/**
 * Generates a reply. With `targetId` (an assistant message) a new swipe is added to it using
 * the history before it; otherwise a new assistant message is appended.
 */
export async function generate(targetId?: string, opts: { continueId?: string } = {}) {
  const chat = currentChat();
  if (!chat || get().streamingId) return;
  const model = modelFor(chat);
  const provider = providerFor(model);
  if (!model || !provider) {
    set({ error: 'Pick a model first (Settings, then Models).' });
    return;
  }
  if (!provider.apiKey && /featherless|openai|openrouter/i.test(provider.baseUrl)) {
    set({ error: `Add your API key for ${provider.name} in Settings.`, settingsOpen: true });
    return;
  }

  const all = get().messages;
  let target: Message;
  let history: Message[];
  const cont = opts.continueId ? all.find((m) => m.id === opts.continueId) : undefined;
  if (cont) {
    // Continue: send everything up to and including this reply, and append to its active version.
    target = cont;
    history = all.slice(0, all.indexOf(cont) + 1);
  } else if (targetId) {
    const idx = all.findIndex((m) => m.id === targetId);
    target = all[idx];
    history = all.slice(0, idx);
    target = { ...target, swipes: [...target.swipes, { content: '', createdAt: Date.now(), modelKey: model.key }], activeSwipe: target.swipes.length };
    await putMessage(target);
  } else {
    history = all;
    target = await appendMessage('assistant', '');
    target = { ...target, swipes: [{ content: '', createdAt: Date.now(), modelKey: model.key }] };
  }

  const ctx = buildFor(chat, history);
  const params = { ...chat.params, maxTokens: sendMaxTokens(chat, ctx) };
  set({ lastContext: ctx, streamingId: target.id, error: undefined });
  abort = new AbortController();

  const si = target.activeSwipe;
  let swipe: Swipe = cont ? { ...target.swipes[si], finishReason: undefined, error: undefined } : target.swipes[si];
  let lastPaint = 0;
  const paint = (force = false) => {
    const now = performance.now();
    if (!force && now - lastPaint < 50) return;
    lastPaint = now;
    const t = { ...target, swipes: target.swipes.map((s, i) => (i === si ? swipe : s)) };
    target = t;
    set({ messages: get().messages.map((x) => (x.id === t.id ? t : x)) });
  };

  const run = async (extra?: Record<string, unknown>): Promise<void> => {
    try {
      await runOnce(extra);
    } catch (e) {
      // Our token count is an estimate. If the server says the request is too long, retry once
      // with only the reserved reply room.
      const err = e as ProviderError;
      if (err.status === 400 && /max_tokens|max_completion_tokens|context length|maximum context|too long/i.test(err.message) && params.maxTokens > replyReserve(chat) && !swipe.content && !swipe.reasoning) {
        params.maxTokens = replyReserve(chat);
        await runOnce(extra);
      } else throw e;
    }
  };
  const runOnce = async (extra?: Record<string, unknown>) => {
    for await (const ev of streamChat(provider, model.modelId, ctx.messages as WireMessage[], params, abort!.signal, extra)) {
      if (ev.type === 'content') swipe = { ...swipe, content: swipe.content + ev.text };
      else if (ev.type === 'reasoning') swipe = { ...swipe, reasoning: (swipe.reasoning ?? '') + ev.text };
      else swipe = { ...swipe, finishReason: ev.finishReason };
      paint();
    }
  };

  try {
    if (cont) {
      // vLLM-style servers (Featherless) continue a trailing assistant message with these flags.
      // Servers that reject them get a plain request, which still adds on to the reply.
      try {
        await run({ continue_final_message: true, add_generation_prompt: false });
      } catch (e) {
        if ((e as ProviderError).status === 400) await run();
        else throw e;
      }
    } else await run();
  } catch (e) {
    const aborted = (e as Error).name === 'AbortError';
    if (!aborted) {
      const msg = friendlyError(e, provider.name);
      swipe = { ...swipe, error: msg };
      set({ error: msg });
    } else swipe = { ...swipe, finishReason: 'stopped' };
  } finally {
    paint(true);
    abort = null;
    set({ streamingId: undefined });
    await repo.put('messages', target);
    await updateChat({}, chat.id);
  }
}

/** Continues a reply that stopped at the token limit. */
export async function continueReply(id: string) {
  return generate(undefined, { continueId: id });
}

export function stop() {
  abort?.abort();
}

export async function regenerate(id: string) {
  const all = get().messages;
  const idx = all.findIndex((m) => m.id === id);
  const m = all[idx];
  if (!m) return;
  if (m.role === 'assistant') return generate(m.id);
  const next = all[idx + 1];
  if (next?.role === 'assistant') return generate(next.id);
  // User message with nothing after it (or followed by another user message): generate after it.
  if (idx === all.length - 1) return generate();
}

export async function swipe(id: string, dir: -1 | 1) {
  const all = get().messages;
  const m = all.find((x) => x.id === id);
  if (!m || get().streamingId) return;
  const nextIdx = m.activeSwipe + dir;
  if (nextIdx < 0) return;
  if (nextIdx >= m.swipes.length) {
    if (m.role === 'assistant') await generate(m.id);
    return;
  }
  await putMessage({ ...m, activeSwipe: nextIdx });
}

export async function deleteSwipe(id: string) {
  const m = get().messages.find((x) => x.id === id);
  if (!m) return;
  if (m.swipes.length <= 1) return deleteMessage(id);
  const swipes = m.swipes.filter((_, i) => i !== m.activeSwipe);
  await putMessage({ ...m, swipes, activeSwipe: Math.min(m.activeSwipe, swipes.length - 1) });
}

export async function editMessage(id: string, content: string) {
  const m = get().messages.find((x) => x.id === id);
  if (!m) return;
  await putMessage({ ...m, swipes: m.swipes.map((s, i) => (i === m.activeSwipe ? { ...s, content, error: undefined } : s)) });
}

export async function deleteMessage(id: string) {
  set({ messages: get().messages.filter((x) => x.id !== id) });
  await repo.del('messages', id);
}

/** Deletes this message and everything after it. */
export async function deleteFrom(id: string) {
  const all = get().messages;
  const idx = all.findIndex((m) => m.id === id);
  if (idx < 0) return;
  const gone = all.slice(idx);
  set({ messages: all.slice(0, idx) });
  for (const m of gone) await repo.del('messages', m.id);
}

export async function insertMessage(role: Message['role'], content: string) {
  await appendMessage(role, content);
}

export const ui = {
  toggleSidebar: (open?: boolean) => set({ sidebarOpen: open ?? !get().sidebarOpen }),
  setPanel: (panel: Panel) => set({ panel: get().panel === panel ? 'none' : panel }),
  openSettings: (open: boolean, tab: SettingsTab = 'providers') => set({ settingsOpen: open, settingsTab: tab }),
  setSettingsTab: (tab: SettingsTab) => set({ settingsTab: tab }),
  clearError: () => set({ error: undefined }),
};
