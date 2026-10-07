'use strict';
// Complete synthetic inputs and mocked providers only. Never contact a live API.
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
  let captureFailure = async () => {};
  try {
    for (const server of [dev, production]) {
      const origin = server.resolvedUrls.local[0];
      const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
      let requests = 0, unexpected = 0, errors = 0, leaked = false, mode = 'success', held = null;
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin === new URL(origin).origin) return route.continue();
        if (url.hostname === 'api.maptiler.com') {
          if (url.pathname.endsWith('logo.svg')) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" />' });
          return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#eef3f6' } }] }) });
        }
        if (url.origin !== 'https://api.geoapify.com') { unexpected++; return route.abort(); }
        requests++;
        assert.equal(request.method(), 'GET'); assert.equal(request.postData(), null);
        assert.deepEqual([...url.searchParams.keys()].sort(), ['apiKey', 'bias', 'categories', 'filter', 'lang', 'limit']);
        assert.equal(url.pathname, '/v2/places'); assert.equal(url.searchParams.get('apiKey'), 'synthetic-places-key');
        const [longitude, latitude] = url.searchParams.get('filter').slice('circle:'.length).split(',').map(Number);
        const payload = { features: [
          { properties: { place_id: 'synthetic-one', name: '가상 박물관', categories: ['entertainment.museum'] }, geometry: { type: 'Point', coordinates: [longitude, latitude] } },
          { properties: { place_id: 'synthetic-html', name: '<img src=x onerror=alert(1)>', categories: ['tourism.sights'] }, geometry: { type: 'Point', coordinates: [longitude, latitude] } },
        ] };
        if (mode === 'hold') { held = () => route.fulfill({ json: payload }).catch(() => {}); return; }
        if (mode === 'offline') return route.abort();
        if (mode === 'auth') return route.fulfill({ status: 403, body: 'PRIVATE_PROVIDER_ERROR' });
        if (mode === 'rate') return route.fulfill({ status: 429, body: 'PRIVATE_PROVIDER_ERROR' });
        return route.fulfill({ json: mode === 'empty' ? { features: [] } : payload });
      });
      const page = await context.newPage(); page.setDefaultTimeout(15_000);
      captureFailure = () => page.screenshot({ path: 'node_modules/.cache/landmark-failure.png' });
      page.on('pageerror', () => errors++);
      page.on('console', message => { if (/CANARY|PRIVATE_PROVIDER_ERROR/.test(message.text())) leaked = true; });
      await page.goto(origin);
      await page.getByText('상세 지도 준비 완료', { exact: false }).waitFor({ state: 'attached' });
      const load = async timeline => {
        await page.getByLabel('JSON 올리기', { exact: true }).setInputFiles({ name: 'CANARY.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(timeline)) });
        await page.locator('.import-status').filter({ hasText: `관측 ${timeline.rawSignals.length.toLocaleString()}개` }).waitFor();
      };
      const openGroup = async () => {
        const toggle = page.getByRole('button', { name: '근접 관측 묶기', exact: true });
        if (await toggle.getAttribute('aria-pressed') === 'true') await toggle.click();
        await toggle.click();
        // Import and grouping keep zoom, center first representative. Wait for rendered source.
        await page.waitForTimeout(200);
        const box = await page.locator('.map-canvas').boundingBox();
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.getByRole('heading', { name: /관측 묶음/ }).waitFor();
      };
      const consent = () => page.getByRole('button', { name: '이 파일의 좌표 조회에 동의', exact: true }).click();
      const query = () => page.getByRole('button', { name: '주변 후보 조회', exact: true }).click();
      for (const trip of trips) {
        stage = `${server === dev ? 'dev' : 'build'}-${trip.id}`;
        const timeline = buildTrip(trip.id).timeline;
        const before = requests;
        await load(timeline); await openGroup();
        assert.equal(requests, before);
        await consent(); assert.equal(requests, before);
        await query(); await page.getByRole('button', { name: /가상 박물관/ }).waitFor();
        assert.equal(requests, before + 1);
        assert.equal(await page.locator('.landmark-panel img').count(), 0);
        await page.getByRole('button', { name: /가상 박물관/ }).click();
        await page.getByRole('button', { name: '후보 선택 해제', exact: true }).click();
        await page.getByRole('button', { name: '상세 정보 닫기', exact: true }).click();
        await openGroup(); assert.equal(requests, before + 1);
        await page.getByRole('button', { name: /가상 박물관/ }).waitFor();
        await page.getByRole('button', { name: '상세 정보 닫기', exact: true }).click();
        await page.getByRole('button', { name: '포인트 목록', exact: true }).click();
        await page.getByRole('button', { name: /^관측 1 ·/ }).click();
        assert.equal(await page.getByRole('button', { name: '근접 관측 묶기', exact: true }).getAttribute('aria-pressed'), 'false');
        await page.getByRole('heading', { name: '관측 1', exact: true }).waitFor();
        await page.getByRole('button', { name: '상세 정보 닫기', exact: true }).click();
        console.log(stage + ' PASS: grouping, explicit consent, minimal request, cache, safe text, original list');
      }
      const small = { rawSignals: [0, 1, 2].map(i => ({ position: { LatLng: '0°, 0°', timestamp: new Date(Date.UTC(2040, 0, 1) + i * 60000).toISOString() } })) };
      stage = `${server === dev ? 'dev' : 'build'}-repeated-location`;
      const repeated = { rawSignals: [0, 1, 181, 182].map(i => ({ position: { LatLng: '0°, 0°', timestamp: new Date(Date.UTC(2040, 0, 1) + i * 60000).toISOString() } })) };
      await load(repeated); await openGroup(); await consent(); await query();
      await page.getByRole('button', { name: /가상 박물관/ }).click();
      await page.getByRole('button', { name: '다음 묶음', exact: true }).click();
      await page.getByRole('button', { name: '주변 후보 조회', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: '후보 선택 해제', exact: true }).count(), 0);
      await query(); await page.getByRole('button', { name: /가상 박물관/ }).waitFor();
      await page.getByRole('button', { name: '이전 묶음', exact: true }).click();
      await page.getByRole('button', { name: '후보 선택 해제', exact: true }).waitFor();
      const beforeMove = requests;
      await page.locator('.maplibregl-ctrl-zoom-in').click();
      await page.locator('.maplibregl-ctrl-zoom-out').click();
      await page.mouse.move(800, 650); await page.mouse.down({ button: 'right' });
      await page.mouse.move(850, 650, { steps: 10 }); await page.mouse.up({ button: 'right' });
      assert.equal(requests, beforeMove);
      stage += '-failures';
      for (const [failure, expected] of [['empty', '표시할 수 있는 주변 후보가 없습니다.'], ['offline', '[NETWORK]'], ['auth', '[AUTH]'], ['rate', '[RATE_LIMIT]']]) {
        stage = `${server === dev ? 'dev' : 'build'}-${failure}`;
        mode = failure; await load(small); await openGroup(); await consent(); await query();
        await page.locator('.landmark-panel').getByText(expected, { exact: failure === 'empty' }).waitFor();
        assert.equal(await page.getByRole('button', { name: '포인트 목록', exact: true }).isEnabled(), true);
      }
      mode = 'hold'; held = null;
      stage = `${server === dev ? 'dev' : 'build'}-cancel`;
      await load(small); await openGroup(); await consent(); await query();
      await page.getByRole('button', { name: '조회 취소', exact: true }).click();
      await page.getByText('조회가 취소되었습니다.', { exact: true }).waitFor();
      if (held) await held();
      assert.equal(await page.getByRole('button', { name: /가상 박물관/ }).count(), 0);
      held = null;
      stage = `${server === dev ? 'dev' : 'build'}-replace`;
      await page.getByRole('button', { name: '다시 조회', exact: true }).click();
      await page.getByText('주변 후보를 조회하는 중입니다…', { exact: true }).waitFor();
      await load(small); if (held) await held(); await openGroup();
      await page.getByRole('button', { name: '이 파일의 좌표 조회에 동의', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: /가상 박물관/ }).count(), 0);
      mode = 'success';
      stage = `${server === dev ? 'dev' : 'build'}-mobile`;
      await page.setViewportSize({ width: 390, height: 844 });
      stage += '-close';
      await page.getByRole('button', { name: '상세 정보 닫기', exact: true }).click();
      stage += '-open';
      await openGroup(); await consent(); await query();
      stage += '-select';
      await page.getByRole('button', { name: /가상 박물관/ }).click();
      stage += '-bounds';
      assert.equal(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight), false);
      const popup = await page.locator('.maplibregl-popup-content').boundingBox();
      const controls = await page.locator('.top-controls').boundingBox();
      await page.screenshot({ path: 'node_modules/.cache/landmark-mobile.png' });
      assert.ok(popup.x >= 0 && popup.y >= 0 && popup.x + popup.width <= 391 && popup.y + popup.height <= 845);
      assert.ok(popup.y >= controls.y + controls.height);
      if (server === production) await page.screenshot({ path: 'node_modules/.cache/landmark-mobile.png' });
      await page.getByRole('button', { name: '상세 정보 닫기', exact: true }).click();
      await page.getByRole('button', { name: '지우기', exact: true }).click();
      assert.equal(await page.getByRole('dialog').count(), 0);
      assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
      await page.reload();
      assert.equal(await page.getByRole('button', { name: '포인트 목록', exact: true }).isDisabled(), true);
      assert.equal(errors, 0); assert.equal(unexpected, 0); assert.equal(leaked, false);
      await context.close(); console.log(stage + ' PASS: empty/offline/auth/rate, cancellation, replacement, mobile, clear/reload');
    }
  } catch (error) { await captureFailure(); throw error; }
  finally { await browser.close(); await dev.close(); await new Promise(resolve => production.httpServer.close(resolve)); }
})().catch(() => { console.error('Landmark smoke failed at ' + stage + ' (details withheld)'); process.exitCode = 1; });
