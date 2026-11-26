import { chromium, devices } from 'playwright-core';
const b = await chromium.launch({ executablePath: process.env.CHROME });
for (const [name, opts] of [['desktop', { viewport: { width: 1280, height: 700 } }], ['phone', devices['Pixel 7']]]) {
  const p = await b.newPage(opts);
  await p.goto('http://127.0.0.1:5173');
  await p.waitForSelector('.modal');
  await p.locator('.modal-head .icon').first().click();
  await p.getByRole('button', { name: '+ New story' }).dispatchEvent('click');
  // Fill the log with tall messages so it scrolls.
  await p.locator('.helper-log').evaluate((l) => { for (let i = 0; i < 40; i++) { const d = document.createElement('p'); d.textContent = 'filler ' + i; d.style.height = '60px'; l.appendChild(d); } });
  await p.locator('.helper').evaluate((h) => { h.scrollTop = h.scrollHeight; });
  await p.waitForTimeout(200);
  const top = await p.locator('.helper').boundingBox(), sel = await p.locator('.helper-top select').boundingBox();
  console.log(name, 'scrolled', await p.locator('.helper').evaluate((h) => h.scrollTop), '| picker at', Math.round(sel.y - top.y), 'px from top, visible:', sel.y >= top.y - 1);
  await p.locator('.helper-top select').selectOption('helper-plot');
  console.log(name, 'switched to', await p.locator('.helper-top select').inputValue());
  await p.screenshot({ path: `/tmp/top-${name}.png` });
  await p.close();
}
await b.close();
