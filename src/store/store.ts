import { create } from 'zustand';
import { normalizeChat, normalizeWriting, repo } from '../db/db';
import { buildContext, writingBlocks, type BuildResult, type HistoryItem } from '../context/build';
import { backstopCut, lengthBlocks } from '../context/length';
import { CODEX_SCAN, CODEX_SHARE, codexBlocks, globalNotesBlocks, styleBlocks, summaryBlocks, triggeredEntries } from '../context/codex';
import { calibrate, currentCharsPerToken, setCharsPerToken } from '../context/tokens';
import { friendlyError, streamChat, type ProviderError, type WireMessage } from '../providers/openai';
import {
  activeSwipe, DEFAULT_SETTINGS, FEATHERLESS_PRESET,
  type AppSettings, type Chat, type CodexBook, type HelperThread, type Message, type Suggestion, type ModelEntry, type Preset, type ProviderConfig, type Swipe,
} from '../types';
import { uid } from '../lib/id';
import { jobRunning, makeRoomForStory, storyStarted } from '../ai/jobs';
import { STARTER_STYLES } from '../features/starters';

type Panel = 'none' | 'chat-settings';
export type PanelTab = 'setup' | 'codex' | 'helper' | 'filter' | 'suggestions';
export type SettingsTab = 'providers' | 'models' | 'presets' | 'general' | 'data';

interface State {
  ready: boolean;
  settings: AppSettings;
  providers: ProviderConfig[];
  models: ModelEntry[];
  presets: Preset[];
  chats: Chat[];
  /** All Codex books: stories' own and the Library's shared ones. */
  codex: CodexBook[];
  /** Suggestion cards and Helper conversations for the current chat. */
  suggestions: Suggestion[];
  helperThreads: HelperThread[];
  panelTab: PanelTab;
  /** Background jobs running or queued, shown as a quiet status line. */
  jobs: { id: string; label: string }[];
  currentChatId?: string;
  messages: Message[];
  streamingId?: string;
  error?: string;
  sidebarOpen: boolean;
  panel: Panel;
  settingsOpen: boolean;
  settingsTab: SettingsTab;
  contextOpen: boolean;
  libraryOpen: boolean;
  /** Full-screen reading: sidebars and panel hidden. */
  focus: boolean;
  /** Helper shown in the Helper tab. */
  helperId?: string;
  lastContext?: BuildResult;
  /** Message (or highlighted part of one) the Rewrite box is open for. */
  rewriteTarget?: RewriteTarget;
  compileOpen: boolean;
  /** Shown while a reply waits for a Helper or Proofread job to finish. */
  waiting?: string;
}

export interface RewriteTarget { messageId: string; from?: number; to?: number }

let abort: AbortController | null = null;
let streamingChatId: string | undefined;
/** How often a streaming reply is written to storage, so a killed app keeps most of it. */
export const SAVE_EVERY_MS = 2000;

