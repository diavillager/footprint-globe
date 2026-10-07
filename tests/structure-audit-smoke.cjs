'use strict';
// Synthetic fixtures only. Never accepts a user file path.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { mkdir, readFile } = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const { build, preview } = await import('vite');
  const configFile = path.resolve('vite.audit.config.mts');
  await build({ configFile, logLevel: 'error' });
  const server = await preview({ configFile, preview: { port: 0 } });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const origin = new URL(server.resolvedUrls.local[0]).origin;
    const context = await browser.newContext({ viewport: { width: 1200, height: 1100 } });
    let external = 0, errors = 0;
    const consoleText = [];
    await context.route('**/*', route => {
      const req = route.request();
      if (new URL(req.url()).origin !== origin) { external++; return route.abort(); }
      assert.equal(req.method(), 'GET'); assert.equal(req.postData(), null);
      assert.ok(new URL(req.url()).pathname==='/' || new URL(req.url()).pathname.startsWith('/assets/'));
      return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', () => errors++);
    page.on('console', message => consoleText.push(message.text()));
    await page.goto(origin);
    const upload = value => page.locator('#source').setInputFiles({ name: 'PRIVATE_FILENAME_CANARY.json', mimeType: 'application/json', buffer: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)) });
    const complete = () => page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('전체 항목 탐색 완료'));
    const raw = { rawSignals: [{ position: { LatLng: '38.123°, 128.456°', timestamp: '2049-02-03T12:34:56Z' } }, { wifiScan: { SECRET_DEVICE: 'PRIVATE_VALUE_CANARY' } }], PRIVATE_KEY_CANARY: [{ position: { LatLng: '0°, 0°', timestamp: '2040-01-01T00:00:00Z' } }] };
    await upload(raw); await complete();
    let report = await page.locator('#report').inputValue();
    assert.match(report, /선택한 신호·경로점 2개 = 채택 1개 \+ 위치 외 신호 1개/);
    assert.match(report, /그중 앱 입력 경로 밖 1개/);
    assert.match(report, /필드1/);
    assert.doesNotMatch(report, /PRIVATE_|SECRET_DEVICE|38\.123|128\.456|2049-02-03/);
    assert.equal(await page.locator('#source').inputValue(), '');
    const downloadEvent = page.waitForEvent('download');
    await page.locator('#save').click();
    const download = await downloadEvent;
    assert.equal(download.suggestedFilename(), 'timeline-structure-report.txt');
    assert.equal(await readFile(await download.path(), 'utf8'), report);
    await mkdir('node_modules/.cache/audit-qa', { recursive: true });
    await page.screenshot({ path: 'node_modules/.cache/audit-qa/desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: 'node_modules/.cache/audit-qa/mobile.png', fullPage: true });

    await upload('{"PRIVATE_PARSE_CANARY":');
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('INVALID_JSON'));
    assert.doesNotMatch(await page.locator('#report').inputValue(), /PRIVATE_PARSE_CANARY/);
    assert.match(await page.locator('#report').inputValue(), /건수 미확정/);
    await page.evaluate(() => {
      const input = document.querySelector('#source'), transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(64 * 1024 * 1024 + 1)], 'PRIVATE_LARGE_CANARY.json'));
      input.files = transfer.files; input.dispatchEvent(new Event('change'));
    });
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('INPUT_LIMIT'));

    // Cancel synchronously after selection while the worker is still parsing/scanning.
    await page.evaluate(() => {
      const input = document.querySelector('#source'), transfer = new DataTransfer();
      transfer.items.add(new File(['{"unknown":[' + 'null,'.repeat(2_000_000) + 'null]}'], 'PRIVATE_CANCEL_CANARY.json'));
      input.files = transfer.files; input.dispatchEvent(new Event('change'));
      document.querySelector('#cancel').click();
    });
    assert.match(await page.locator('#report').inputValue(), /취소 — 미완료/);
    await upload(raw); await complete();
    report = await page.locator('#report').inputValue();
    assert.match(report, /선택한 신호·경로점 2개/);

    const gpxUpload = value => page.locator('#source').setInputFiles({ name: 'PRIVATE_GPX_CANARY.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.isBuffer(value) ? value : Buffer.from(value) });
    const gpx = `<?xml version="1.0" encoding="UTF-8"?><gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="PRIVATE_CREATOR"><trk><name>PRIVATE_TRACK</name><trkseg><trkpt lat="38.123" lon="128.456"><time>2049-02-03T12:34:56Z</time><hdop>0.8</hdop><extensions xmlns:p="https://PRIVATE_URI.invalid"><p:PRIVATE_ACCURACY>5</p:PRIVATE_ACCURACY></extensions></trkpt><trkpt lat="0" lon="0"><time>2049-02-03T12:34:57Z</time></trkpt></trkseg></trk></gpx>`;
    await gpxUpload(gpx); await complete();
    report = await page.locator('#report').inputValue();
    assert.match(report, /GPX 구조·비교 준비 진단/);
    assert.match(report, /트랙 포인트: 2개 · 좌표·시각 모두 유효 2개/);
    assert.match(report, /1초 이하: 1쌍/);
    assert.doesNotMatch(report, /PRIVATE_|38\.123|128\.456|2049-02-03|https?:/);
    const gpxDownloadEvent = page.waitForEvent('download');
    await page.locator('#save').click();
    const gpxDownload = await gpxDownloadEvent;
    assert.equal(gpxDownload.suggestedFilename(), 'gpx-structure-report.txt');
    assert.equal(await readFile(await gpxDownload.path(), 'utf8'), report);
    await page.screenshot({ path: 'node_modules/.cache/audit-qa/gpx-mobile.png', fullPage: true });
    await page.setViewportSize({ width: 1200, height: 1100 });
    await page.screenshot({ path: 'node_modules/.cache/audit-qa/gpx-desktop.png', fullPage: true });
    for (const [value,code] of [
      ['<gpx><PRIVATE_UNCLOSED>', 'INVALID_XML'],
      ['<!DOCTYPE gpx SYSTEM "https://PRIVATE_URL.invalid">'+gpx.replace(/^<\?xml[^>]+>/,''), 'DTD_FORBIDDEN'],
      [Buffer.from([0xff,0xfe,0x3c,0x00]), 'UNSUPPORTED_ENCODING'],
    ]) {
      await gpxUpload(value);
      await page.waitForFunction(code=>document.querySelector('#status').textContent.includes(code),code);
      assert.doesNotMatch(await page.locator('#report').inputValue(), /PRIVATE_|https?:/);
    }
    await page.evaluate(() => {
      const input=document.querySelector('#source'), transfer=new DataTransfer();
      transfer.items.add(new File(['<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1"><trk><trkseg>'+ '<trkpt lat="0" lon="0"/>'.repeat(200000)+'</trkseg></trk></gpx>'],'PRIVATE_CANCEL.gpx'));
      input.files=transfer.files;input.dispatchEvent(new Event('change'));document.querySelector('#cancel').click();
    });
    assert.match(await page.locator('#report').inputValue(), /GPX 구조·비교 준비 진단/);
    assert.match(await page.locator('#report').inputValue(), /취소 — 미완료/);
    await upload(raw); await complete();
    assert.match(await page.locator('#report').inputValue(), /선택한 신호·경로점 2개/);
    await page.locator('#clear').click();
    assert.equal(await page.locator('#report').inputValue(), '');
    assert.equal(await page.locator('#save').isDisabled(), true);
    assert.deepEqual(await page.evaluate(async () => [localStorage.length, sessionStorage.length, (await indexedDB.databases()).length]), [0, 0, 0]);
    assert.equal(external, 0); assert.equal(errors, 0);
    assert.doesNotMatch(consoleText.join('\n'), /PRIVATE_|SECRET_DEVICE|38\.123|2049-02-03|Content Security Policy/i);
    await context.close();
    console.log('PASS: JSON/GPX selection, counts, private-field masking, downloads, cancellation, replacement, malformed input/DTD/encoding, responsive layout; no external requests/storage');
  } finally { await browser.close(); await new Promise(resolve => server.httpServer.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
