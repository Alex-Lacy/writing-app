// Device sync between two browser profiles (desktop = host, phone = guest), through a local
// ntfy stand-in: first sync, one-sided change, a real conflict (keep both), deletion, undo.
import { chromium } from 'playwright-core';
const RELAY = 'http://localhost:8787/ntfy';
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
const add = async (p, text) => {
  await p.locator('.composer textarea').fill(text);
  await p.getByRole('button', { name: 'Add only' }).click();
  await p.waitForTimeout(250);
};
const newStory = async (p, text) => {
  await p.getByRole('button', { name: '+ New story' }).click();
  await p.waitForTimeout(300);
  await add(p, text);
};
const stories = (p) => p.locator('.chat-item').count();
const openStory = async (p, i) => { await p.locator('.chat-item').nth(i).click(); await p.waitForTimeout(300); };
const texts = (p) => p.locator('.msg .markdown, .msg-body').allInnerTexts();

async function sync(host, guest, pick) {
  await host.getByRole('button', { name: '⇄ Sync devices' }).click();
  await host.locator('.sync details summary').click();
  await host.locator('.sync details input').fill(RELAY);
  await host.getByRole('button', { name: 'Show code' }).click();
  const code = (await host.locator('.sync-code .code').innerText({ timeout: 10000 })).trim();
  await guest.getByRole('button', { name: '⇄ Sync devices' }).click();
  await guest.locator('.sync details summary').click();
  await guest.locator('.sync details input').fill(RELAY);
  await guest.locator('.sync-start input').first().fill(code);
  await guest.getByRole('button', { name: 'Connect' }).click();
  await host.waitForSelector('.sync .modal-body >> text=Connected to', { timeout: 40000 });
  const items = await host.locator('.sync-item').allInnerTexts();
  if (pick) await host.locator('.sync-item.conflict label', { hasText: pick }).first().click();
  await host.getByRole('button', { name: /Sync now|Done/ }).click();
  await host.waitForSelector('.sync .modal-body >> text=/Done|Nothing to change/', { timeout: 40000 }).catch(async (e) => { console.log('HOST:', await host.locator('.sync .modal-body').innerText(), 'GUEST:', await guest.locator('.sync .modal-body').innerText()); throw e; });
  await guest.waitForSelector('.sync .modal-body >> text=/Done|Nothing to change/', { timeout: 40000 }).catch(async (e) => { console.log('HOST:', await host.locator('.sync .modal-body').innerText(), 'GUEST:', await guest.locator('.sync .modal-body').innerText()); throw e; });
  const hostSays = await host.locator('.sync .modal-body p').first().innerText();
  const guestSays = await guest.locator('.sync .modal-body p').first().innerText();
  await host.getByRole('button', { name: 'Close' }).click();
  await guest.getByRole('button', { name: 'Close' }).click();
  return { items: items.map((t) => t.replace(/\s+/g, ' ').slice(0, 90)), hostSays, guestSays };
}

const desk = await device('desktop');
const phone = await device('phone');
await newStory(desk, 'Alpha one.');
await newStory(phone, 'Beta one.');

console.log('1 first sync:', await sync(desk, phone));
console.log('   stories desk/phone:', await stories(desk), await stories(phone));

// One-sided change: phone adds to Alpha.
await openStory(phone, (await phone.locator('.chat-item').allInnerTexts()).findIndex(() => true));
const findStory = async (p, word) => {
  const n = await stories(p);
  for (let i = 0; i < n; i++) { await openStory(p, i); if ((await texts(p)).join(' ').includes(word)) return i; }
  return -1;
};
await findStory(phone, 'Alpha');
await add(phone, 'Alpha two from phone.');
console.log('2 one-sided:', (await sync(desk, phone)).items);
await findStory(desk, 'Alpha');
console.log('   desk Alpha:', (await texts(desk)).join(' | '));

// Conflict: both add different text to Alpha.
await add(desk, 'Desk three.');
await findStory(phone, 'Alpha');
await add(phone, 'Phone three.');
const c = await sync(desk, phone, 'Keep both');
console.log('3 conflict:', c.items, c.hostSays);
console.log('   stories desk/phone:', await stories(desk), await stories(phone), await desk.locator('.chat-item').allInnerTexts());

// Nothing changed: should match.
console.log('4 again:', (await sync(desk, phone)).hostSays);

// Deletion on desk passes to phone.
await findStory(desk, 'Beta');
desk.once('dialog', (d) => d.accept());
await desk.locator('.chat-item.active button[title*="Delete"], .chat-item.active .icon-del').first().click().catch(async () => { await desk.locator('.chat-item.active').hover(); await desk.locator('.chat-item.active button').last().click(); });
await desk.waitForTimeout(400);
const d = await sync(desk, phone);
console.log('5 delete:', d.items, 'phone stories:', await stories(phone));

// Undo on phone brings Beta back.
await phone.getByRole('button', { name: '⇄ Sync devices' }).click();
phone.once('dialog', (dd) => dd.accept());
await phone.getByRole('button', { name: 'Undo it' }).click();
await phone.waitForSelector('text=Undone');
await phone.getByRole('button', { name: 'Close' }).click();
console.log('6 undo: phone stories:', await stories(phone));
console.log('errors:', errs);
await b.close();
