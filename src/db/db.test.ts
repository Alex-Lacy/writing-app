import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS, openStudioDB, type Migration } from './db';

describe('database upgrades', () => {
  it('creates every table on a fresh install', async () => {
    const d = await openStudioDB('fresh');
    expect([...d.objectStoreNames].sort()).toEqual(['chats', 'kv', 'messages', 'models', 'presets', 'providers']);
    d.close();
  });

  it('upgrades an existing install step by step without losing data', async () => {
    const v1 = await openStudioDB('upgrade', MIGRATIONS.slice(0, 1));
    await v1.put('chats', { id: 'c1', title: 'Kept', createdAt: 1, updatedAt: 1 } as never);
    v1.close();
    // A future version that adds a table (as Phase 2's lorebooks will).
    const addLore: Migration = (d) => { (d as unknown as IDBDatabase).createObjectStore('lorebooks', { keyPath: 'id' }); };
    const v2 = await openStudioDB('upgrade', [...MIGRATIONS.slice(0, 1), addLore]);
    expect(v2.version).toBe(2);
    expect([...v2.objectStoreNames]).toContain('lorebooks');
    expect((await v2.get('chats', 'c1'))?.title).toBe('Kept');
    v2.close();
  });
});
