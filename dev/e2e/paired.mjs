// Paired sync: sync once with a code, then later sync with "Sync now" (the other device answers by itself).
import { chromium } from 'playwright-core';
const RELAY = 'http://localhost:8787/ntfy';
const PIPE = 'http://localhost:8787/pipe';
const b = await chromium.launch({ executablePath: process.env.CHROME, args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
const errs = [];
async function device(name) {
  const ctx = await b.newContext({ viewport: { width: 1200, height: 850 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(`${name}: ${e.message}`));
  await p.goto('http://127.0.0.1:5173');
  await p.waitForSelector('.modal');
  await p.locator('.modal-head .icon').click();
  return p;
}
const newStory = async (p, text) => {
  await p.getByRole('button', { name: '+ New story' }).click();
  await p.waitForTimeout(300);
  await p.locator('.composer textarea').fill(text);
  await p.getByRole('button', { name: 'Add only' }).click();
  await p.waitForTimeout(250);
};
const openSync = async (p) => {
  await p.getByRole('button', { name: '⇄ Sync devices' }).click();
  await p.locator('.sync details summary').click();
  await p.locator('.sync details input').first().fill(RELAY);
  await p.locator('.sync details input[aria-label="Data relay"]').fill(PIPE);
};
const body = (p) => p.locator('.sync .modal-body').innerText();

const desk = await device('desktop');
const phone = await device('phone');
await newStory(desk, 'Alpha one.');

// 1. Pair with a code.
await openSync(desk);
await desk.getByRole('button', { name: 'Show code' }).click();
const code = (await desk.locator('.sync-code .code').innerText({ timeout: 10000 })).trim();
await openSync(phone);
await phone.locator('.sync-start input').first().fill(code);
await phone.getByRole('button', { name: 'Connect' }).click();
await desk.waitForSelector('.sync .modal-body >> text=Connected to', { timeout: 40000 });
await desk.getByRole('button', { name: /Sync now|Done/ }).click();
await desk.waitForSelector('.sync .modal-body >> text=Close', { timeout: 40000 });
await phone.waitForSelector('.sync .modal-body >> text=Close', { timeout: 40000 });
await desk.getByRole('button', { name: 'Close' }).click();
await phone.getByRole('button', { name: 'Close' }).click();
console.log('1 paired. phone stories:', await phone.locator('.chat-item').count());

// 2. Phone writes something; desk presses Sync now. The phone's modal is closed.
await newStory(phone, 'Beta from phone.');
await desk.getByRole('button', { name: '⇄ Sync devices' }).click();
console.log('2 desk devices card:', (await desk.locator('.sync-pairs').innerText()).replace(/\s+/g, ' '));
await desk.locator('.sync-pair').getByRole('button', { name: 'Sync now' }).click();
await desk.waitForSelector('.sync .modal-body >> text=Connected to', { timeout: 40000 }).catch(async (e) => { console.log('DESK:', await body(desk)); throw e; });
console.log('   phone modal opened by itself:', await phone.locator('.sync').count(), '|', (await body(phone)).replace(/\s+/g, ' ').slice(0, 100));
console.log('   desk review:', (await desk.locator('.sync-item').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ')));
await desk.getByRole('button', { name: /Sync now|Done/ }).last().click();
await desk.waitForSelector('.sync .modal-body >> text=Close', { timeout: 40000 });
await phone.waitForSelector('.sync .modal-body >> text=Close', { timeout: 40000 });
console.log('   desk says:', await desk.locator('.sync .modal-body p').first().innerText(), '| phone says:', await phone.locator('.sync .modal-body p').first().innerText());
await desk.getByRole('button', { name: 'Close' }).click();
await phone.getByRole('button', { name: 'Close' }).click();
console.log('   desk stories:', await desk.locator('.chat-item').count());

// 3. The other way round, from the phone.
await newStory(desk, 'Gamma from desk.');
await phone.getByRole('button', { name: '⇄ Sync devices' }).click();
await phone.locator('.sync-pair').getByRole('button', { name: 'Sync now' }).click();
await phone.waitForSelector('.sync .modal-body >> text=Connected to', { timeout: 40000 });
await phone.getByRole('button', { name: /Sync now|Done/ }).last().click();
await phone.waitForSelector('.sync .modal-body >> text=Close', { timeout: 40000 });
await desk.waitForSelector('.sync .modal-body >> text=Close', { timeout: 40000 });
await phone.getByRole('button', { name: 'Close' }).click();
await desk.getByRole('button', { name: 'Close' }).click();
console.log('3 phone stories:', await phone.locator('.chat-item').count());

// 4. Forget, and a knock to a device that isn't listening fails politely.
await desk.getByRole('button', { name: '⇄ Sync devices' }).click();
desk.once('dialog', (d) => d.accept());
await desk.locator('.sync-pair').getByRole('button', { name: 'Forget' }).click();
await desk.waitForTimeout(300);
console.log('4 desk pairs after forget:', await desk.locator('.sync-pair').count());
await phone.getByRole('button', { name: '⇄ Sync devices' }).click();
await phone.locator('.sync-pair').getByRole('button', { name: 'Sync now' }).click();
await phone.waitForSelector('.sync .error', { timeout: 30000 });
console.log('   phone error:', await phone.locator('.sync .error').innerText());
console.log('errors:', errs);
await b.close();
