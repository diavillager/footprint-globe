 'use strict';
// Synthetic files and mocked providers only; no live API traffic.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
let stage = 'startup';
(async () => {
 const { createServer, preview, build } = await import('vite');
 const define = { __MAPTILER_KEY__: JSON.stringify('synthetic-map-key'), __GEOAPIFY_KEY__: JSON.stringify('synthetic-places-key') };
 const outDir = 'node_modules/.cache/landmark-smoke-dist';
 await build({ define, build: { outDir }, logLevel: 'error' });
 const dev = await createServer({ define, server: { port: 0 } }); await dev.listen();
 const production = await preview({ build: { outDir }, preview: { port: 0 } });
 const { buildTrip, trips } = await dev.ssrLoadModule('/src/fixtures/travel.ts');
 const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-swiftshader'] });
 try {
  for (const server of [dev, production]) {
   stage = server === dev ? 'development' : 'production';
   const origin = server.resolvedUrls.local[0];
   const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
   let requests = 0, images = 0, unexpected = 0, errors = 0, mode = 'success', held, collisionSearches = 0;
   await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin === new URL(origin).origin) return route.continue();
    if (url.hostname === 'api.maptiler.com') return route.fulfill(url.pathname.endsWith('logo.svg') ? { contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" />' } : { json: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#edf3ef' } }] } });
    if (url.hostname === 'www.wikidata.org') {
     assert.equal(req.headers().referer, undefined);
     assert.equal(url.searchParams.get('entity'), 'Q123');
     return route.fulfill({ json: { claims: { P18: [{ rank: 'normal', mainsnak: { datavalue: { value: mode === 'imagefail' ? 'Failure.png' : 'Synthetic.png' } } }] } } });
    }
    if (url.hostname === 'commons.wikimedia.org') {
     assert.equal(req.headers().referer, undefined);
     assert.equal(url.searchParams.get('titles'), mode === 'imagefail' ? 'File:Failure.png' : 'File:Synthetic.png');
     assert.equal(url.searchParams.has('apiKey'), false);
     return route.fulfill({ json: { query: { pages: { '1': { imageinfo: [{ thumburl: mode === 'imagefail' ? 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Failure.png/480px-Failure.png' : 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Synthetic.png/480px-Synthetic.png', extmetadata: { Artist: { value: 'Synthetic author' }, LicenseShortName: { value: 'CC0' } } }] } } } } });
    }
    if (['upload.wikimedia.org', 'thumb.wikimedia.org'].includes(url.hostname)) {
     images++; assert.equal(req.headers().referer, undefined);
     if (mode === 'imagefail') return route.abort();
     return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5n0AAAAASUVORK5CYII=', 'base64') });
    }
    if (url.origin !== 'https://api.geoapify.com') { unexpected++; return route.abort(); }
    requests++; assert.equal(req.method(), 'GET'); assert.equal(req.postData(), null);
    assert.equal(url.searchParams.get('apiKey'), 'synthetic-places-key');
    if (mode === 'hold') { held = () => route.fulfill({ json: { features: [] } }).catch(() => {}); return; }
    if (mode === 'auth' || mode === 'rate') return route.fulfill({ status: mode === 'auth' ? 403 : 429, body: 'PRIVATE_ERROR' });
    if (mode === 'offline') return route.abort();
    if (url.pathname === '/v2/place-details') {
     assert.deepEqual([...url.searchParams.keys()].sort(), ['apiKey', 'features', 'id', 'lang']);
     if (url.searchParams.get('id') === 'synthetic-no-photo') return route.fulfill({json:{features:[]}});
     return route.fulfill({ json: { features: [{ properties: { wiki_and_media: { wikidata: 'Q123' } } }] } });
    }
    assert.equal(url.pathname, '/v2/places');
    assert.deepEqual([...url.searchParams.keys()].sort(), ['apiKey', 'bias', 'categories', 'filter', 'lang', 'limit']);
    const coordinates = url.searchParams.get('filter').slice(7).split(',').slice(0, 2).map(Number);
    if (mode === 'collision' && collisionSearches++ === 0) return route.fulfill({json:{features:[{properties:{place_id:'synthetic-no-photo',name:'사진 없는 앞 지점',categories:['tourism.sights']},geometry:{type:'Point',coordinates}}]}});
    return route.fulfill({ json: { features: mode === 'empty' ? [] : [{ properties: { place_id: 'synthetic-far', name: '더 먼 명소', categories: ['tourism.sights'] }, geometry: { type: 'Point', coordinates: [coordinates[0], coordinates[1] + .001] } }, { properties: { place_id: 'synthetic-one', name: '가상 박물관', categories: ['entertainment.museum'] }, geometry: { type: 'Point', coordinates } }] } });
   });
   const page = await context.newPage(); page.setDefaultTimeout(20000);
   page.on('pageerror', () => errors++);
   page.on('console', message => { assert.doesNotMatch(message.text(), /CANARY|PRIVATE_ERROR/); });
   await page.goto(origin);
   await page.getByText('상세 지도 준비 완료', { exact: false }).waitFor({ state: 'attached' });
   const load = async timeline => {
    await page.getByLabel('JSON 올리기', { exact: true }).setInputFiles({ name: 'CANARY.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(timeline)) });
    await page.locator('.import-status').filter({ hasText: `관측 ${timeline.rawSignals.length.toLocaleString()}개` }).waitFor();
    assert.equal(await page.locator('.travel-diary').count(), 0);
    assert.equal(await page.locator('.diary-card').count(), 0);
    await page.getByRole('dialog', { name: '장소 매핑 안내', exact: true }).waitFor();
   };
   const consent = async () => {
    const mapped = page.getByRole('button', {name:'장소별 보기',exact:true});
    assert.equal(await mapped.isDisabled(), true);
    await page.getByRole('button', { name: '허용하고 장소 매핑', exact: true }).click();
    assert.equal(await page.getByRole('button', {name:'원본 경로',exact:true}).getAttribute('aria-pressed'), 'true');
    assert.equal(await mapped.isDisabled(), true);
    if (!['auth','rate','offline','hold'].includes(mode)) {
     await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(button => button.textContent === '장소별 보기').disabled);
     assert.equal(await page.getByRole('button', {name:'원본 경로',exact:true}).getAttribute('aria-pressed'), 'true');
     await mapped.click();
    }
   };
   for (const trip of trips) {
    const before = requests;
    await load({ rawSignals: buildTrip(trip.id).timeline.rawSignals.slice(0, 8) });
    assert.equal(await page.getByRole('button', { name: '근접 관측 묶기', exact: true }).count(), 0);
    await page.waitForTimeout(400); assert.equal(requests, before);
    await consent(); await page.locator('.diary-balloon:visible .diary-card strong').filter({ hasText: '가상 박물관' }).first().waitFor();
    await page.locator('.diary-balloon:visible .diary-card img').first().waitFor();
    assert.equal(await page.locator('.diary-balloon:visible .diary-card img').first().evaluate(img => getComputedStyle(img).objectFit), 'contain');
    await page.locator('.diary-balloon').first().waitFor({ state: 'attached' });
    await page.locator('.diary-balloon:visible button').first().click();
    await page.getByRole('heading', { name: '주변 랜드마크 후보', exact: true }).waitFor();
    assert.equal(await page.getByRole('dialog', {name:'기록 상세'}).evaluate(dialog => { const r = dialog.getBoundingClientRect(); return Math.abs(r.x + r.width / 2 - innerWidth / 2) < 2; }), true);
    await page.screenshot({path:`node_modules/.cache/diary-detail-${stage}.png`});
    await page.getByRole('button', { name: /더 먼 명소/ }).click();
    await page.getByRole('region', {name:'선택한 장소 상세'}).getByRole('heading', {name:'더 먼 명소',exact:true}).waitFor();
    assert.equal(await page.getByRole('dialog').getByText('조회 동의 철회·결과 지우기', {exact:true}).count(), 0);
    assert.doesNotMatch(await page.getByRole('dialog').textContent(), /tourism\.|entertainment\./);
    const listBox = await page.getByRole('complementary', {name:'주변 장소 목록'}).boundingBox();
    const detailBox = await page.getByRole('region', {name:'선택한 장소 상세'}).boundingBox();
    assert.ok(listBox.x + listBox.width <= detailBox.x);
    assert.equal(await page.locator('.diary-balloon strong').filter({ hasText: '더 먼 명소' }).count(), 0);
    assert.ok(await page.locator('.diary-balloon strong').filter({ hasText: '가상 박물관' }).count() > 0);
    await page.getByRole('button', { name: '창 닫기', exact: true }).click();
    await page.getByRole('button', {name:'원본 경로',exact:true}).click();
    assert.equal(await page.locator('.diary-card').count(), 0);
    await page.getByRole('button', {name:'장소별 보기',exact:true}).click();
    await page.locator('.diary-balloon:visible .diary-card').first().waitFor();
    await page.getByRole('button', { name: '지우기', exact: true }).click();
    const stopped = requests; await page.waitForTimeout(400); assert.equal(requests, stopped);
   }
   const timeline = count => ({ rawSignals: Array.from({ length: count }, (_, i) => ({ position: { LatLng: `${37 + i * .01}°, 127°`, timestamp: new Date(Date.UTC(2040, 0, 1) + i * 60000).toISOString() } })) });
   mode = 'empty'; const before = requests; await load(timeline(35)); await consent();
   await page.getByRole('button', { name: '장소 매핑 진행 상태', exact: true }).hover();
   await page.getByText('조회 처리 35/35개', { exact: false }).waitFor(); assert.equal(requests - before, 35);
   assert.equal(await page.locator('.diary-card').count(), 0); await page.keyboard.press('Escape');
   for (const failure of ['auth', 'rate', 'offline']) {
    mode = failure; await load(timeline(2)); const before = requests; await consent();
    await page.getByRole('button', { name: '장소 매핑 진행 상태', exact: true }).hover();
    await page.getByText(failure === 'offline' ? '조회 처리 2/2개' : '조회 중단', { exact: false }).first().waitFor();
    await page.waitForTimeout(500); assert.equal(requests - before, failure === 'offline' ? 2 : 1);
    assert.equal(await page.locator('.diary-card').count(), 0); await page.keyboard.press('Escape');
   }
   mode = 'hold'; await load(timeline(2)); await consent(); await page.waitForTimeout(500);
   await page.getByRole('button', { name: '지우기', exact: true }).click(); if (held) await held();
   mode = 'success'; await page.setViewportSize({ width: 390, height: 844 }); await load(timeline(2)); await consent();
   await page.locator('.diary-balloon:visible .diary-card img').first().waitFor();
   assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
   await page.getByRole('button', {name:'장소 매핑 진행 상태',exact:true}).click();
   await page.getByRole('region', {name:'매핑 진행 세부사항'}).waitFor();
   const ring = await page.getByRole('button', {name:'장소 매핑 진행 상태',exact:true}).boundingBox();
   const tip = await page.getByRole('region', {name:'매핑 진행 세부사항'}).boundingBox();
   assert.ok(tip.y >= ring.y + ring.height - 1 && tip.x >= 0 && tip.x + tip.width <= 390);
   const mobileInfo = await page.getByRole('button', {name:'이용 안내',exact:true}).boundingBox();
   assert.ok(Math.abs(ring.y + ring.height / 2 - mobileInfo.y - mobileInfo.height / 2) < 1);
   await page.keyboard.press('Escape');
   await page.screenshot({ path: `node_modules/.cache/diary-${stage}-mobile.png` });
   await page.locator('.diary-balloon:visible button').first().click();
   await page.getByRole('region', {name:'선택한 장소 상세'}).waitFor();
   assert.equal(await page.getByRole('dialog').evaluate(el => el.scrollWidth > el.clientWidth), false);
   const mobileList = await page.getByRole('complementary', {name:'주변 장소 목록'}).boundingBox();
   const mobileDetail = await page.getByRole('region', {name:'선택한 장소 상세'}).boundingBox();
   assert.ok(mobileList.x + mobileList.width <= mobileDetail.x);
   await page.screenshot({path:`node_modules/.cache/diary-detail-mobile-${stage}.png`});
   await page.getByRole('button', {name:'창 닫기',exact:true}).click();
   await page.setViewportSize({ width: 1280, height: 1000 }); await page.waitForTimeout(500);
   await page.screenshot({ path: `node_modules/.cache/diary-${stage}.png` });
   // Both points are separate groups: identical canvas geometry lets us verify camera preservation.
   await page.mouse.move(640, 500); await page.mouse.wheel(0, -300);
   await page.waitForTimeout(1000);
   await page.mouse.move(640, 500); await page.mouse.down(); await page.mouse.move(715, 555, {steps: 8}); await page.mouse.up();
   await page.waitForTimeout(1000);
   const desktopRing = await page.getByRole('progressbar').boundingBox();
   const toolbar = await page.getByRole('navigation', {name:'발자취 도구'}).boundingBox();
   assert.ok(Math.abs(desktopRing.y - toolbar.y - (toolbar.y + toolbar.height - desktopRing.y - desktopRing.height)) < 1, 'ring has equal top and bottom spacing');
   const canvas = page.locator('.maplibregl-canvas');
   const cameraShot = () => canvas.screenshot({style: '.diary-balloon, .top-controls { visibility: hidden !important; }'});
   const cameraBefore = await cameraShot();
   await page.getByRole('button', {name:'원본 경로',exact:true}).click();
   await page.waitForTimeout(500);
   assert.ok((await cameraShot()).equals(cameraBefore), 'raw mode preserves the camera');
   await page.getByRole('button', {name:'장소별 보기',exact:true}).click();
   await page.waitForTimeout(500);
   assert.ok((await cameraShot()).equals(cameraBefore), 'mapped mode preserves the camera');
   assert.doesNotMatch(await page.getByRole('progressbar').textContent(), /%/);
   const progressNumber = await page.locator('[role=progressbar] > span').evaluate(el => {const s = getComputedStyle(el); return {size:s.fontSize, weight:s.fontWeight, color:s.color};});
   assert.equal(progressNumber.size, '13px'); assert.equal(progressNumber.weight, '700');
   assert.equal(progressNumber.color, await page.getByRole('button',{name:'UTC',exact:true}).evaluate(el => getComputedStyle(el).color));
   assert.equal(await page.locator('.progress-value').evaluate(el => getComputedStyle(el).strokeWidth), '6px');

   mode = 'collision'; collisionSearches = 0;
   const overlapping = timeline(2); overlapping.rawSignals[1].position.LatLng = '37°, 127.00001°';
   overlapping.rawSignals[1].position.timestamp = '2040-01-01T03:00:00Z';
   await load(overlapping); await consent();
   await page.locator('.diary-balloon:visible .landmark-photo img').first().waitFor();
   assert.equal(await page.locator('.diary-balloon:visible strong').filter({hasText:'사진 없는 앞 지점'}).count(),0);
   await page.getByRole('button',{name:'장소 매핑 진행 상태',exact:true}).hover();
   await page.getByRole('button',{name:'사진 있는 장소 보기 (1곳)',exact:true}).click();
   await page.getByRole('dialog',{name:'기록 상세'}).locator('.landmark-photo img').waitFor();
   await page.getByRole('button',{name:'창 닫기',exact:true}).click();
   mode = 'imagefail'; await load(timeline(2)); await consent();
   await page.waitForTimeout(1800);
   await page.getByRole('button', {name:'장소 매핑 진행 상태',exact:true}).hover();
   await page.locator('.mapping-progress-detail p').filter({hasText:/사진.*실패 1/}).waitFor();
   assert.ok(images > 0); assert.equal(errors, 0); assert.equal(unexpected, 0);
   assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
   await context.close(); console.log(stage + ' PASS: automatic diary, four trips, photos, >32 queries, errors, cancellation, mobile');
  }
 } finally { await browser.close(); await dev.close(); await new Promise(resolve => production.httpServer.close(resolve)); }
})().catch(error => { console.error('Diary smoke failed at ' + stage + ': ' + error.message.replace(/https?:\/\/\S+/g, '[URL]')); process.exitCode = 1; });
