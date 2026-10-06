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
      assert.equal(await page.getByRole('spinbutton', { name: '점선 시간차 기준' }).isDisabled(), true);
      await page.getByRole('radio', { name: '긴 공백은 점선' }).check();
      for (const threshold of ['30', '120']) {
        await page.getByRole('spinbutton', { name: '점선 시간차 기준' }).fill(threshold);
        await page.getByText('현재 표시: 실선 1개 · 점선 2개.', { exact: false }).waitFor();
      }
      assert.match(await page.getByRole('status').textContent(), /연결 3개/);
      assert.equal(await page.getByRole('alert').count(), 0);
      // Capture authored demo only, never a selected personal file.
      if (server === production) await page.screenshot({ path: path.join(os.tmpdir(), 'footprint-preview-synthetic.png'), fullPage: true });
      // Inspect circular markers at close range as well as the initial globe scale.
      for (let zoom = 0; zoom < 5; zoom++) {
        await page.getByRole('button', { name: '확대', exact: true }).click();
        await page.waitForTimeout(350);
      }
      if (server === production) await page.locator('canvas').screenshot({ path: path.join(os.tmpdir(), 'footprint-preview-zoom-synthetic.png') });
      const canvasBox = await page.locator('canvas').boundingBox();
      await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(canvasBox.x + canvasBox.width / 2 + 60, canvasBox.y + canvasBox.height / 2 + 30, { steps: 12 });
      await page.mouse.up();
      await page.waitForTimeout(500);
      if (server === production) await page.locator('canvas').screenshot({ path: path.join(os.tmpdir(), 'footprint-preview-orbit-synthetic.png') });
      // Reset to the authored first point, then exercise wheel zoom beyond the button limit.
      await page.getByRole('button', { name: '처음 위치로', exact: true }).click();
      await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
      for (let zoom = 0; zoom < 18; zoom++) {
        await page.mouse.wheel(0, -1000);
        await page.waitForTimeout(100);
      }
      await page.waitForTimeout(500);
      if (server === production) await page.locator('canvas').screenshot({ path: path.join(os.tmpdir(), 'footprint-preview-wheel-synthetic.png') });
      const zoomImage = await page.locator('canvas').screenshot();
      const visible = await page.evaluate(async bytes => {
        const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width; canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0); bitmap.close();
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let dots = 0, lines = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i] > 220 && pixels[i + 1] > 230 && pixels[i + 2] > 220) dots++;
          if (pixels[i] > 180 && pixels[i + 1] > 90 && pixels[i + 2] < 180) lines++;
        }
        return { dots, lines };
      }, Array.from(zoomImage));
      assert.ok(visible.dots > 0 && visible.lines > 10, 'Synthetic points and lines remain visible at maximum wheel zoom');
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
