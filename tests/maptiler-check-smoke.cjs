'use strict';
// Opt-in live test: only public presets and synthetic points; no Timeline input.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { createMapCheckServer } = require('../tools/maptiler-check/server.cjs');
const os = require('node:os');
const path = require('node:path');
let stage = 'startup';
(async () => {
  const server = createMapCheckServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  const counts = { external: 0, blocked: 0, httpFailures: 0, expectedHttpFailures: 0, pageErrors: 0, consoleKeyLeaks: 0 };
  const blockedCategories = new Set();
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-swiftshader'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    let key;
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === origin) return route.continue();
      counts.external++;
      if (request.method() === 'GET' && (url.origin === 'https://cdn.maptiler.com' || (url.origin === 'https://api.maptiler.com' && /^\/(maps|tiles|fonts|resources|sprites)\//.test(url.pathname)))) return route.continue();
      counts.blocked++;
      const category = url.pathname.split('/')[1];
      blockedCategories.add(url.hostname + '/' + (/^[a-z-]{1,25}$/.test(category) ? category : '[redacted]'));
      return route.abort();
    });
    const page = await context.newPage();
    page.on('response', async response => {
      if (response.url() === origin + '/config' && response.ok()) key = (await response.json()).key;
      if (response.status() >= 400) {
        if (stage === 'missing-key' && response.url() === origin + '/config') counts.expectedHttpFailures++;
        else counts.httpFailures++;
      }
    });
    page.on('pageerror', () => counts.pageErrors++);
    page.on('console', message => { if (key && message.text().includes(key)) counts.consoleKeyLeaks++; });
    stage = 'local-isolation';
    assert.equal((await fetch(origin + '/.env.local')).status, 404);
    assert.equal((await fetch(origin + '/config')).status, 403);
    assert.equal((await fetch(origin + '/config', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    await page.goto(origin);
    assert.equal(counts.external, 0);
    assert.equal(await page.locator('input[type=file]').count(), 0);
    stage = 'map-start';
    await page.getByRole('button', { name: '지도 검증 시작' }).click();
    await page.waitForFunction(() => document.getElementById('status').textContent === '지도 준비 완료', undefined, { timeout: 60000 });
    assert.ok(key);
    const results = [];
    for (const region of ['seoul', 'tokyo', 'newyork', 'paris', 'london', 'dateline']) {
      stage = region;
      await page.locator('#region').selectOption(region);
      await page.waitForFunction(() => document.getElementById('status').textContent === '지도 준비 완료', undefined, { timeout: 60000 });
      await page.locator('#boundaries').check();
      await page.getByRole('button', { name: '경계 집계 갱신' }).click();
      const result = JSON.parse(await page.locator('#report').textContent());
      assert.equal(result.region, region);
      if (region !== 'dateline') {
        assert.ok(result.boundaryFragments > 0);
        assert.ok(result.sourceLayers.includes('sub_border'));
      }
      results.push(result);
      if (region === 'seoul' || region === 'tokyo') await page.screenshot({ path: path.join(os.tmpdir(), `maptiler-check-${region}.png`), fullPage: true });
    }
    stage = 'close-points';
    await page.locator('#region').selectOption('seoul');
    await page.locator('#zoom').selectOption('19');
    await page.waitForFunction(() => document.getElementById('status').textContent === '지도 준비 완료', undefined, { timeout: 60000 });
    const canvas = await page.locator('canvas').boundingBox();
    await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2 - 4);
    const picked = await page.locator('#selection').textContent();
    assert.ok(picked.includes('SYN-B') && picked.includes('SYN-C'));
    for (const id of ['SYN-B', 'SYN-C']) {
      await page.getByRole('button', { name: id, exact: true }).click();
      assert.equal(await page.locator('#selection').textContent(), `선택: ${id}`);
    }
    await page.screenshot({ path: path.join(os.tmpdir(), 'maptiler-check-close.png'), fullPage: true });
    stage = 'globe';
    await page.locator('#zoom').selectOption('2');
    await page.waitForFunction(() => document.getElementById('status').textContent === '지도 준비 완료', undefined, { timeout: 60000 });
    await page.screenshot({ path: path.join(os.tmpdir(), 'maptiler-check-globe.png'), fullPage: true });
    stage = 'cleanup';
    await page.getByRole('button', { name: '지도 종료', exact: true }).click();
    assert.equal(await page.locator('canvas').count(), 0);
    assert.notEqual(await page.locator('#controls').getAttribute('disabled'), null);
    assert.equal(counts.blocked, 0);
    assert.equal(counts.pageErrors, 0);
    assert.equal(counts.httpFailures, 0);
    assert.equal(counts.consoleKeyLeaks, 0);
    stage = 'missing-key';
    const externalBefore = counts.external;
    await page.route('**/config', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"code":"KEY_MISSING"}' }));
    await page.getByRole('button', { name: '지도 검증 시작' }).click();
    await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('MAP_START_FAILED'));
    assert.equal(counts.external, externalBefore);
    assert.equal(await page.locator('canvas').count(), 0);
    console.log(JSON.stringify({ result: 'PASS', counts, regions: results }));
  } finally {
    console.log(JSON.stringify({ stage, counts, blockedCategories: [...blockedCategories] }));
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(() => { console.error(`MAP_CHECK_FAILED:${stage}`); process.exitCode = 1; });
