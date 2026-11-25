import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction, type StoreNames } from 'idb';
import type { AppSettings, Chat, CodexBook, HelperThread, Message, ModelEntry, Preset, ProviderConfig, Suggestion } from '../types';

// All data lives in IndexedDB on the device. Phase 3 sync will layer on top of this
// (every record has an id + timestamps so it can be merged).
interface StudioDB extends DBSchema {
  kv: { key: string; value: unknown };
  providers: { key: string; value: ProviderConfig };
  models: { key: string; value: ModelEntry };
  presets: { key: string; value: Preset };
  chats: { key: string; value: Chat; indexes: { byUpdated: number } };
  messages: { key: string; value: Message; indexes: { byChat: string } };
  codex: { key: string; value: CodexBook };
  suggestions: { key: string; value: Suggestion; indexes: { byChat: string } };
  helperThreads: { key: string; value: HelperThread; indexes: { byChat: string } };
}

type Store = 'providers' | 'models' | 'presets' | 'chats' | 'messages' | 'codex' | 'suggestions' | 'helperThreads';

export interface BackupData {
  version: number;
  exportedAt: number;
  settings?: unknown;
  providers?: ProviderConfig[];
  codex?: CodexBook[];
  suggestions?: Suggestion[];
  helperThreads?: HelperThread[];
  models?: ModelEntry[];
  presets?: Preset[];
  chats?: Chat[];
  messages?: Message[];
}

type UpgradeDB = IDBPDatabase<StudioDB>;
type UpgradeTx = IDBPTransaction<StudioDB, StoreNames<StudioDB>[], 'versionchange'>;
export type Migration = (d: UpgradeDB, tx: UpgradeTx) => void;

/**
 * One step per database version, run in order from the installed version up. Never edit a
 * step once released; add a new one and the version follows. Step 0 makes version 1.
 * Phase 2 example: `(d) => { d.createObjectStore('lorebooks', { keyPath: 'id' }); }`.
 */
export const MIGRATIONS: Migration[] = [
  (d) => {
    d.createObjectStore('kv');
    d.createObjectStore('providers', { keyPath: 'id' });
    d.createObjectStore('models', { keyPath: 'key' });
    d.createObjectStore('presets', { keyPath: 'id' });
    d.createObjectStore('chats', { keyPath: 'id' }).createIndex('byUpdated', 'updatedAt');
    d.createObjectStore('messages', { keyPath: 'id' }).createIndex('byChat', 'chatId');
  },
  // v2 (Phase 2): Codex books, suggestion cards, Helper conversations.
  (d) => {
    d.createObjectStore('codex', { keyPath: 'id' });
    d.createObjectStore('suggestions', { keyPath: 'id' }).createIndex('byChat', 'chatId');
    d.createObjectStore('helperThreads', { keyPath: 'id' }).createIndex('byChat', 'chatId');
  },
];
export const DB_VERSION = MIGRATIONS.length;

/** Opens (and upgrades) a database. `steps` is only overridden by tests. */
export function openStudioDB(name = 'writing-studio', steps: Migration[] = MIGRATIONS) {
  return openDB<StudioDB>(name, steps.length, {
    upgrade(d, oldVersion, _newVersion, tx) {
      for (let v = oldVersion; v < steps.length; v++) steps[v](d, tx);
    },
  });
}

let dbp: Promise<IDBPDatabase<StudioDB>> | null = null;

export function db() {
  dbp ??= openStudioDB();
  return dbp;
}

