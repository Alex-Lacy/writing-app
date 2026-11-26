import { chromium, devices } from 'playwright-core';
const b = await chromium.launch({ executablePath: process.env.CHROME });
for (const [name, opts] of [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', devices['Pixel 7']]]) {
  const p = await b.newPage(opts);
  await p.goto('http://127.0.0.1:5173');
  await p.waitForSelector('.modal');
  await p.locator('.modal-head .icon').first().click();
  await p.getByRole('button', { name: '+ New story' }).dispatchEvent('click');
  const ta = p.locator('.helper-input textarea');
  await ta.click(); await p.keyboard.type('one'); await p.keyboard.press('Enter'); await p.keyboard.type('two');
  console.log(name, JSON.stringify(await ta.inputValue()), '| sent msgs:', await p.locator('.helper-msg.user').count());
  await p.close();
}
await b.close();
