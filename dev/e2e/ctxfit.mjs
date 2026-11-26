import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1280, height: 860 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
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
await p.getByRole('button', { name: '+ New story' }).dispatchEvent('click');
await p.waitForTimeout(800);
await p.evaluate(async () => (await import('/src/store/store.ts')).ui.openHelper('helper-codex'));
const sent = [];
p.on('request', (r) => { if (r.url().includes('/chat/completions')) { const j = JSON.parse(r.postData() || '{}'); sent.push({ msgs: j.messages.length, max: j.max_tokens }); } });
// A long earlier conversation, then a message on a plan with a small window.
for (let i = 0; i < 3; i++) {
  await p.locator('.helper-input textarea').fill(`Earlier note ${i}: ` + 'lorem ipsum dolor sit amet '.repeat(400));
  await p.keyboard.press('Enter');
  await p.waitForTimeout(3000); console.log(i, await p.locator('.helper-msg').count(), await p.locator('.helper .error').allInnerTexts());
}
sent.length = 0;
await p.locator('.helper-input textarea').fill('TINYCTX tidy the Codex');
await p.keyboard.press('Enter');
await p.waitForFunction(() => document.querySelectorAll('.helper-msg.assistant').length === 4 || document.querySelector('.helper .error'), null, { timeout: 20000 });
console.log('requests:', sent, '| error shown:', await p.locator('.helper .error').count(), '| learned:', await p.evaluate(() => Object.entries(localStorage).filter(([k]) => k.startsWith('ctx:'))));
console.log('errors:', errs);
await b.close();
