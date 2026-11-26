import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: process.env.CHROME });
const p = await b.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://127.0.0.1:5173');
await p.waitForSelector('.modal');
await p.locator('.modal-head .icon').first().click();
await p.getByRole('button', { name: '+ New story' }).dispatchEvent('click');
await p.waitForTimeout(800);
console.log(await p.evaluate(async () => {
  const st = await import('/src/store/store.ts'); const cx = await import('/src/store/codexStore.ts'); const { repo } = await import('/src/db/db.ts');
  const chat = st.currentChat();
  const own = await cx.ownBook(chat);
  await st.updateChat({ title: 'The royal selection' });
  const renamed = st.useStore.getState().codex.find((x) => x.id === own.id).name;
  await repo.put('codex', { id: 'orphan', name: 'New story (story)', chatId: 'gone', entries: [], createdAt: 0, updatedAt: 0 });
  await repo.put('codex', { id: 'lib', name: 'The World', entries: [], createdAt: 0, updatedAt: 0 });
  return 'renamed: ' + renamed;
}));
await p.reload(); await p.waitForTimeout(1200);
console.log(await p.evaluate(async () => {
  const { repo } = await import('/src/db/db.ts');
  const all = await repo.all('codex');
  return 'after reload: ' + all.map((x) => x.name).join(' | ');
}));
console.log('errors:', errs);
await b.close();
