// Helper: replies keep going with the panel closed; Copy/Edit/Retry/Delete/Stop.
import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: process.env.CHROME });
const p = await b.newPage({ viewport: { width: 1280, height: 860 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
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
await p.getByRole('button', { name: '+ New story' }).click();
await p.waitForSelector('.helper');
// Send, close the panel at once, wait, reopen.
await p.locator('.helper-input textarea').fill('SLOWHELP a noir story');
await p.keyboard.press('Enter');
await p.waitForSelector('.helper-input button:has-text("Stop")');
await p.waitForTimeout(1500);
console.log('progress:', await p.locator('.helper-progress').innerText());
await p.locator('.helper').screenshot({ path: '/tmp/helper-progress.png' });
await p.locator('.panel-head .icon[title="Close"]').click();
await p.waitForSelector('.jobs');
console.log('indicator while closed:', await p.locator('.jobs').first().innerText());
await p.waitForSelector('.jobs.done', { timeout: 30000 });
console.log('after:', await p.locator('.jobs.done').innerText());
await p.locator('.jobs.done').click();
await p.waitForSelector('.helper .helper-msg.assistant');
console.log('messages after reopen:', await p.locator('.helper .helper-msg').count(), 'cards:', await p.locator('.helper .sg-card').count());
// Retry the reply: old cards go, a new reply comes.
await p.locator('.helper-msg.assistant .helper-actions button:has-text("Retry")').click();
await p.waitForSelector('.helper-input button:has-text("Stop")');
await p.waitForSelector('.helper-input button:has-text("Send")', { timeout: 30000 });
console.log('after retry:', await p.locator('.helper .helper-msg').count(), 'messages');
// Stop mid-reply keeps the partial text.
await p.locator('.helper-input textarea').fill('SLOWHELP more please');
await p.keyboard.press('Enter');
await p.waitForTimeout(1200);
await p.locator('.helper-input button:has-text("Stop")').click();
await p.waitForSelector('.helper-input button:has-text("Send")');
console.log('after stop:', await p.locator('.helper .helper-msg').count(), 'messages; last:', (await p.locator('.helper .helper-msg').last().innerText()).slice(0, 40));
// Edit the second question: it and its reply go, text returns to the box.
await p.locator('.helper-msg.user').nth(1).locator('button:has-text("Edit")').click();
await p.waitForTimeout(200);
console.log('after edit:', await p.locator('.helper .helper-msg').count(), 'messages; box:', await p.locator('.helper-input textarea').inputValue());
// Delete the first reply.
await p.locator('.helper-msg.assistant').first().locator('button:has-text("Delete")').click();
await p.waitForTimeout(200);
console.log('after delete:', await p.locator('.helper .helper-msg').count(), 'messages');
await p.screenshot({ path: '/tmp/helper.png' });
console.log('errors:', errs);
await b.close();
