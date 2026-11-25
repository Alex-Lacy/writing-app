// Device sync when the two devices can't reach each other: both sides must show an explanation
// (the phone used to stay on "Connecting…" forever).
import { chromium } from 'playwright-core';
const RELAY = 'http://localhost:8787/ntfy';
const b = await chromium.launch({ executablePath: process.env.CHROME });
async function device() {
  const ctx = await b.newContext({ viewport: { width: 1000, height: 800 } });
  // Throw away every network address the other side sends: no route between them.
  await ctx.addInitScript(() => {
    const set = RTCPeerConnection.prototype.setRemoteDescription;
    RTCPeerConnection.prototype.setRemoteDescription = function (d) {
      return set.call(this, { type: d.type, sdp: d.sdp.split('\r\n').filter((l) => !l.startsWith('a=candidate')).join('\r\n') });
    };
  });
  const p = await ctx.newPage();
  await p.goto('http://127.0.0.1:5173');
  await p.waitForSelector('.modal');
  await p.locator('.modal-head .icon').click();
  await p.getByRole('button', { name: '⇄ Sync devices' }).click();
  await p.locator('.sync details summary').click();
  await p.locator('.sync details input').first().fill(RELAY);
  return p;
}
const host = await device(), guest = await device();
await host.getByRole('button', { name: 'Show code' }).click();
const code = (await host.locator('.sync-code .code').innerText({ timeout: 10000 })).trim();
await guest.locator('.sync-start input').first().fill(code);
await guest.getByRole('button', { name: 'Connect' }).click();
const t = Date.now();
for (const [n, p] of [['desktop', host], ['phone', guest]]) {
  await p.waitForSelector('.sync .error', { timeout: 60000 });
  console.log(`${n} after ${Math.round((Date.now() - t) / 1000)}s:`, await p.locator('.sync .error').innerText(), '\n ', (await p.locator('.sync-details').innerText()).replace(/\n/g, ' | '));
}
await guest.screenshot({ path: '/tmp/sync-fail.png' });
await b.close();
