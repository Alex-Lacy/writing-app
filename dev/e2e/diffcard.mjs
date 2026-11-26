import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: process.env.CHROME });
const p = await b.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
await p.goto('http://127.0.0.1:5173');
await p.waitForSelector('.modal');
await p.locator('.modal-head .icon').first().click();
await p.getByRole('button', { name: '+ New story' }).dispatchEvent('click');
await p.evaluate(async () => {
  const st = await import('/src/store/store.ts');
  const sg = await import('/src/store/suggestions.ts');
  await sg.addSuggestions(st.useStore.getState().currentChatId, [{ source: 'helper', target: { kind: 'steering' }, reason: 'Softens the rotation instruction.',
    before: 'Keep the tone playful and absurd. Rotate through the camps and characters, giving each major pairing at least one scene. No excessive angst or philosophizing; keep the drama moving.',
    after: 'Keep the tone playful and absurd. Give each major pairing at least one scene over the course of the story, but let scene changes arise from the current moment. No excessive angst or philosophizing; keep the drama moving.' }]);
  st.ui.openPanel('suggestions');
});
await p.waitForSelector('.sg-diff');
await p.locator('.sg-card').first().screenshot({ path: '/tmp/diffcard.png' });
await b.close();
