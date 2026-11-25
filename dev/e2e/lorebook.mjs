// Codex → Import lorebook: preview, untick, duplicates, import, then Tidy with Helper.
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
const file = '/tmp/World.lorebook';
writeFileSync(file, JSON.stringify({
  lorebookVersion: 5,
  entries: [
    { displayName: 'Rell', keys: ['Rell'], text: '[ Rell: smuggler; Attributes: sly ]', category: 'c1' },
    { displayName: 'Mara', keys: ['Mara'], text: 'The detective.', category: 'c1' },
    { displayName: 'Old docks', keys: ['docks'], text: 'Rotting piers.', category: 'c2', enabled: false },
  ],
  categories: [{ id: 'c1', name: 'Characters', enabled: true }, { id: 'c2', name: 'Places', enabled: true }],
}));
const b = await chromium.launch({ executablePath: process.env.CHROME });
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://127.0.0.1:5173');
await p.waitForSelector('.modal');
const card = p.locator('.card').first();
await card.locator('.provider-more summary').click();
await card.getByLabel('Address (base URL)').fill('http://localhost:8787/v1');
await card.getByLabel('Name', { exact: true }).fill('Mock');
await card.locator('input[type=password]').fill('test-key');
await card.getByText('Test connection').click();
await p.waitForSelector('text=Connected, 2 models');
await card.getByText('Pick models').click();
await p.getByText('Fetch model list').click();
await p.locator('.remote-row button').nth(0).click();
await p.locator('.modal-head .icon').click();
await p.getByRole('button', { name: '+ New story' }).click();
await p.locator('.panel-tabs button:has-text("Codex")').click();
await p.locator('.lore-import input[type=file]').nth(0).setInputFiles(file);
await p.waitForSelector('.lore-entry');
console.log('preview:', await p.locator('.lore-entry').count(), 'entries; ticked:', await p.locator('.lore-entry input:checked').count());
await p.locator('.lore-import').screenshot({ path: '/tmp/lore-preview.png' });
await p.getByRole('button', { name: /Import 2 entries/ }).click();
await p.waitForSelector('text=Imported: 2 added');
console.log('codex entries:', await p.locator('.cx-entry').count());
// Import again: both are duplicates now.
await p.locator('.lore-import input[type=file]').nth(0).setInputFiles(file);
await p.waitForSelector('.tag-dupe');
console.log('dupes flagged:', await p.locator('.tag-dupe').count());
await p.getByRole('button', { name: /Import 2 entries/ }).click();
await p.waitForSelector('text=2 skipped as duplicates');
console.log('codex entries after re-import (skip):', await p.locator('.cx-entry').count());
await p.getByRole('button', { name: 'Close' }).click();
// Fresh import then tidy.
await p.locator('.lore-import input[type=file]').nth(0).setInputFiles(file);
await p.locator('.lore-entry input').nth(2).check();
await p.locator('.lore-import select').nth(1).selectOption('replace');
await p.getByRole('button', { name: /Import 3 entries/ }).click();
await p.waitForSelector('text=2 replaced');
await p.getByRole('button', { name: 'Tidy with Helper' }).click();
await p.waitForSelector('text=Done:', { timeout: 30000 });
console.log('tidy:', await p.locator('.lore-import .card p').last().innerText());
await p.getByRole('button', { name: 'Open Suggestions' }).click();
console.log('cards:', await p.locator('.sg-card').count());
console.log('errors:', errs);
await b.close();
