// The direct connection opens on one side only, or the other device goes away mid-sync:
// both must fall back to the relay together, and nobody waits forever.
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
async function deviceNoReady(name) {
  const ctx = await b.newContext({ viewport: { width: 1200, height: 850 } });
  // Simulates a direct connection whose first words never arrive: the relay must take over.
  await ctx.addInitScript(() => { const send = RTCDataChannel.prototype.send; RTCDataChannel.prototype.send = function (d) { if (d === 'ready') return; return send.call(this, d); }; });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(`${name}: ${e.message}`));
  await p.goto('http://127.0.0.1:5173');
  await p.waitForSelector('.modal');
  await p.locator('.modal-head .icon').click();
  return p;
}
const openSync = async (p) => {
  await p.getByRole('button', { name: '⇄ Sync devices' }).click();
  await p.locator('.sync details summary').click();
  await p.locator('.sync details input').first().fill(RELAY);
  await p.locator('.sync details input[aria-label="Data relay"]').fill(PIPE);
};
for (const when of ['oneside', 'review']) {
  const desk = await device('desktop');
  const phone = when === 'oneside' ? await deviceNoReady('phone') : await device('phone');
  await openSync(desk);
  await desk.getByRole('button', { name: 'Show code' }).click();
  const code = (await desk.locator('.sync-code .code').innerText({ timeout: 10000 })).trim();
  await openSync(phone);
  await phone.locator('.sync-start input').first().fill(code);
  await phone.getByRole('button', { name: 'Connect' }).click();
  const t0 = Date.now();
  await desk.waitForSelector('.sync .modal-body >> text=Connected to', { timeout: 90000 }).catch(async (e) => { console.log('DESK:', await desk.locator('.sync .modal-body').innerText(), 'PHONE:', await phone.locator('.sync .modal-body').innerText()); throw e; });
  console.log(when, '→ connected after', Date.now() - t0, 'ms:', (await desk.locator('.sync .modal-body p').first().innerText()).slice(0, 80), '| phone:', (await phone.locator('.sync .modal-body').innerText()).slice(0, 80));
  if (when === 'oneside') {
    await desk.getByRole('button', { name: /Sync now|Done/ }).last().click();
    await phone.waitForSelector('.sync .modal-body >> text=Close', { timeout: 40000 });
    console.log('   synced; phone pairs saved:', await phone.evaluate(async () => (await (await import('/src/sync/session.ts')).listPairs()).length));
  } else {
    await phone.locator('.modal-head .icon').click();
    const t1 = Date.now();
    await desk.waitForSelector('.sync .error', { timeout: 60000 });
    console.log('   phone left → desk error after', Date.now() - t1, 'ms:', await desk.locator('.sync .error').innerText());
  }
}
console.log('errors:', errs);
await b.close();