export const repo = {
  async getSettings(): Promise<AppSettings | undefined> {
    return (await (await db()).get('kv', 'settings')) as AppSettings | undefined;
  },
  async putSettings(s: AppSettings) {
    await (await db()).put('kv', s, 'settings');
  },
  async all<T extends Exclude<Store, 'messages'>>(store: T): Promise<StudioDB[T]['value'][]> {
    return (await db()).getAll(store);
  },
  async put<T extends Store>(store: T, v: StudioDB[T]['value']) {
    await (await db()).put(store, v as never);
  },
  async get<T extends Store>(store: T, key: string): Promise<StudioDB[T]['value'] | undefined> {
    return (await db()).get(store, key);
  },
  async byChat<T extends 'suggestions' | 'helperThreads'>(store: T, chatId: string): Promise<StudioDB[T]['value'][]> {
    return (await db()).getAllFromIndex(store, 'byChat', chatId as never);
  },
  async del(store: Store, key: string) {
    await (await db()).delete(store, key);
  },
  async messages(chatId: string): Promise<Message[]> {
    const list = await (await db()).getAllFromIndex('messages', 'byChat', chatId);
    return list.sort((a, b) => a.order - b.order);
  },
  async deleteChat(chatId: string) {
    const d = await db();
    const tx = d.transaction(['chats', 'messages', 'suggestions', 'helperThreads', 'codex'], 'readwrite');
    const chat = await tx.objectStore('chats').get(chatId);
    const del: Promise<unknown>[] = [tx.objectStore('chats').delete(chatId)];
    for (const st of ['messages', 'suggestions', 'helperThreads'] as const)
      for (const k of await tx.objectStore(st).index('byChat').getAllKeys(chatId)) del.push(tx.objectStore(st).delete(k));
    if (chat?.codexId) del.push(tx.objectStore('codex').delete(chat.codexId));
    await Promise.all(del);
    await tx.done;
  },
  async exportAll(): Promise<BackupData> {
    const d = await db();
    return {
      version: 2,
      exportedAt: Date.now(),
      settings: await d.get('kv', 'settings'),
      providers: (await d.getAll('providers')).map((p) => ({ ...p, apiKey: '' })),
      models: await d.getAll('models'),
      presets: await d.getAll('presets'),
      chats: await d.getAll('chats'),
      messages: await d.getAll('messages'),
      codex: await d.getAll('codex'),
      suggestions: await d.getAll('suggestions'),
      helperThreads: await d.getAll('helperThreads'),
    };
  },
  /**
   * Restores a backup made by exportAll. Items with the same id are replaced. Imported models are
   * attached to a provider on this device when theirs isn't here (API keys are never in backups).
   */
  async importAll(data: BackupData): Promise<{ chats: number }> {
    if (!data || typeof data !== 'object' || !Array.isArray(data.chats) || !Array.isArray(data.messages))
      throw new Error("This file isn't a Writing Studio backup.");
    const d = await db();
    const providers = await d.getAll('providers');
    const fallback = providers[0]?.id;
    const tx = d.transaction(['kv', 'models', 'presets', 'chats', 'messages', 'codex', 'suggestions', 'helperThreads'], 'readwrite');
    for (const m of data.models ?? []) {
      const providerId = providers.some((p) => p.id === m.providerId) ? m.providerId : fallback;
      if (providerId) tx.objectStore('models').put({ ...m, providerId, key: `${providerId}::${m.modelId}` });
    }
    for (const p of data.presets ?? []) tx.objectStore('presets').put(p);
    for (const c of data.chats) tx.objectStore('chats').put(normalizeChat(c));
    for (const m of data.messages) tx.objectStore('messages').put(m);
    for (const b of data.codex ?? []) tx.objectStore('codex').put(b);
    for (const x of data.suggestions ?? []) tx.objectStore('suggestions').put(x);
    for (const h of data.helperThreads ?? []) tx.objectStore('helperThreads').put(h);
    if (data.settings && typeof data.settings === 'object') {
      const cur = ((await tx.objectStore('kv').get('settings')) ?? {}) as AppSettings;
      const inc = data.settings as AppSettings;
      // Keep this device's provider choice; take the writing defaults and preferences.
      // Style modules and Helpers are merged by id (the backup's version wins), so imported chats
      // keep the modules they had switched on. Filter rules: the backup's, unless it has none.
      const byId = <T extends { id: string }>(a: T[] = [], b: T[] = []) => [...a.filter((x) => !b.some((y) => y.id === x.id)), ...b];
      tx.objectStore('kv').put({
        ...inc, ...cur,
        defaultWriting: normalizeWriting(inc.defaultWriting ?? cur.defaultWriting),
        defaultSystemPrompt: inc.defaultSystemPrompt ?? cur.defaultSystemPrompt,
        globalNotes: inc.globalNotes ?? cur.globalNotes,
        styles: inc.styles || cur.styles ? byId(cur.styles, inc.styles) : undefined,
        helpers: inc.helpers || cur.helpers ? byId(cur.helpers, inc.helpers) : undefined,
        filterRules: inc.filterRules || cur.filterRules,
        filterLists: inc.filterLists || cur.filterLists,
      }, 'settings');
    }
    await tx.done;
    return { chats: data.chats.length };
  },
};

/** Older data used NovelAI-style names (memory, authorsNote, anDepth, anRole). */
export function normalizeWriting<T>(w: T): T {
  if (!w || typeof w !== 'object') return w;
  const o = { ...(w as Record<string, unknown>) };
  const ren: [string, string][] = [['memory', 'background'], ['authorsNote', 'steering'], ['anDepth', 'steeringDepth'], ['anRole', 'steeringMode']];
  for (const [a, b] of ren) if (a in o) { if (!(b in o)) o[b] = o[a]; delete o[a]; }
  return o as T;
}
export function normalizeChat(c: Chat): Chat {
  return { ...c, writing: normalizeWriting(c.writing) };
}