export const useStore = create<State>()(() => ({
  ready: false,
  settings: DEFAULT_SETTINGS,
  providers: [],
  models: [],
  presets: [],
  chats: [],
  codex: [],
  suggestions: [],
  helperThreads: [],
  panelTab: 'setup',
  jobs: [],
  messages: [],
  sidebarOpen: false,
  panel: 'none',
  settingsOpen: false,
  settingsTab: 'providers',
  contextOpen: false,
  libraryOpen: false,
  compileOpen: false,
  focus: false,
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
  const [settings, providers, models, presets, rawChats, codex] = await Promise.all([
    repo.getSettings(), repo.all('providers'), repo.all('models'), repo.all('presets'), repo.all('chats'), repo.all('codex'),
  ]);
  // Older data used NovelAI-style field names; convert on load (saved back on the next change).
  let chats = rawChats.map(normalizeChat);
  if (settings?.defaultWriting) settings.defaultWriting = normalizeWriting(settings.defaultWriting);
  let provs = providers;
  if (provs.length === 0) {
    const fl: ProviderConfig = { ...FEATHERLESS_PRESET, id: uid(), apiKey: '' };
    await repo.put('providers', fl);
    provs = [fl];
  }
  const s: AppSettings = { ...DEFAULT_SETTINGS, ...settings };
  // v0.3: Steering goes inline by default. DeepSeek-style templates move every system
  // message to the top of the prompt, so a mid-chat system note lands far from the end.
  let allChats: Chat[] = chats;
  if (!s.migrations?.includes('an-inline')) {
    allChats = chats.map((c) => (c.writing.steeringMode === 'system' ? { ...c, writing: { ...c.writing, steeringMode: 'inline' as const } } : c));
    for (const c of allChats) await repo.put('chats', c);
    s.defaultWriting = { ...s.defaultWriting, steeringMode: 'inline' };
    s.migrations = [...(s.migrations ?? []), 'an-inline'];
    await repo.putSettings(s);
  }
  s.activeProviderId ??= provs[0].id;
  setCharsPerToken(s.charsPerToken);
  if (!s.styles) s.styles = STARTER_STYLES;
  // Chat numbers (#1, #2…), oldest first, for chats made before numbers existed.
  if (allChats.some((c) => !c.num)) {
    let n = s.nextChatNum ?? 1;
    for (const c of allChats.filter((c) => c.num).sort((a, b) => a.num! - b.num!)) n = Math.max(n, c.num! + 1);
    allChats = [...allChats].sort((a, b) => a.createdAt - b.createdAt).map((c) => (c.num ? c : { ...c, num: n++ }));
    for (const c of allChats) await repo.put('chats', c);
    s.nextChatNum = n;
    await repo.putSettings(s);
  }
  set({ ready: true, settings: s, providers: provs, models, presets, codex, chats: sortChats(allChats), settingsOpen: !provs.some((p) => p.apiKey) });
  const first = sortChats(allChats)[0];
  if (first) await selectChat(first.id, true);
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
    num: await takeChatNum(),
    styleIds: (s.styles ?? []).filter((m) => m.defaultOn).map((m) => m.id),
    autoSummary: s.defaultAutoSummary ?? true,
    updatesEvery: s.defaultUpdatesEvery ?? DEFAULT_UPDATES_EVERY,
  };
  await repo.put('chats', chat);
  set({ chats: sortChats([chat, ...get().chats]), currentChatId: chat.id, messages: [], suggestions: [], helperThreads: [], sidebarOpen: false, lastContext: undefined });
  return chat;
}

export const DEFAULT_UPDATES_EVERY = 1500;

/** Runs after each finished reply (Cliché Filter, suggested updates, auto-summary). */
export type ReplyHook = (e: { chatId: string; message: Message; newText: string }) => void | Promise<void>;
export const replyHooks: ReplyHook[] = [];

async function takeChatNum() {
  const s = get().settings;
  const n = Math.max(s.nextChatNum ?? 1, ...get().chats.map((c) => (c.num ?? 0) + 1));
  await saveSettings({ nextChatNum: n + 1 });
  return n;
}

export async function selectChat(id: string, reload = false) {
  // Tapping the chat you're already in just closes the sidebar; it must not stop a reply.
  if (id === get().currentChatId && !reload) {
    set({ sidebarOpen: false });
    return;
  }
  if (get().streamingId) stop();
  const [messages, suggestions, helperThreads] = await Promise.all([repo.messages(id), repo.byChat('suggestions', id), repo.byChat('helperThreads', id)]);
  set({ currentChatId: id, messages, suggestions, helperThreads, sidebarOpen: false, error: undefined, lastContext: undefined });
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
  const chat: Chat = { ...structuredClone(src), id: uid(), num: await takeChatNum(), title: `${src.title} (copy)`, createdAt: Date.now(), updatedAt: Date.now() };
  const own = get().codex.find((b) => b.id === src.codexId);
  if (own) {
    const copy: CodexBook = { ...structuredClone(own), id: uid(), chatId: chat.id, createdAt: Date.now(), updatedAt: Date.now() };
    await repo.put('codex', copy);
    set({ codex: [...get().codex, copy] });
    chat.codexId = copy.id;
  }
  const idMap = new Map<string, string>();
  for (const m of await repo.messages(id)) {
    idMap.set(m.id, uid());
    await repo.put('messages', { ...structuredClone(m), id: idMap.get(m.id)!, chatId: chat.id });
  }
  if (chat.summary) chat.summary = chat.summary.map((p) => ({ ...p, id: uid(), messageIds: p.messageIds.map((x) => idMap.get(x) ?? x) }));
  await repo.put('chats', chat);
  set({ chats: sortChats([chat, ...get().chats]) });
  await selectChat(chat.id);
}

export async function deleteChat(id: string) {
  // Drop it from state first: a reply still streaming checks this and skips its saves.
  const chats = get().chats.filter((c) => c.id !== id);
  set({ chats, codex: get().codex.filter((b) => b.chatId !== id) });
  if (streamingChatId === id) stop();
  await repo.deleteChat(id);
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
export function buildFor(chat: Chat, msgs: Message[], opts: { continueLast?: boolean } = {}): BuildResult {
  const s = get();
  const history = historyItems(msgs);
  const limit = contextLimitFor(chat, s);
  const recent = history.slice(-CODEX_SCAN).map((h) => (typeof h.content === 'string' ? h.content : '')).join('\n');
  const { hits, dropped } = triggeredEntries(codexBooksFor(chat, s), recent, Math.floor(limit * CODEX_SHARE));
  const ctx = buildContext({
    systemPrompt: chat.systemPrompt,
    blocks: [
      ...globalNotesBlocks(s.settings.globalNotes, chat.globalNotes),
      ...writingBlocks(chat.writing),
      ...styleBlocks(s.settings.styles, chat.styleIds),
      ...codexBlocks(hits),
      ...summaryBlocks(chat.summary),
      ...lengthBlocks(chat.length),
    ],
    history,
    contextLimit: limit,
    maxTokens: replyReserve(chat, s),
    safetyMargin: s.settings.safetyMargin,
    continueLast: opts.continueLast,
  });
  if (dropped.length) ctx.codexDropped = dropped.map((d) => d.entry.name);
  return ctx;
}

/** The chat's own Codex book plus any shared books attached to it. */
export function codexBooksFor(chat: Chat, s: State = get()): CodexBook[] {
  const ids = [chat.codexId, ...(chat.sharedCodexIds ?? [])];
  return s.codex.filter((b) => ids.includes(b.id));
}

/**
 * Request fields for the chat's thinking setting. Hybrid models are switched with chat-template
 * flags (Qwen/GLM read enable_thinking, DeepSeek/Kimi read thinking; templates ignore the other),
 * and effort goes in reasoning_effort. Models that always think can't be switched off.
 */
export function thinkingExtra(chat: Chat, model: ModelEntry | undefined): Record<string, unknown> {
  const mode = chat.thinking ?? 'default';
  if (!model?.thinking || mode === 'default') return {};
  if (mode === 'off') return model.thinking === 'optional' ? { chat_template_kwargs: { enable_thinking: false, thinking: false } } : { reasoning_effort: 'low' };
  return {
    ...(model.thinking === 'optional' ? { chat_template_kwargs: { enable_thinking: true, thinking: true } } : {}),
    reasoning_effort: mode === 'deep' ? 'high' : 'low',
  };
}

/** Thinking models spend thousands of tokens reasoning before they write, so keep more room for them. */
/**
 * Room kept free for the reply when older messages are trimmed. Sized from the Length setting,
 * plus extra when the model thinks (reasoning counts against the same limit).
 */
const LENGTH_ROOM: Record<string, number> = { any: 2048, short: 600, medium: 1000, long: 1600, scene: 2400, chapter: 7000, story: 12000 };
export const THINKING_ROOM = 4096;
export function replyReserve(chat: Chat, s: State = get()) {
  const m = modelFor(chat, s);
  const thinks = thinksFor(chat, m);
  const room = (LENGTH_ROOM[chat.length ?? 'any'] ?? 2048) + (thinks ? THINKING_ROOM : 0);
  return chat.params.hardCap ? Math.min(room, chat.params.hardCap) : room;
}

/** max_tokens actually sent: with auto on, everything left in the context window after the prompt. */
export function sendMaxTokens(chat: Chat, ctx: BuildResult, s: State = get()) {
  const reserve = replyReserve(chat, s);
  const room = Math.max(reserve, Math.floor(contextLimitFor(chat, s) - s.settings.safetyMargin - ctx.tokens.total));
  return chat.params.hardCap ? Math.min(room, chat.params.hardCap) : room;
}

/** True from Send until the reply starts streaming, so a double tap can't start two. */
let starting = false;

export async function send(text: string) {
  if (get().streamingId || starting) return;
  starting = true;
  try {
    await sendNow(text);
  } finally {
    starting = false;
  }
}

async function sendNow(text: string) {
  let chat = currentChat();
  if (!chat) chat = await newChat();
  if (text.trim()) {
    await appendMessage('user', text);
    if (chat.title === 'New chat') await updateChat({ title: text.trim().replace(/\s+/g, ' ').slice(0, 60) });
  }
  await generate(undefined, { fromSend: true });
}

/**
 * Generates a reply. With `targetId` (an assistant message) a new swipe is added to it using
 * the history before it; otherwise a new assistant message is appended.
 */
export async function generate(targetId?: string, opts: { continueId?: string; fromSend?: boolean } = {}) {
  const chat = currentChat();
  if (!chat || get().streamingId || get().waiting || (starting && !opts.fromSend)) return;
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

  // Let a running side job finish (or stop a background one) so the plan's allowance is free.
  if (jobRunning()) set({ waiting: `Waiting for ${get().jobs[0]?.label ?? 'a side job'} to finish…` });
  try {
    await makeRoomForStory();
  } finally {
    set({ waiting: undefined });
  }
  if (get().streamingId) return storyStarted();

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

  // Thinking models can't pick up a half-written reply (the server would put a fresh think
  // block in front of it), so for them Continue asks in words instead. Otherwise the reply
  // being continued must be the very last message.
  const contByAsking = !!cont && thinksFor(chat, model);
  const ctx = buildFor(chat, history, { continueLast: !!cont && !contByAsking });
  if (contByAsking) {
    const last = ctx.messages.at(-1);
    if (last?.role === 'user' && typeof last.content === 'string') last.content += '\n\n' + CONTINUE_ASK;
    else ctx.messages.push({ role: 'user', content: CONTINUE_ASK });
    const la = ctx.annotated.at(-1);
    const part = { source: 'other' as const, label: 'Continue request', text: CONTINUE_ASK, tokens: Math.ceil(CONTINUE_ASK.length / 3.3) };
    if (la?.role === 'user') la.parts.push(part);
    else ctx.annotated.push({ role: 'user', parts: [part] });
  }
  const params = { ...chat.params, maxTokens: sendMaxTokens(chat, ctx) };
  set({ lastContext: ctx, streamingId: target.id, error: undefined });
  storyStarted();
  streamingChatId = chat.id;
  const chatExists = () => get().chats.some((c) => c.id === chat.id);
  let lastSave = performance.now();
  const save = async () => {
    lastSave = performance.now();
    if (chatExists()) await repo.put('messages', target);
  };
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
    if (now - lastSave >= SAVE_EVERY_MS) void save().catch(() => {});
  };

  const thinkExtra = thinkingExtra(chat, model);
  const startOffset = swipe.content.length; // the backstop only counts words written now
  let softStopped = false;
  const run = async (extra?: Record<string, unknown>): Promise<void> => {
    const withThinking = { ...thinkExtra, ...extra };
    try {
      try {
        await runOnce(withThinking);
      } catch (e) {
        // A server that doesn't know the thinking fields: retry plain once.
        const err = e as ProviderError;
        if (Object.keys(thinkExtra).length && err.status === 400 && /chat_template_kwargs|reasoning_effort|enable_thinking|thinking|extra/i.test(err.message) && !swipe.content && !swipe.reasoning) {
          await runOnce(extra);
          set({ error: `${provider.name} ignored the thinking setting for this model.` });
        } else throw e;
      }
    } catch (e) {
      // Our token count is an estimate. If the server says the request is too long, retry once
      // with only the reserved reply room.
      const err = e as ProviderError;
      if (err.status === 400 && /max_tokens|max_completion_tokens|context length|maximum context|too long/i.test(err.message) && params.maxTokens > replyReserve(chat) && !swipe.content && !swipe.reasoning) {
        params.maxTokens = replyReserve(chat);
        await runOnce(withThinking);
      } else throw e;
    }
  };
  const runOnce = async (extra?: Record<string, unknown>) => {
    for await (const ev of streamChat(provider, model.modelId, ctx.messages as WireMessage[], params, abort!.signal, extra)) {
      if (ev.type === 'content') {
        let text = ev.text;
        // Servers drop the leading space of a continuation ("boots" + "splashing").
        if (cont && swipe.content.length === startOffset && startOffset > 0) {
          text = text.replace(/^\s+/, (ws) => (/\s$/.test(swipe.content) ? '' : ws));
          if (/[\w.,;:!?"”'’)\]*]$/.test(swipe.content) && /^[A-Za-z0-9"“'‘(*]/.test(text) && !/\s$/.test(swipe.content)) text = ' ' + text;
        }
        if (!text) continue;
        swipe = { ...swipe, content: swipe.content + text };
        const cut = backstopCut(swipe.content, chat.length, startOffset);
        if (cut >= 0) {
          swipe = { ...swipe, content: swipe.content.slice(0, cut).trimEnd() };
          softStopped = true;
          paint(true);
          abort!.abort();
          return;
        }
      } else if (ev.type === 'reasoning') swipe = { ...swipe, reasoning: (swipe.reasoning ?? '') + ev.text };
      else {
        swipe = { ...swipe, finishReason: ev.finishReason };
        if (ev.usage?.prompt_tokens) {
          swipe.usage = { prompt: ev.usage.prompt_tokens, completion: ev.usage.completion_tokens };
          calibrate(JSON.stringify(ctx.messages).length, ev.usage.prompt_tokens);
        }
      }
      paint();
    }
  };

  try {
    if (cont && !contByAsking) {
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
    } else swipe = { ...swipe, finishReason: softStopped ? 'length-soft' : 'stopped' };
  } finally {
    if (softStopped) swipe = { ...swipe, finishReason: 'length-soft', error: undefined };
    paint(true);
    abort = null;
    streamingChatId = undefined;
    set({ streamingId: undefined });
    await save();
    await updateChat({}, chat.id);
    if (Math.abs((get().settings.charsPerToken ?? 0) - currentCharsPerToken()) > 0.02) await saveSettings({ charsPerToken: currentCharsPerToken() });
    if (!swipe.error && swipe.content && chatExists()) for (const h of replyHooks) void Promise.resolve(h({ chatId: chat.id, message: target, newText: swipe.content.slice(startOffset) })).catch((e) => console.warn('after-reply hook failed', e));
  }
}

const CONTINUE_ASK = '[Continue your last reply exactly where it stopped, mid-sentence if needed. Output only the new text: do not repeat anything already written and do not comment.]';

/** Whether this model will think on this chat's settings. */
export function thinksFor(chat: Chat, m?: ModelEntry): boolean {
  return !!m?.thinking && !(m.thinking === 'optional' && chat.thinking === 'off');
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
  // A summary part covering this message is now out of date.
  const chat = currentChat();
  if (chat?.summary?.some((p) => p.messageIds.includes(id))) await updateChat({ summary: chat.summary.map((p) => (p.messageIds.includes(id) ? { ...p, stale: true } : p)) });
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
  toggleSidebar: (open?: boolean) => {
    // Phones: a drawer. Wider screens: show or hide the chat list column.
    if (matchMedia('(max-width: 860px)').matches) set({ sidebarOpen: open ?? !get().sidebarOpen });
    else void saveSettings({ sidebarHidden: open === undefined ? !get().settings.sidebarHidden : !open });
  },
  setFocus: (on: boolean) => set({ focus: on, sidebarOpen: false }),
  setPanel: (panel: Panel) => set({ panel: get().panel === panel ? 'none' : panel }),
  /** Opens the Story panel on a tab. */
  openPanel: (tab: PanelTab) => set({ panel: 'chat-settings', panelTab: tab }),
  setPanelTab: (tab: PanelTab) => set({ panelTab: tab }),
  openHelper: (helperId: string) => set({ panel: 'chat-settings', panelTab: 'helper', helperId }),
  openSettings: (open: boolean, tab: SettingsTab = 'providers') => set({ settingsOpen: open, settingsTab: tab }),
  setSettingsTab: (tab: SettingsTab) => set({ settingsTab: tab }),
  openContext: (open: boolean) => set({ contextOpen: open }),
  openLibrary: (open: boolean) => set({ libraryOpen: open, sidebarOpen: false }),
  clearError: () => set({ error: undefined }),
  openRewrite: (t?: RewriteTarget) => set({ rewriteTarget: t }),
  openCompile: (open: boolean) => set({ compileOpen: open }),
};
