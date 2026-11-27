// Style modules and custom Helpers travel with a sync, edits and deletions too.
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

const save = (p, patch) => p.evaluate(async (x) => (await import('/src/store/store.ts')).saveSettings(x), patch);
const lib = (p) => p.evaluate(async () => { const s = (await import('/src/store/store.ts')).useStore.getState().settings; return { styles: (s.styles ?? []).map((m) => `${m.name}=${m.text}`), helpers: (s.helpers ?? []).map((h) => h.name) }; });
async function sync(desk, phone, first) {
  if (first) {
    await openSync(desk);
    await desk.getByRole('button', { name: 'Show code' }).click();
    const code = (await desk.locator('.sync-code .code').innerText({ timeout: 10000 })).trim();
    await openSync(phone);
    await phone.locator('.sync-start input').first().fill(code);
    await phone.getByRole('button', { name: 'Connect' }).click();
  } else {
    await desk.getByRole('button', { name: '⇄ Sync devices' }).click();
    await desk.locator('.sync-pair').getByRole('button', { name: 'Sync now' }).click();
  }
  await desk.waitForSelector('.sync .modal-body >> text=Connected to', { timeout: 60000 });
  const items = (await desk.locator('.sync-item').allInnerTexts()).map((t) => t.replace(/\s+/g, ' '));
  await desk.getByRole('button', { name: /Sync now|Done/ }).last().click();
  await desk.waitForSelector('.sync .modal-body >> text=Close', { timeout: 40000 });
  await phone.waitForSelector('.sync .modal-body >> text=Close', { timeout: 40000 });
  await desk.getByRole('button', { name: 'Close' }).click();
  await phone.getByRole('button', { name: 'Close' }).click();
  return items;
}
const desk = await device('desktop');
const phone = await device('phone');
await save(desk, { styles: [{ id: 'st1', name: 'Terse', text: 'Short sentences.' }, { id: 'st2', name: 'Lush', text: 'Rich imagery.' }], helpers: [{ id: 'hp1', name: 'Namer', blurb: 'Names things', instructions: 'Suggest names.' }] });
console.log('1 plan:', await sync(desk, phone, true));
console.log('  phone library:', await lib(phone));
await save(phone, { styles: [{ id: 'st1', name: 'Terse', text: 'Very short sentences.' }] }); // edits Terse, deletes Lush
await phone.evaluate(async () => (await import('/src/sync/units.ts')).noteGone('st2'));
console.log('2 plan:', await sync(desk, phone));
console.log('  desk library:', await lib(desk));
console.log('errors:', errs);
await b.close();
