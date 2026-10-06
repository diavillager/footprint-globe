'use strict';
// Opt-in live MapTiler test; only authored synthetic coordinates and dates.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
let stage = 'startup';
(async () => {
  const { createServer, preview } = await import('vite');
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-swiftshader'] });
  const dev = await createServer({ server: { port: 0 } });
  await dev.listen();
  const production = await preview({ preview: { port: 0 } });
  try {
    for (const server of [dev, production]) {
      stage = server === dev ? 'dev' : 'production';
      const origin = server.resolvedUrls.local[0];
      const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
      const counts = { external: 0, blocked: 0, pageErrors: 0, consoleLeaks: 0 };
      let key = '';
      await context.route('**/*', route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin === new URL(origin).origin) return route.continue();
        counts.external++;
        key ||= url.searchParams.get('key') || '';
        if (request.method() !== 'GET' || url.origin !== 'https://api.maptiler.com' || !/^\/(maps|tiles|fonts|resources|sprites)\//.test(url.pathname) || /CANARY|2040|observation|rawSignals/.test(url.href)) { counts.blocked++; return route.abort(); }
        return route.continue();
      });
      const page = await context.newPage();
      page.on('pageerror', () => counts.pageErrors++);
      page.on('console', message => { if ((key && message.text().includes(key)) || message.text().includes('CANARY')) counts.consoleLeaks++; });
      await page.goto(origin);
      assert.equal(counts.external, 0);
      const rawSignals = [0, 1, 2].map(i => ({ position: { LatLng: '37.5665°, 126.978°', timestamp: `2040-01-01T0${i}:00:00Z` } }));
      await page.getByLabel('원본 JSON 선택', { exact: true }).setInputFiles({ name: 'CANARY.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ rawSignals })) });
      console.log(stage, 'map-loading');
      await page.getByText('상세 지도 준비 완료', { exact: false }).waitFor({ timeout: 45000 });
      console.log(stage, 'map-ready');
      await page.getByRole('radio', { name: '긴 공백은 점선' }).check();
      await page.getByRole('spinbutton', { name: '점선 시간차 기준' }).fill('30');
      await page.getByText('현재 표시: 실선 0개 · 점선 2개.', { exact: false }).waitFor();
      await page.getByRole('button', { name: /^관측 2 ·/ }).click();
      await page.getByRole('heading', { name: '선택한 관측 2', exact: true }).waitFor();
      await page.waitForTimeout(2000);
      await page.locator('canvas').scrollIntoViewIfNeeded();
      const box = await page.locator('canvas').boundingBox();
      const containerBox = await page.getByLabel('MapTiler 상세 지구본', { exact: true }).boundingBox();
      assert.ok(Math.abs(box.width - containerBox.width) < 2);
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.getByText('클릭 위치의 관측 3개', { exact: false }).waitFor();
      await page.getByRole('radio', { name: '한국 시간 (UTC+09:00)', exact: true }).check();
      await page.getByRole('button', { name: /^관측 3 ·/ }).click();
      await page.getByRole('heading', { name: '선택한 관측 3', exact: true }).waitFor();
      if (server === production) await page.screenshot({ path: require('node:path').join(require('node:os').tmpdir(), 'map-integration-synthetic.png'), fullPage: true });
      await page.getByLabel('지도 표시', { exact: true }).selectOption('offline');
      await page.getByRole('button', { name: '처음 위치로', exact: true }).waitFor();
      const requests = counts.external;
      await page.waitForTimeout(1000);
      assert.equal(counts.external, requests);
      assert.ok(requests > 0);
      assert.equal(counts.blocked, 0);
      assert.equal(counts.pageErrors, 0);
      assert.equal(counts.consoleLeaks, 0);
      // Failure leaves the independent observation list intact.
      for (const status of [403, 429, 0]) {
        await context.route('https://api.maptiler.com/**', route => status ? route.fulfill({ status, body: '{}' }) : route.abort());
        await page.getByLabel('지도 표시', { exact: true }).selectOption('maptiler');
        await page.getByText('[MAP_UNAVAILABLE]', { exact: false }).waitFor();
        assert.equal(await page.getByRole('button', { name: /^관측 [123] ·/ }).count(), 3);
        await page.getByLabel('지도 표시', { exact: true }).selectOption('offline');
      }
      await page.getByRole('button', { name: '기록 지우기', exact: true }).click();
      assert.equal(await page.locator('canvas').count(), 0);
      console.log(stage, 'PASS', JSON.stringify(counts));
      await context.close();
    }
    stage = 'missing-key';
    const noKey = await createServer({ define: { __MAPTILER_KEY__: JSON.stringify('') }, server: { port: 0 } });
    await noKey.listen();
    try {
      const page = await browser.newPage();
      let external = 0;
      const origin = noKey.resolvedUrls.local[0];
      await page.route('**/*', route => {
        if (route.request().url().startsWith(origin)) return route.continue();
        external++; return route.abort();
      });
      await page.goto(origin);
      assert.equal(await page.getByLabel('지도 표시', { exact: true }).inputValue(), 'offline');
      await page.getByLabel('지도 표시', { exact: true }).selectOption('maptiler');
      await page.getByRole('button', { name: '합성 예제로 체험' }).click();
      await page.getByText('지도 키가 없습니다.', { exact: false }).waitFor();
      assert.equal(external, 0);
      await page.close();
      console.log('missing-key PASS');
    } finally { await noKey.close(); }
  } finally { await browser.close(); await dev.close(); await production.httpServer.close(); }
})().catch(() => { console.error('FAIL at ' + stage + ' (details withheld to protect browser keys)'); process.exitCode = 1; });
