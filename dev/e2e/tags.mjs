import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: process.env.CHROME });
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://127.0.0.1:5173');
await p.waitForSelector('.modal');
await p.locator('.modal-head .icon').first().click();
await p.getByRole('button', { name: '+ New story' }).dispatchEvent('click');
await p.waitForTimeout(500);
await p.locator('.panel-tabs button:has-text("Setup")').click();
await p.locator('.tag-input').fill('noir, slow burn, explicit');
await p.keyboard.press('Enter');
const tags = () => p.locator('.src-tags .tag').allInnerTexts().then((a) => a.map((t) => t.replace('×', '').trim()));
console.log('start:', await tags());
// Edit the first tag in place.
await p.locator('.src-tags .tag').first().click();
await p.locator('.tag-edit').fill('dark noir');
await p.keyboard.press('Enter');
console.log('edited:', await tags());
// Drag the last tag to the front.
const last = await p.locator('.src-tags .tag').nth(2).boundingBox(), first = await p.locator('.src-tags .tag').nth(0).boundingBox();
await p.mouse.move(last.x + 10, last.y + last.height / 2); await p.mouse.down();
await p.mouse.move(first.x + 5, first.y + first.height / 2, { steps: 8 }); await p.mouse.up();
await p.waitForTimeout(200);
console.log('dragged:', await tags());
console.log('errors:', errs);
await b.close();
