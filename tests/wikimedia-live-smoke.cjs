'use strict';
// Explicit live Wikimedia check with one synthetic observation at a public landmark.
// Map tiles are mocked; user files and Geoapify are never accessed.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
if (!process.argv.includes('--live')) { console.log('Use --live to verify Wikimedia and a real Commons photo in Edge.'); process.exit(0); }
(async () => {
 const { createServer } = await import('vite');
 const server = await createServer({ define: { __MAPTILER_KEY__: JSON.stringify('synthetic-map-key'), __GEOAPIFY_KEY__: JSON.stringify('') }, server: { port: 0 } });
 await server.listen();
 const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-swiftshader'] });
 try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const origin = server.resolvedUrls.local[0];
  let metadata = 0, photos = 0, unexpected = 0, errors = 0;
  await context.route('**/*', route => {
   const url = new URL(route.request().url());
   if (url.origin === new URL(origin).origin) return route.continue();
   if (url.hostname === 'api.maptiler.com') return route.fulfill(url.pathname.endsWith('logo.svg') ? { contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" />' } : { json: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#edf3ef' } }] } });
   if (['ja.wikipedia.org', 'en.wikipedia.org', 'www.wikidata.org', 'commons.wikimedia.org'].includes(url.hostname)) { metadata++; return route.continue(); }
   if (['upload.wikimedia.org', 'thumb.wikimedia.org'].includes(url.hostname)) { photos++; return route.continue(); }
   unexpected++; return route.abort();
  });
  const page = await context.newPage(); page.setDefaultTimeout(60000);
  page.on('pageerror', () => errors++);
  await page.goto(origin);
  await page.getByText('상세 지도 준비 완료', { exact: false }).waitFor({ state: 'attached' });
  const timeline = { rawSignals: [{ position: { LatLng: '32.80603°, 130.7059°', timestamp: '2040-01-01T00:00:00Z' } }] };
  await page.getByLabel('JSON 올리기', { exact: true }).setInputFiles({ name: 'synthetic-public-landmark.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(timeline)) });
  await page.getByRole('dialog', { name: '장소 매핑 안내', exact: true }).waitFor();
  assert.equal(metadata, 0); assert.equal(photos, 0);
  await page.getByRole('button', { name: '허용하고 장소 매핑', exact: true }).click();
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(button => button.textContent === '장소별 보기').disabled);
  assert.equal(await page.getByRole('button', { name: '원본 경로', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: '장소별 보기', exact: true }).click();
  const img = page.locator('.diary-balloon:visible img').first();
  await img.waitFor(); await page.waitForFunction(() => [...document.querySelectorAll('.diary-balloon img')].some(img => img.complete && img.naturalWidth > 1));
  await page.locator('.diary-balloon:visible button').first().click();
  const detail = page.getByRole('region', { name: '선택한 장소 상세' }); await detail.waitFor();
  const name = await detail.getByRole('heading').first().textContent();
  const realPhoto = detail.locator('img'); await realPhoto.waitFor();
  assert.ok(await realPhoto.evaluate(img => img.complete && img.naturalWidth > 1));
  await page.getByRole('link', { name: '장소 원문 확인', exact: true }).waitFor();
  assert.match(await detail.textContent(), /CC|Public domain/);
  await page.screenshot({ path: 'node_modules/.cache/wikimedia-real-photo.png' });
  assert.equal(unexpected, 0); assert.equal(errors, 0);
  console.log(JSON.stringify({ result: 'PASS', name, metadataRequests: metadata, photoRequests: photos, realPhotoRendered: true, geoapifyRequests: 0 }));
 } finally { await browser.close(); await server.close(); }
})().catch(error => { console.error('Wikimedia live browser check failed: ' + error.message.replace(/https?:\/\/\S+/g, '[URL]')); process.exitCode = 1; });
