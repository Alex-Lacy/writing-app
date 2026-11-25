import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const ctx = await b.newContext();
const p = await ctx.newPage();
await p.goto('http://localhost:4173/');
// First visit only: wait for the worker to install, then go offline without reloading online first.
await p.evaluate(() => navigator.serviceWorker.ready);
await p.waitForTimeout(500);
await ctx.setOffline(true);
await p.reload();
await p.waitForSelector('.app, .modal', { timeout: 8000 });
console.log('first offline launch ok:', await p.title());
await b.close();
