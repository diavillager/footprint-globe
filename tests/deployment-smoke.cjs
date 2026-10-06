'use strict';
// Opt-in live Production verification. Generates synthetic input in memory only.
// Consumes MapTiler requests; never prints request URLs, keys, bodies or errors.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const origin = 'https://footprint-globe.vercel.app';
let stage = 'startup';
const marker = 'SYNTHETIC_DEPLOY_CANARY';
const rawSignals = Array.from({ length: 24 }, (_, i) => ({ position: {
  LatLng: `${(37.56 + i * .001).toFixed(6)}°, ${(126.97 + i * .001).toFixed(6)}°`,
  timestamp: new Date(Date.UTC(2040, 0, 1) + i * 1000).toISOString(),
}, ignoredMetadata: marker }));
const file = { name: marker + '.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ rawSignals })) };
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-swiftshader'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    let unexpected = 0, uploads = 0, leaked = 0, errors = 0, resourceFailures = 0;
    const workers = new Set();
    context.on('request', request => {
      const url = new URL(request.url());
      if (!['http:', 'https:'].includes(url.protocol)) return;
      if (![origin, 'https://api.maptiler.com'].includes(url.origin)) unexpected++;
      if (!['GET', 'HEAD'].includes(request.method()) || request.postData()) uploads++;
      const transmitted = decodeURIComponent(request.url()) + JSON.stringify(request.headers()) + (request.postData() || '');
      if ([marker, '2040-01-01', 'rawSignals', '37.561', '126.971'].some(value => transmitted.includes(value))) leaked++;
    });
    context.on('response', response => { if (response.status() >= 400) resourceFailures++; });
    context.on('requestfailed', () => resourceFailures++);
    const page = await context.newPage();
    page.on('pageerror', () => errors++);
    page.on('console', msg => { if (msg.text().includes(marker)) leaked++; });
    page.on('worker', worker => workers.add(new URL(worker.url()).pathname));
    stage = 'production-load';
    const response = await page.goto(origin);
    assert.equal(response.status(), 200);
    const headers = response.headers();
    assert.equal(headers['x-frame-options'], 'DENY');
    assert.equal(headers['x-content-type-options'], 'nosniff');
    assert.match(headers['content-security-policy'], /frame-ancestors 'none'/);
    await page.getByText('상세 지도 준비 완료', { exact: false }).waitFor({ state: 'attached', timeout: 45000 });
    stage = 'synthetic-import';
    await page.getByLabel('JSON 올리기', { exact: true }).setInputFiles(file);
    stage = 'import-result';
    try { await page.locator('.import-status').filter({ hasText: '관측 24개' }).waitFor({ timeout: 15000 }); }
    catch {
      const status = await page.locator('.import-status').textContent();
      const code = ['INVALID_JSON', 'UNSUPPORTED_FORMAT', 'INPUT_LIMIT', 'NO_VALID_POSITIONS', 'FILE_READ_FAILED'].find(value => status.includes(value)) || 'UNEXPECTED_STATUS';
      console.log('Import diagnostic: ' + code + '; workers=' + workers.size + '; resourceFailures=' + resourceFailures);
      throw new Error('Import not confirmed');
    }
    for (const name of ['포인트 목록', '시간별 분포', '거리별 분포']) {
      stage = 'panel-' + name;
      await page.getByRole('button', { name, exact: true }).click();
      await page.getByRole('dialog', { name, exact: true }).waitFor();
      await page.keyboard.press('Escape');
    }
    stage = 'observation-selection';
    await page.getByRole('button', { name: '포인트 목록', exact: true }).click();
    await page.getByRole('button', { name: '다음 관측 목록', exact: true }).click();
    await page.getByRole('button', { name: /^관측 21 ·/ }).click();
    await page.getByRole('dialog', { name: '관측포인트 상세 정보' }).waitFor();
    stage = 'timezone-kst';
    await page.getByRole('button', { name: 'KST', exact: true }).click();
    assert.match(await page.getByRole('dialog').textContent(), /09:00:20/);
    stage = 'timezone-utc';
    await page.getByRole('button', { name: 'UTC', exact: true }).click();
    assert.match(await page.getByRole('dialog').textContent(), /00:00:20/);
    stage = 'mobile-clear-reload';
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight), false);
    await page.getByRole('button', { name: '지우기', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '포인트 목록', exact: true }).isDisabled(), true);
    await page.getByLabel('JSON 올리기', { exact: true }).setInputFiles(file);
    await page.locator('.import-status').filter({ hasText: '관측 24개' }).waitFor();
    await page.reload();
    await page.getByText('상세 지도 준비 완료', { exact: false }).waitFor({ state: 'attached' });
    assert.equal(await page.getByRole('button', { name: '포인트 목록', exact: true }).isDisabled(), true);
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
    assert.ok([...workers].some(path => path.includes('preview.worker')));
    assert.ok([...workers].some(path => path.includes('maplibre-gl-worker')));
    assert.deepEqual({ unexpected, uploads, leaked, errors, resourceFailures }, { unexpected: 0, uploads: 0, leaked: 0, errors: 0, resourceFailures: 0 });
    console.log('PASS: Production synthetic flow, two workers, headers, viewport, no persistence; unexpected requests/uploads/canary leaks/page errors/resource failures = 0');
    await context.close();
    // Simulate provider failures in isolated contexts; never modify remote settings.
    for (const failure of [403, 429, 'network']) {
      stage = 'map-failure-' + failure;
      const failedContext = await browser.newContext();
      let block = true;
      await failedContext.route('https://api.maptiler.com/**', route => {
        if (new URL(route.request().url()).pathname.endsWith('logo.svg')) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"/>' });
        if (block) return failure === 'network' ? route.abort() : route.fulfill({ status: failure, body: '' });
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#eef3f6' } }] }) });
      });
      const failedPage = await failedContext.newPage();
      await failedPage.goto(origin);
      await failedPage.getByText('[MAP_UNAVAILABLE]', { exact: false }).waitFor();
      await failedPage.getByLabel('JSON 올리기', { exact: true }).setInputFiles(file);
      await failedPage.locator('.import-status').filter({ hasText: '관측 24개' }).waitFor();
      await failedPage.getByRole('button', { name: '포인트 목록', exact: true }).click();
      await failedPage.getByRole('dialog', { name: '포인트 목록', exact: true }).waitFor();
      await failedPage.keyboard.press('Escape');
      block = false;
      await failedPage.getByRole('button', { name: '지도 다시 시도', exact: true }).click();
      await failedPage.getByText('상세 지도 준비 완료', { exact: false }).waitFor({ state: 'attached' });
      assert.equal(await failedPage.getByText('[MAP_UNAVAILABLE]', { exact: false }).count(), 0);
      console.log('PASS: simulated map failure ' + failure + ', list retained, retry with synthetic map response');
      await failedContext.close();
    }
  } finally { await browser.close(); }
})().catch(() => { console.error('Deployment smoke failed at ' + stage + ' (details withheld)'); process.exitCode = 1; });
