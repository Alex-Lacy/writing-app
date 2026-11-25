// Export → Proofread the whole story: runs in the background, cards appear, re-run skips checked.
import { chromium } from 'playwright-core';
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
for (const t of ['Mara walks to the docks.', 'Rell waits by the crates.']) {
  await p.locator('.composer textarea').fill(t);
  await p.keyboard.press('Enter');
  await p.waitForSelector('.composer button:has-text("Send")', { timeout: 20000 });
  await p.waitForTimeout(400);
}
await p.locator('.panel-head button:has-text("Export")').click();
await p.locator('.story-proof summary').click();
console.log('before:', await p.locator('.story-proof summary').innerText());
await p.getByRole('button', { name: 'Proofread the whole story' }).click();
await p.waitForSelector('.story-proof >> text=Review', { timeout: 60000 });
await p.waitForFunction(() => !document.querySelector('.story-proof .spinner'), null, { timeout: 60000 });
console.log('after:', await p.locator('.story-proof p.small').last().innerText());
console.log('summary:', await p.locator('.story-proof summary').innerText());
await p.locator('.story-proof').screenshot({ path: '/tmp/proofstory.png' });
await p.getByRole('button', { name: /Review \d+ correction/ }).click();
console.log('cards in Suggestions:', await p.locator('.sg-card').count(), 'inline:', await p.locator('.msg-cards').count());
console.log('errors:', errs);
await b.close();
