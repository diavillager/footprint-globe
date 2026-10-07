 'use strict';
// Synthetic files and mocked providers only; no live API traffic.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
let stage = 'startup';
(async () => {
 const { createServer, preview, build } = await import('vite');
 const define = { __MAPTILER_KEY__: JSON.stringify('synthetic-map-key'), __GEOAPIFY_KEY__: JSON.stringify('') };
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
   let requests = 0, images = 0, unexpected = 0, errors = 0, mode = 'success', held, landmarks = [];
   await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin === new URL(origin).origin) return route.continue();
    if (url.hostname === 'api.maptiler.com') return route.fulfill(url.pathname.endsWith('logo.svg') ? { contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" />' } : { json: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#edf3ef' } }] } });
    if (url.hostname === 'www.wikidata.org') {
     assert.equal(req.headers().referer, undefined);
     requests++; assert.match(url.searchParams.get('entity'), /^Q[1-9][0-9]*$/);
     if (mode === 'collision' && url.searchParams.get('entity') === 'Q1000') return route.fulfill({json:{claims:{}}});
     return route.fulfill({ json: { claims: { P18: [{ rank: 'normal', mainsnak: { datavalue: { value: mode === 'imagefail' ? 'Failure.png' : 'Synthetic.png' } } }] } } });
    }
    if (url.hostname === 'commons.wikimedia.org') {
     requests++;
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
    if (!['ja.wikipedia.org','en.wikipedia.org'].includes(url.hostname)) { unexpected++; return route.abort(); }
    requests++; assert.equal(req.method(), 'GET'); assert.equal(req.postData(), null);
    assert.equal(req.headers().referer, undefined);
    assert.equal(url.searchParams.has('apiKey'), false);
    assert.equal(url.searchParams.get('generator'),'geosearch');
    if (mode === 'hold') { held = () => route.fulfill({json:{batchcomplete:true}}).catch(() => {}); return; }
    if (mode === 'auth' || mode === 'rate') return route.fulfill({ status: mode === 'auth' ? 403 : 429, body: 'PRIVATE_ERROR' });
    if (mode === 'offline') return route.abort();
    const [north,west,south,east] = url.searchParams.get('ggsbbox').split('|').map(Number);
    return route.fulfill({json:{batchcomplete:true,query:{pages:mode === 'empty' ? [] : landmarks.filter(f => {
     const [x,y] = f.geometry.coordinates; return x >= west && x <= east && y >= south && y <= north;
    }).map(f=>({pageid:f.id,ns:0,title:'原文 '+f.id,terms:{label:[f.properties.name]},coordinates:[{lat:f.geometry.coordinates[1],lon:f.geometry.coordinates[0],type:'landmark',primary:true}],pageprops:{wikibase_item:'Q'+f.id}}))}}});
   });
   const page = await context.newPage(); page.setDefaultTimeout(35000);
   page.on('pageerror', () => errors++);
   page.on('console', message => { assert.doesNotMatch(message.text(), /CANARY|PRIVATE_ERROR/); });
   await page.goto(origin);
   await page.getByText('상세 지도 준비 완료', { exact: false }).waitFor({ state: 'attached' });
   const load = async timeline => {
    const coords = [...new Set(timeline.rawSignals.map(s => s.position.LatLng))].map(s => s.match(/-?[\d.]+/g).map(Number).reverse());
    landmarks = coords.flatMap((coordinates,i) => {
     if (mode === 'rail' && i === 0) return [];
     const id = mode === 'collision' && i === 0 ? 'synthetic-no-photo' : 'synthetic-' + i;
     const name = mode === 'collision' && i === 0 ? '사진 없는 앞 지점' : mode === 'gallery' ? '사진 장소 ' + i : '가상 박물관';
     return [{id:1000+i,properties:{place_id:id,name,categories:['entertainment.museum']},geometry:{type:'Point',coordinates}},
      {id:2000+i,properties:{place_id:'far-'+i,name:'더 먼 명소',categories:['tourism.sights']},geometry:{type:'Point',coordinates:[coordinates[0],coordinates[1]+.001]}}];
    });
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
   const timeline = count => ({ rawSignals: Array.from({ length: count }, (_, i) => ({ position: { LatLng: `${37 + i * .01}°, 127°`, timestamp: new Date(Date.UTC(2040, 0, 1) + i * 60000).toISOString() } })) });
   if (!process.argv.includes('--rail-only')) {
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
    await page.getByRole('button', { name: /더 먼 명소/ }).first().click();
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

   mode = 'empty'; const before = requests; const dense = timeline(35); dense.rawSignals.forEach((p,i) => {p.position.LatLng = `${(37.005 + i * .00001).toFixed(6)}°, 127.005°`;}); await load(dense); await consent();
   await page.getByRole('button', { name: '장소 매핑 진행 상태', exact: true }).hover();
   await page.getByText('포인트 대조 35/35개', { exact: false }).waitFor(); assert.ok(requests - before < 10, 'dense observations reuse regional requests');
   assert.equal(await page.locator('.diary-card').count(), 0); await page.keyboard.press('Escape');
   await page.getByRole('button', {name:'위치 기록',exact:true}).click();
   await page.locator('.observation-list button').first().click();
   await page.getByRole('dialog', {name:'포인트 정보',exact:true}).waitFor();
   assert.equal(await page.locator('dialog[open]').count(), 0);
   await page.getByRole('button',{name:'말풍선 닫기',exact:true}).click();
   for (const failure of ['auth', 'rate', 'offline']) {
    mode = failure; await load(timeline(2)); const before = requests; await consent();
    await page.getByRole('button', { name: '장소 매핑 진행 상태', exact: true }).hover();
    await page.getByText(failure === 'offline' ? '포인트 대조 2/2개' : '조회 중단', { exact: false }).first().waitFor();
    await page.waitForTimeout(500); if (failure === 'offline') assert.ok(requests - before > 0); else assert.ok(requests - before <= 3);
    assert.equal(await page.locator('.diary-card').count(), 0); await page.keyboard.press('Escape');
   }
   mode = 'hold'; await load(timeline(2)); await consent(); await page.waitForTimeout(500);
   await page.getByRole('button', {name:'장소 매핑 진행 상태',exact:true}).hover();
   await page.getByRole('button', {name:'추가 조회 중단',exact:true}).click();
   const stoppedRequests = requests;
   await page.waitForTimeout(1000); assert.equal(requests, stoppedRequests);
   assert.match(await page.locator('.import-status').textContent(), /관측 2개/);
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
   const cameraShot = () => canvas.screenshot({style: '.diary-balloon, .top-controls, .landmark-rail, .summary-legend { visibility: hidden !important; }'});
   await page.getByRole('button', {name:'원본 경로',exact:true}).click();
   await page.waitForTimeout(500);const cameraBefore=await cameraShot();
   await page.getByRole('button', {name:'장소별 보기',exact:true}).click();await page.waitForTimeout(500);
   await page.getByRole('button', {name:'원본 경로',exact:true}).click();await page.waitForTimeout(500);
   assert.ok((await cameraShot()).equals(cameraBefore), 'round trip between raw and summarized geometry preserves camera');
   await page.getByRole('button', {name:'장소별 보기',exact:true}).click();await page.waitForTimeout(500);
   assert.doesNotMatch(await page.getByRole('progressbar').textContent(), /%/);
   const progressNumber = await page.locator('[role=progressbar] > span').evaluate(el => {const s = getComputedStyle(el); return {size:s.fontSize, weight:s.fontWeight, color:s.color};});
   assert.equal(progressNumber.size, '13px'); assert.equal(progressNumber.weight, '700');
   assert.equal(progressNumber.color, await page.getByRole('button',{name:'UTC',exact:true}).evaluate(el => getComputedStyle(el).color));
   assert.equal(await page.locator('.progress-value').evaluate(el => getComputedStyle(el).strokeWidth), '6px');

   mode = 'collision';
   const overlapping = timeline(2); overlapping.rawSignals[1].position.LatLng = '37°, 127.00001°';
   overlapping.rawSignals[1].position.timestamp = '2040-01-01T03:00:00Z';
   await load(overlapping); await consent();
   await page.locator('.diary-balloon:visible .landmark-photo img').first().waitFor();
   assert.equal(await page.locator('.diary-balloon:visible strong').filter({hasText:'사진 없는 앞 지점'}).count(),0);
   await page.getByRole('button',{name:'장소 매핑 진행 상태',exact:true}).hover();
   await page.locator('summary').filter({hasText:'사진이 있는 장소 1곳'}).click();
   await page.locator('.photo-places button').click();
   await page.getByRole('dialog',{name:'기록 상세'}).locator('.landmark-photo img').waitFor();
   await page.getByRole('button',{name:'창 닫기',exact:true}).click();
   mode = 'gallery'; await load(timeline(4)); await consent();
   for (let i = 0; i < 4; i++) {
    await page.getByRole('button',{name:'장소 매핑 진행 상태',exact:true}).hover();
    await page.locator('summary').filter({hasText:'사진이 있는 장소 4곳'}).click();
    const photoButtons = page.locator('.photo-places button');
    assert.equal(await photoButtons.count(), 4);
    const name = await photoButtons.nth(i).textContent();
    await photoButtons.nth(i).click();
    await page.getByRole('region',{name:'선택한 장소 상세'}).getByRole('heading',{name,exact:true}).waitFor();
    await page.getByRole('button',{name:'창 닫기',exact:true}).click();
   }
   mode = 'imagefail'; await load(timeline(2)); await consent();
   await page.waitForTimeout(1800);
   await page.getByRole('button', {name:'장소 매핑 진행 상태',exact:true}).hover();
   await page.locator('.mapping-progress-detail p').filter({hasText:/사진.*실패 2/}).waitFor();
   }
   mode = 'rail'; await page.setViewportSize({width:390,height:844});
   const railTimeline = timeline(12);
   railTimeline.rawSignals[11].position.LatLng = railTimeline.rawSignals[1].position.LatLng;
   railTimeline.rawSignals[11].position.timestamp = '2040-01-01T06:00:00Z';
   await load(railTimeline); await consent();
   const rail=page.getByRole('navigation',{name:'장소 순서',exact:true});await rail.waitFor();
   const railButtons=rail.locator('li button'), scroller=rail.locator('.landmark-rail-scroll');
   assert.equal(await railButtons.count(),11,'unmatched original observation is excluded; revisit remains');
   await page.locator('.summary-legend').filter({hasText:'장소 10곳 · 연결 11개'}).waitFor(); // Unmatched leading point still connects to the first mapped place.
   assert.deepEqual(await railButtons.allTextContents(),Array.from({length:11},(_,i)=>String(i+1)));
   assert.equal(await scroller.evaluate(el=>el.scrollLeft),0);
   assert.equal(await rail.locator('[aria-pressed=true]').count(),0);
   assert.equal(await page.locator('.landmark-cluster').count(),0,'previous density markers are rolled back');
   const mappingRequests=requests;
   const railCanvas=page.locator('.maplibregl-canvas');
   const railCamera=()=>railCanvas.screenshot({style:'.record-window,.diary-balloon,.top-controls,.landmark-rail,.summary-legend {visibility:hidden !important;}'});
   const beforeRailScroll=await railCamera();
   await scroller.hover();await page.mouse.wheel(0,480);await page.waitForTimeout(400);
   assert.ok(await scroller.evaluate(el=>el.scrollLeft)>0);
   assert.ok((await railCamera()).equals(beforeRailScroll),'ruler wheel must not zoom the map');
   assert.equal(await rail.locator('.rail-arrow, .landmark-rail-heading').count(),0);
   assert.equal(await rail.evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');
   assert.equal(await rail.textContent(),Array.from({length:11},(_,i)=>i+1).join(''));
   await scroller.evaluate(el=>el.scrollLeft=0);
   const firstButton=await railButtons.first().boundingBox();
   const dragStart=await railButtons.nth(3).boundingBox();
   await page.mouse.move(dragStart.x+20,dragStart.y+20);await page.mouse.down();
   await page.mouse.move(dragStart.x-100,dragStart.y+20,{steps:8});await page.mouse.up();
   assert.ok(await scroller.evaluate(el=>el.scrollLeft)>100,'hold and drag on a number scrolls');
   assert.equal(await rail.locator('[aria-pressed=true]').count(),0,'drag release must not select a number');
   assert.ok((await railCamera()).equals(beforeRailScroll),'dragging the ruler must not move the map');
   await scroller.evaluate(el=>el.scrollLeft=0);
   const touch=await context.newCDPSession(page);
   await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:250,y:firstButton.y+20}]});
   for(let x=230;x>=90;x-=20) await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:firstButton.y+20}]});
   await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   assert.ok(await scroller.evaluate(el=>el.scrollLeft)>100,'touch drag scrolls');
   assert.equal(await rail.locator('[aria-pressed=true]').count(),0);
   await railButtons.last().click();
   await page.waitForTimeout(200);const inFlight=await railCamera();
   assert.ok(!inFlight.equals(beforeRailScroll),'flight has begun');
   await page.waitForTimeout(1600);const arrived=await railCamera();
   assert.ok(!arrived.equals(inFlight),'camera moves over time instead of jumping');
   assert.equal(await railButtons.last().getAttribute('aria-pressed'),'true','animated move retains selection');
   assert.equal(await page.getByRole('dialog').count(),0,'number click opens neither details nor a point popup');
   const retainedScroll=await scroller.evaluate(el=>el.scrollLeft);
   await page.mouse.click(3,400);assert.equal(await scroller.evaluate(el=>el.scrollLeft),retainedScroll);
   assert.equal(await rail.locator('[aria-pressed=true]').count(),0);
   await railButtons.first().click();await page.waitForTimeout(1700);
   assert.equal(await rail.locator('[aria-pressed=true]').count(),1);
   await page.screenshot({path:`node_modules/.cache/landmark-rail-mobile-${stage}.png`});
   const railRect=await rail.boundingBox();
   assert.ok(railRect.x>=0 && railRect.x+railRect.width<=390 && railRect.height<65);
   // The selected location arrives at the actual canvas center; clicking it opens the existing place detail.
   const mapRect=await railCanvas.boundingBox();
   await page.mouse.click(mapRect.x+mapRect.width/2,mapRect.y+mapRect.height/2);
   await page.getByRole('heading',{name:'기록 지점 1',exact:true}).waitFor();
   await page.getByRole('heading',{name:'기록 지점 1',exact:true}).click();
   assert.equal(await railButtons.first().getAttribute('aria-pressed'),'true');
   await railButtons.nth(1).click();await page.waitForTimeout(1700);
   assert.equal(await page.getByRole('dialog').count(),0,'number closes an already open detail window');
   await page.mouse.move(3,400);await page.mouse.wheel(0,-300);await page.waitForTimeout(600);
   assert.equal(await rail.locator('[aria-pressed=true]').count(),0);
   await railButtons.nth(2).click();await page.waitForTimeout(1700);
   await railCanvas.focus();await page.keyboard.press('ArrowRight');await page.waitForTimeout(300);
   assert.equal(await rail.locator('[aria-pressed=true]').count(),0,'map keyboard movement clears selection');
   await railButtons.nth(2).click();await page.waitForTimeout(1700);
   await page.mouse.move(3,400);await page.mouse.down();await page.mouse.move(15,440,{steps:4});await page.mouse.up();
   assert.equal(await rail.locator('[aria-pressed=true]').count(),0,'map drag clears selection');
   await railButtons.nth(2).click();await page.waitForTimeout(1700);
   await page.setViewportSize({width:1280,height:1000});await page.waitForTimeout(300);
   await page.screenshot({path:`node_modules/.cache/landmark-rail-desktop-${stage}.png`});
   await page.getByRole('button',{name:'이용 안내',exact:true}).click();
   assert.equal(await rail.locator('[aria-pressed=true]').count(),0);
   await page.getByRole('button',{name:'창 닫기',exact:true}).click();
   assert.equal(requests,mappingRequests,'ruler and selection send no additional mapping requests');
   await page.getByRole('button',{name:'원본 경로',exact:true}).click();assert.equal(await rail.count(),0);
   await page.getByRole('button',{name:'장소별 보기',exact:true}).click();await rail.waitFor();
   assert.equal(await scroller.evaluate(el=>el.scrollLeft),0);
   await load(timeline(3));await consent();await rail.waitFor();assert.equal(await railButtons.count(),2);
   assert.equal(await scroller.evaluate(el=>el.scrollLeft),0);assert.equal(await rail.locator('[aria-pressed=true]').count(),0);
   await page.getByRole('button',{name:'지우기',exact:true}).click();assert.equal(await rail.count(),0);
   mode='success';await page.setViewportSize({width:1280,height:1000});
   const repeats=timeline(18);
   repeats.rawSignals.forEach((signal,i)=>{signal.position.LatLng=`${37+(i%3)*.01}°, 127°`;signal.position.timestamp=new Date(Date.UTC(2040,0,1)+i*10_800_000).toISOString();});
   await load(repeats);await consent();
   await page.locator('.summary-legend').filter({hasText:'장소 3곳 · 연결 3개'}).waitFor();
   assert.equal(await railButtons.count(),18,'all revisit numbers remain');
   await railButtons.nth(12).click();await page.waitForTimeout(1700);
   const selectedCard=page.locator('.diary-balloon:visible').filter({has:page.locator('.diary-number',{hasText:/^13$/})});
   await selectedCard.waitFor();assert.equal(await page.locator('.diary-balloon').count(),1,'one card for six visits at the selected place after zoom');
   await selectedCard.getByText('연결된 기록 6개',{exact:true}).waitFor();
   const selectedGeometry=await railCamera();
   await page.screenshot({path:`node_modules/.cache/place-summary-${stage}.png`});
   await selectedCard.getByRole('button').click();
   await page.getByRole('heading',{name:'기록 지점 13',exact:true}).waitFor();
   await page.getByText('연결된 기록 5 / 6',{exact:true}).waitFor();
   await page.getByRole('button',{name:'다음 지점',exact:true}).click();
   await page.getByRole('heading',{name:'기록 지점 16',exact:true}).waitFor();
   await page.getByRole('button',{name:'창 닫기',exact:true}).click();
   await page.waitForTimeout(300);
   assert.ok(!(await railCamera()).equals(selectedGeometry),'deselect restores overview line styling');
   await page.getByRole('button',{name:'원본 경로',exact:true}).click();
   assert.equal(await page.locator('.summary-legend').count(),0);assert.equal(await rail.count(),0);
   await page.getByRole('button',{name:'위치 기록',exact:true}).click();
   assert.equal(await page.locator('.observation-list button').count(),18,'raw records are untouched');
   await page.getByRole('button',{name:'창 닫기',exact:true}).click();
   mode='empty';
   const noisy=timeline(180), centers=[[37,127],[37.002,127.003],[37.004,127]];
   noisy.rawSignals.forEach((signal,i)=>{const [lat,lon]=centers[i%3];signal.position.LatLng=`${(lat+(i%7)*.00001).toFixed(6)}°, ${(lon+(i%5)*.00001).toFixed(6)}°`;});
   await load(noisy);await consent();
   await page.locator('.summary-legend').filter({hasText:'장소 0곳 · 연결 3개'}).waitFor();
   assert.equal(await rail.count(),0,'unmatched display groups never become landmarks or numbered visits');
   assert.equal(await page.locator('.diary-balloon').count(),0);
   const requestsAfterMapping=requests;
   await page.waitForTimeout(400);const simplified=await railCamera();
   await page.screenshot({path:`node_modules/.cache/waypoints-simplified-${stage}.png`});
   await page.getByRole('button',{name:'원본 경로',exact:true}).click();await page.waitForTimeout(400);
   assert.ok(!(await railCamera()).equals(simplified),'raw path still displays original noisy geometry');
   await page.screenshot({path:`node_modules/.cache/waypoints-original-${stage}.png`});
   await page.locator('.import-status').filter({hasText:'관측 180개 · 연결 179개'}).waitFor();
   await page.getByRole('button',{name:'장소별 보기',exact:true}).click();await page.waitForTimeout(400);
   assert.ok((await railCamera()).equals(simplified),'same camera and display groups after raw/mapped round trip');
   assert.equal(requests,requestsAfterMapping,'display grouping makes no API requests');
   assert.ok(images > 0); assert.equal(errors, 0); assert.equal(unexpected, 0);
   assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
   await context.close(); console.log(stage + (process.argv.includes('--rail-only') ? ' PASS: minimal ruler, mouse/touch drag, animated centering, selection dismissal, replacement, mobile, deduplicated places/edges, revisit details, nearby unmatched waypoints' : ' PASS: four trips, photos, errors, camera preservation, mobile, mapped-place ruler and selection dismissal'));
  }
 } finally { await browser.close(); await dev.close(); await new Promise(resolve => production.httpServer.close(resolve)); }
})().catch(error => { console.error('Diary smoke failed at ' + stage + ': ' + error.stack.replace(/https?:\/\/\S+/g, '[URL]')); process.exitCode = 1; });
