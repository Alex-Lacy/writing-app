import { chromium } from 'playwright-core';
import fs from 'node:fs';
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1280, height: 860 } });
const bodies = []; const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('request', (r) => { if (r.url().includes('8787/v1/chat') && r.method() === 'POST') bodies.push(JSON.parse(r.postData())); });
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
// Setup via New story helper (captures the helper body), accept all cards
await p.getByRole('button', { name: '+ New story' }).click();
await p.waitForSelector('.helper');
await p.locator('.helper-input textarea').fill('A noir detective story in a rainy port city called Saltmere. Mara Voss, a harbour detective with a scar on her left hand, hunts the smuggler Orrin Kessler with her nervous clerk partner Tobias Finch. Captain Rell runs the harbour watch. Third person past tense, gritty, explicit violence allowed. Just go.');
await p.keyboard.press('Enter');
await p.waitForSelector('.helper .sg-card');
await p.waitForTimeout(400);
// Put the real setup in place instead of the mock's
await p.locator('.panel-tabs button:has-text("Setup")').click();
await p.locator('.composer textarea').fill('Mara and Tobias search Kessler\'s warehouse at night. LIVESTORY');
await p.locator('.composer button.primary').click();
await p.waitForSelector('.msg-assistant .cliche-chip', { timeout: 20000 });
await p.waitForTimeout(1500);
await p.locator('.cliche-chip').click();
await p.locator('.cliche-list button:has-text("Fix all")').click();
await p.waitForTimeout(1500);
// Rewrite a passage via selection
await p.evaluate(() => {
  const ps = [...document.querySelectorAll('.msg-assistant .msg-body p')];
  const el = ps.find((x) => x.textContent.startsWith('Mara didn'));
  const r = document.createRange(); r.selectNodeContents(el); getSelection().removeAllRanges(); getSelection().addRange(r);
});
await p.waitForSelector('.sel-bar');
await p.locator('.sel-bar button').click();
await p.locator('.rewrite-box textarea').fill('Make it tighter and more tense; cut the explanation.');
await p.locator('.rewrite-box button:has-text("Rewrite")').click();
await p.waitForTimeout(1500);
await p.locator('.rewrite-box button:has-text("Cancel")').click().catch(() => {});
// Proofread the whole message
await p.locator('.msg-assistant').hover();
await p.locator('.msg-assistant .msg-actions button:has-text("Rewrite")').click();
await p.locator('.rewrite-box button:has-text("Proofread")').click();
await p.waitForTimeout(1500);
// Updates now
await p.locator('.panel-tabs button:has-text("Suggestions")').click();
await p.locator('button:has-text("Update notes now")').click().catch((e) => errs.push('no update btn'));
await p.waitForTimeout(1500);
// Style editor helper
await p.locator('.panel-tabs button:has-text("Helper")').click();
await p.locator('.helper select').selectOption({ label: 'Style editor' }).catch(async () => { const o = await p.locator('.helper select option').allInnerTexts(); errs.push('opts ' + o); });
await p.locator('.helper-input textarea').fill('Make me a style module for hardboiled noir narration: short sentences, concrete detail, no purple prose. Also suggest tags for this story.');
await p.keyboard.press('Enter');
await p.waitForTimeout(2500);
const kind = (bd) => { const s = bd.messages[0]?.content ?? ''; return s.includes('```changes') ? 'helper' : s.includes('remove stock phrases') ? 'filter' : s.includes('revising a passage') ? 'rewrite' : s.includes('You proofread') ? 'proofread' : s.includes('maintain the notes') ? 'updates' : 'story'; };
fs.writeFileSync('process.env.OUT || 'bodies.json'', JSON.stringify(bodies.map((x) => ({ kind: kind(x), body: x })), null, 1));
console.log(bodies.map(kind), errs);
await b.close();
