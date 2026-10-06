'use strict';
// Exercises only authored app code. Never selects or reads user files.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const path = require('node:path');
const os = require('node:os');
let stage = 'startup';

(async () => {
  const { createServer, preview } = await import('vite');
  const browser = await chromium.launch({ channel: process.env.TIMELINE_TEST_BROWSER || 'msedge', headless: true, args: ['--enable-unsafe-swiftshader'] });
  let dev, production;
  try {
    dev = await createServer({ server: { port: 0 } });
    await dev.listen();
    production = await preview({ preview: { port: 0 } });
    for (const server of [dev, production]) {
      const origin = server.resolvedUrls.local[0];
      const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
      let external = 0, errors = 0;
      await context.route('**/*', route => {
        if (route.request().url().startsWith(origin)) return route.continue();
        external++; return route.abort();
      });
      const page = await context.newPage();
      page.on('pageerror', () => errors++);
      let leaked = false;
      page.on('console', message => { if (/CANARY/.test(message.text())) leaked = true; });
      stage = server === dev ? 'development' : 'production';
      await page.goto(origin);
      await page.getByRole('heading', { name: '내 기록으로 연결 방식을 비교하세요' }).waitFor();
      await page.getByRole('button', { name: '합성 예제로 체험' }).click();
      await page.locator('canvas').waitFor();
      assert.match(await page.getByRole('status').textContent(), /연결 3개/);
      await page.getByRole('radio', { name: '긴 공백은 점선' }).check();
      await page.getByRole('spinbutton', { name: '점선 시간차 기준' }).fill('10');
      assert.match(await page.getByRole('status').textContent(), /연결 3개/);
      assert.equal(await page.getByRole('alert').count(), 0);
      // Capture authored demo only, never a selected personal file.
      if (server === production) await page.screenshot({ path: path.join(os.tmpdir(), 'footprint-preview-synthetic.png'), fullPage: true });
      stage += '-worker';
      const large = { rawSignals: Array.from({ length: 10123 }, (_, i) => ({ position: {
        LatLng: `35.00°, ${125 + (i % 10) / 100}°`, timestamp: new Date(Date.UTC(2040, 0, 1) + i * 60000).toISOString(), SECRET: 'CANARY',
      } })), SECRET_PROFILE: 'CANARY' };
      await page.getByLabel('원본 JSON 선택', { exact: true }).setInputFiles({ name: 'CANARY.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(large)) });
      await page.waitForFunction(() => document.querySelector('[role=status]').textContent.includes('10,123'), { timeout: 30000 });
      assert.match(await page.getByRole('status').textContent(), /연결 10,122개/);
      assert.doesNotMatch(await page.locator('main').textContent(), /CANARY|SECRET_PROFILE/);
      assert.equal(await page.locator('input[type=file]').inputValue(), '');
      assert.equal(await page.getByRole('alert').count(), 0);
      assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
      stage += '-recovery';
      await page.locator('input[type=file]').setInputFiles({ name: 'CANARY.json', mimeType: 'application/json', buffer: Buffer.from('{"CANARY') });
      await page.waitForFunction(() => document.querySelector('[role=status]').textContent.includes('INVALID_JSON'));
      assert.equal(await page.locator('canvas').count(), 0);
      assert.doesNotMatch(await page.locator('main').textContent(), /CANARY/);
      await page.getByRole('button', { name: '합성 예제로 체험' }).click();
      await page.locator('canvas').waitFor();
      await page.getByRole('button', { name: '기록 지우기' }).click();
      assert.equal(await page.locator('canvas').count(), 0);
      if (server === dev) {
        // Known non-private configuration exercises JSON denial without inspecting personal files.
        const denied = await context.request.get(new URL('package.json', origin).href);
        assert.equal(denied.status(), 403);
      }
      assert.equal(external, 0);
      assert.equal(errors, 0);
      assert.equal(leaked, false);
      await context.close();
    }
    process.stdout.write('App smoke passed: development/production globe, display comparison, 10,123 synthetic positions via worker, invalid-file recovery, clear, no metadata leakage/storage, JSON access denied, 0 external requests, 0 page errors.\n');
  } finally {
    await browser.close();
    if (dev) await dev.close();
    if (production) await new Promise(resolve => production.httpServer.close(resolve));
  }
})().catch(error => { process.stderr.write(`App smoke failed at ${stage}: ${error.message}. Only synthetic inputs were used.\n`); process.exitCode = 1; });
