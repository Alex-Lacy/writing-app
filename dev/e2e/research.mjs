// Research Helper: asks for lookups, the app runs them (wiki API faked here), sources show, a Codex card comes back.
import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: process.env.CHROME });
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.route('https://witcher.fandom.com/api.php**', (route) => {
  const u = new URL(route.request().url());
  const body = u.searchParams.get('action') === 'parse'
    ? { parse: { title: 'Yennefer of Vengerberg', text: { '*': '<aside class="portable-infobox"><div class="pi-item pi-data"><h3 class="pi-data-label">Born</h3><div class="pi-data-value">1173</div></div></aside><h2>Biography<span class="mw-editsection">[edit]</span></h2><p>Yennefer is a sorceress.<sup class="reference">[1]</sup></p><ul><li>Lives in Vengerberg</li></ul><script>x</script>' } } }
    : { query: { search: [{ title: 'Yennefer of Vengerberg', snippet: 'A <span>sorceress</span>' }] } };
  route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
});
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
await p.locator('.helper select').selectOption('helper-research');
await p.locator('.helper-input textarea').fill('Tell me about Yennefer');
await p.keyboard.press('Enter');
await p.waitForSelector('.helper .sg-card', { timeout: 30000 });
console.log('lookups line:', await p.locator('.helper-lookups summary').innerText());
await p.locator('.helper-lookups summary').click();
console.log('source link:', await p.locator('.helper-lookups a').getAttribute('href'));
const txt = await p.locator('.lookup-text').innerText();
console.log('page text has infobox + body, no refs/script:', /Born: 1173/.test(txt), /Yennefer is a sorceress\./.test(txt), !/\[1\]|\[edit\]/.test(txt));
console.log('messages:', await p.locator('.helper .helper-msg').allInnerTexts().then((x) => x.map((t) => t.split('\n')[0].slice(0, 50))));
console.log('card:', (await p.locator('.helper .sg-card').first().innerText()).split('\n').slice(0, 2).join(' | '));
await p.locator('.helper').screenshot({ path: '/tmp/research.png' });
console.log('errors:', errs);
await b.close();
