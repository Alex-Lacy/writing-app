// A model whose template opens the think block: only </think> is streamed. The reasoning must end
// up in the thinking section, not the story text.
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
await p.locator('.remote-row', { hasText: 'reasoner' }).locator('button').click();
await p.locator('.modal-head .icon').click();
await p.locator('.composer textarea').fill('LONECLOSE Mara at the docks');
await p.keyboard.press('Enter');
await p.waitForFunction(() => !document.querySelector('.composer button.stop, button[title^="Stop"]'), null, { timeout: 20000 }).catch(() => {});
await p.waitForTimeout(1500);
const text = await p.locator('.msg-assistant .msg-body').last().innerText().catch(() => '');
console.log('reply has reasoning in text:', /Let me think/.test(text), '| reply:', text.slice(0, 60).replace(/\n/g, ' '));
console.log('model:', await p.locator('.msg-assistant .msg-role').last().innerText(), '| thinking section:', await p.locator('.msg-assistant .reasoning').count(), await p.locator('.msg-assistant .reasoning-body').last().textContent().catch(() => ''));
console.log('errors:', errs);
await b.close();
