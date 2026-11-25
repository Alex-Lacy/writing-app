// Codex → Import lorebook: the two-way chooser, an odd JSON shape, the hand-off from a file the
// direct importer can't read, extraction from a long story (parts, merge, Add / Add all), and .docx reading.
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
const odd = '/tmp/odd.json', bad = '/tmp/notes.json', story = '/tmp/old-story.txt';
writeFileSync(odd, JSON.stringify({ kind: 'memory', entries: [{ name: 'Rell', entry: 'A smuggler.', keywords: ['Rell'] }, { name: 'Docks', entry: 'Rotting piers.', keywords: 'docks, pier' }] }));
writeFileSync(bad, JSON.stringify({ chapter: 'Mara met Rell at the docks of Harrowgate.' }));
const filler = 'Rain fell on the roofs and nobody said anything for a long while. '.repeat(150);
writeFileSync(story, [`Mara walked into Harrowgate.\n\n${filler}`, `${filler}\n\nRell waited on the pier.`, `${filler}\n\nMara found Rell again.`].join('\n\n'));
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
const fileIn = p.locator('.lore-import input[type=file]');

// 1. An odd JSON shape goes straight in.
await p.getByRole('button', { name: 'Import lorebook…' }).click();
await p.screenshot({ path: '/tmp/extract-choose.png' });
await fileIn.nth(0).setInputFiles(odd);
await p.waitForSelector('.lore-entry');
console.log('odd json:', await p.locator('.lore-import .card p').first().innerText());
await p.getByRole('button', { name: 'Cancel' }).click();

// 2. A JSON with no entries offers extraction instead.
await fileIn.nth(0).setInputFiles(bad);
await p.getByRole('button', { name: 'Extract entries from it with Helper instead' }).click();
await p.waitForSelector('.extract-row', { timeout: 20000 });
await p.waitForSelector('.extract >> text=Close', { timeout: 20000 });
console.log('hand-off found:', await p.locator('.extract-row summary b').allInnerTexts());
await p.locator('.extract').getByRole('button', { name: 'Close' }).click();

// 3. A long story: several parts, merged, then Add one and Add all.
await fileIn.nth(1).setInputFiles(story);
await p.waitForSelector('.extract .meter-bar');
await p.waitForSelector('.extract >> text=Close', { timeout: 30000 });
console.log('story:', await p.locator('.extract > p').first().innerText(), '·', await p.locator('.extract-row summary b').allInnerTexts());
await p.locator('.extract-row').first().locator('summary').click();
await p.screenshot({ path: '/tmp/extract-results.png' });
await p.locator('.extract-row').first().getByRole('button', { name: 'Add' }).click();
await p.waitForSelector('text=Added ✓');
await p.getByRole('button', { name: /Add all 2/ }).click();
await p.waitForFunction(() => document.querySelectorAll('.extract-row button').length === 0);
console.log('codex entries:', await p.locator('.cx-entry').count());

// 4. Again: now everything matches existing entries.
await p.locator('.extract').getByRole('button', { name: 'Close' }).click();
await p.locator('.lore-choose textarea').fill('Mara and Rell argued in Harrowgate.');
await p.getByRole('button', { name: 'Extract', exact: true }).click();
await p.waitForSelector('.extract >> text=Close', { timeout: 20000 });
console.log('second pass tags:', await p.locator('.extract .tag-dupe').count());
await p.getByRole('button', { name: /Add all 3/ }).click();
await p.waitForFunction(() => document.querySelectorAll('.extract-row button').length === 0);
console.log('codex entries after adding to existing:', await p.locator('.cx-entry').count());

// 5. .docx and .epub-style zips read in the browser.
const docx = await p.evaluate(async () => {
  const { toDocx } = await import('/src/features/compile.ts');
  const { readSource } = await import('/src/features/extract.ts');
  const blob = toDocx('# Title\n\nFirst paragraph about Mara.\n\nSecond about Rell.');
  return readSource(new File([blob], 'x.docx'));
});
console.log('docx text:', JSON.stringify(docx));
console.log('errors:', errs);
await b.close();
