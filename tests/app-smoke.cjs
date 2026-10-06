'use strict';
// Exercises only authored app code. Never selects or reads user files.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

(async () => {
  const { createServer, preview } = await import('vite');
  const browser = await chromium.launch({ channel: process.env.TIMELINE_TEST_BROWSER || 'msedge', headless: true });
  let dev, production;
  try {
    dev = await createServer({ server: { port: 0 } });
    await dev.listen();
    production = await preview({ preview: { port: 0 } });
    for (const server of [dev, production]) {
      const origin = server.resolvedUrls.local[0];
      const context = await browser.newContext();
      let external = 0, errors = 0;
      await context.route('**/*', route => {
        if (route.request().url().startsWith(origin)) return route.continue();
        external++; return route.abort();
      });
      const page = await context.newPage();
      page.on('pageerror', () => errors++);
      await page.goto(origin);
      await page.getByRole('heading', { name: '개발 준비 화면' }).waitFor();
      assert.match(await page.locator('main').textContent(), /3개/);
      assert.equal(await page.locator('input[type=file]').count(), 0);
      if (server === dev) {
        // Known non-private configuration exercises JSON denial without inspecting personal files.
        const denied = await context.request.get(new URL('package.json', origin).href);
        assert.equal(denied.status(), 403);
      }
      assert.equal(external, 0);
      assert.equal(errors, 0);
      await context.close();
    }
    process.stdout.write('App smoke passed: development and production shell, JSON access denied, 0 external requests, 0 page errors.\n');
  } finally {
    await browser.close();
    if (dev) await dev.close();
    if (production) await new Promise(resolve => production.httpServer.close(resolve));
  }
})().catch(() => { process.stderr.write('App smoke failed; only synthetic app code was used.\n'); process.exitCode = 1; });
