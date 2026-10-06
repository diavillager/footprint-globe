'use strict';
// Only authored synthetic fixtures enter this fresh browser. Never reads user files.
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const fixtures = require('./synthetic-fixtures.cjs');

(async () => {
  const browser = await chromium.launch({ channel: process.env.TIMELINE_TEST_BROWSER || 'msedge', headless: true,
    args: ['--disable-background-networking', '--disable-component-update', '--no-first-run'] });
  try {
    const context = await browser.newContext({ acceptDownloads: true });
    let externalRequests = 0, pageErrors = 0;
    await context.route('**/*', route => {
      if (route.request().url().startsWith('file:')) return route.continue();
      externalRequests++;
      return route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', () => pageErrors++);
    await page.goto(pathToFileURL(path.resolve(__dirname, '../tools/timeline-sample/index.html')).href);
    assert.equal(await page.title(), 'Timeline 로컬 샘플 생성기');
    assert.equal(await page.locator('#save').isDisabled(), true);
    const visit = JSON.stringify(fixtures.modern().semanticSegments[0]);
    const large = '{"semanticSegments":[' + Array(65000).fill(visit).concat(fixtures.modern().semanticSegments.slice(1, 3).map(r => JSON.stringify(r))).join(',') + ']}';
    const extraMetadata = JSON.stringify({ ...fixtures.modern(), SECRET_ROOT_KEY: { deviceId: 'SECRET_DEVICE' }, rawSignals: [{ point: 'geo:33.125,44.625' }] });
    for (const input of [...Object.values(fixtures).map(fixture => JSON.stringify(fixture())), large, extraMetadata]) {
      await page.locator('#source').setInputFiles({ name: 'synthetic-only.json', mimeType: 'application/json', buffer: Buffer.from(input) });
      await page.waitForFunction(() => !document.getElementById('save').disabled);
      assert.equal(await page.locator('#source').inputValue(), '');
      assert.doesNotMatch(await page.locator('#status').textContent(), /FICTIONAL_|CANARY|2022-|SECRET|rawSignals|33\.125/);
      if (input === extraMetadata) assert.match(await page.locator('#status').textContent(), /제외한 최상위 필드: 2/);
      const pending = page.waitForEvent('download');
      await page.locator('#save').click();
      const download = await pending;
      assert.equal(download.suggestedFilename(), 'timeline.synthetic.sample.json');
      const chunks = [];
      for await (const chunk of await download.createReadStream()) chunks.push(chunk);
      const output = Buffer.concat(chunks).toString('utf8');
      JSON.parse(output);
      assert.doesNotMatch(output, /FICTIONAL_|CANARY|2022-|SECRET|rawSignals|33\.125/);
      assert.ok(Buffer.byteLength(output) <= 65536);
      await download.delete();
    }
    await page.locator('#source').setInputFiles({ name: 'synthetic-wrapped.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ SECRET_WRAPPER: fixtures.modern() })) });
    await page.waitForFunction(() => document.getElementById('status').textContent.includes('구조 진단 v1'));
    assert.equal(await page.locator('#save').isDisabled(), true);
    const diagnosis = await page.locator('#status').textContent();
    assert.match(diagnosis, /NESTED_RECORD_FIELD/);
    assert.doesNotMatch(diagnosis, /SECRET|FICTIONAL|2022-|11\.250000/);
    await page.locator('#source').setInputFiles({ name: 'synthetic-bad.json', mimeType: 'application/json', buffer: Buffer.from('{"SECRET_SYNTHETIC":') });
    await page.waitForFunction(() => document.getElementById('status').textContent.includes('생성 중단'));
    assert.equal(await page.locator('#save').isDisabled(), true);
    assert.doesNotMatch(await page.locator('#status').textContent(), /SECRET/);
    assert.equal(externalRequests, 0);
    assert.equal(pageErrors, 0);
    process.stdout.write('Browser smoke passed: 3 synthetic formats, large export, safe root exclusions, 5 downloads, private structure diagnostics, invalid-input recovery, 0 external requests, 0 page errors.\n');
    await context.close();
  } finally { await browser.close(); }
})().catch(() => { process.stderr.write('Browser smoke failed. Only synthetic inputs were used.\n'); process.exitCode = 1; });
