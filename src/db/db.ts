import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { AppSettings, Chat, Message, ModelEntry, Preset, ProviderConfig } from '../types';

// All data lives in IndexedDB on the device. Phase 3 sync will layer on top of this
// (every record has an id + timestamps so it can be merged).
interface StudioDB extends DBSchema {
  kv: { key: string; value: unknown };
  providers: { key: string; value: ProviderConfig };
  models: { key: string; value: ModelEntry };
  presets: { key: string; value: Preset };
  chats: { key: string; value: Chat; indexes: { byUpdated: number } };
  messages: { key: string; value: Message; indexes: { byChat: string } };
  // Phase 2: lorebooks, lore entries
}

export interface BackupData {
  version: number;
  exportedAt: number;
  settings?: unknown;
  providers?: ProviderConfig[];
  models?: ModelEntry[];
  presets?: Preset[];
  chats?: Chat[];
  messages?: Message[];
}

let dbp: Promise<IDBPDatabase<StudioDB>> | null = null;

export function db() {
  dbp ??= openDB<StudioDB>('writing-studio', 1, {
    upgrade(d) {
      d.createObjectStore('kv');
      d.createObjectStore('providers', { keyPath: 'id' });
      d.createObjectStore('models', { keyPath: 'key' });
      d.createObjectStore('presets', { keyPath: 'id' });
      d.createObjectStore('chats', { keyPath: 'id' }).createIndex('byUpdated', 'updatedAt');
      d.createObjectStore('messages', { keyPath: 'id' }).createIndex('byChat', 'chatId');
    },
  });
  return dbp;
}

export const repo = {
  async getSettings(): Promise<AppSettings | undefined> {
    return (await (await db()).get('kv', 'settings')) as AppSettings | undefined;
  },
  async putSettings(s: AppSettings) {
    await (await db()).put('kv', s, 'settings');
  },
  async all<T extends 'providers' | 'models' | 'presets' | 'chats'>(store: T): Promise<StudioDB[T]['value'][]> {
    return (await db()).getAll(store);
  },
  async put<T extends 'providers' | 'models' | 'presets' | 'chats' | 'messages'>(store: T, v: StudioDB[T]['value']) {
    await (await db()).put(store, v as never);
  },
  async del(store: 'providers' | 'models' | 'presets' | 'chats' | 'messages', key: string) {
    await (await db()).delete(store, key);
  },
  async messages(chatId: string): Promise<Message[]> {
    const list = await (await db()).getAllFromIndex('messages', 'byChat', chatId);
    return list.sort((a, b) => a.order - b.order);
  },
  async deleteChat(chatId: string) {
    const d = await db();
    const tx = d.transaction(['chats', 'messages'], 'readwrite');
    const keys = await tx.objectStore('messages').index('byChat').getAllKeys(chatId);
    await Promise.all([...keys.map((k) => tx.objectStore('messages').delete(k)), tx.objectStore('chats').delete(chatId)]);
    await tx.done;
  },
  async exportAll(): Promise<BackupData> {
    const d = await db();
    return {
      version: 1,
      exportedAt: Date.now(),
      settings: await d.get('kv', 'settings'),
      providers: (await d.getAll('providers')).map((p) => ({ ...p, apiKey: '' })),
      models: await d.getAll('models'),
      presets: await d.getAll('presets'),
      chats: await d.getAll('chats'),
      messages: await d.getAll('messages'),
    };
  },
  async importAll(data: BackupData) {
    const d = await db();
    const tx = d.transaction(['providers', 'models', 'presets', 'chats', 'messages'], 'readwrite');
    for (const m of data.models ?? []) tx.objectStore('models').put(m);
    for (const p of data.presets ?? []) tx.objectStore('presets').put(p);
    for (const c of data.chats ?? []) tx.objectStore('chats').put(c);
    for (const m of data.messages ?? []) tx.objectStore('messages').put(m);
    await tx.done;
  },
};
