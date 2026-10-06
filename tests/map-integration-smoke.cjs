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
      await page.goto(origin); console.log(stage, 'opened');
      await page.getByText('상세 지도 준비 완료', { exact: false }).waitFor({timeout:45000});
      const rawSignals = [0, 1, 2].map(i => ({ position: { LatLng: '37.5665°, 126.978°', timestamp: `2040-01-01T0${i}:00:00Z` } }));
      await page.getByLabel('JSON 등록', { exact: true }).setInputFiles({ name: 'CANARY.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ rawSignals })) });
      console.log(stage, 'map-loading');
      await page.getByText('상세 지도 준비 완료', { exact: false }).waitFor({ timeout: 45000 });
      console.log(stage, 'map-ready');
      for (const name of ['관측포인트 목록','시간차 분포','거리 분포']) assert.equal(await page.getByRole('button',{name,exact:true}).getAttribute('aria-expanded'),'false');
      assert.equal(await page.getByRole('radio').count(),0);
      assert.equal(await page.getByRole('spinbutton').count(),0);
      await page.getByRole('button',{name:'관측포인트 목록',exact:true}).click();
      await page.getByRole('button', { name: /^관측 2 ·/ }).click();
      await page.getByRole('dialog').waitFor();
      await page.getByRole('button',{name:'상세 정보 닫기',exact:true}).click();
      await page.waitForTimeout(2000);
      await page.locator('canvas').scrollIntoViewIfNeeded();
      const box = await page.locator('canvas').boundingBox();
      const containerBox = await page.getByLabel('MapTiler 상세 지구본', { exact: true }).boundingBox();
      assert.ok(Math.abs(box.width - containerBox.width) < 2);
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      const popup = page.getByRole('dialog',{name:'관측포인트 상세 정보'});
      await popup.waitFor();
      await popup.getByText('겹친 관측 1 / 3',{exact:true}).waitFor();
      await popup.getByRole('button',{name:'다음 관측',exact:true}).click();
      await popup.getByRole('heading',{name:'관측 2',exact:true}).waitFor();
      await page.getByLabel('표시 시간대',{exact:true}).selectOption('Asia/Seoul');
      assert.match(await popup.textContent(),/10:00:00/);
      const before=await page.locator('.maplibregl-popup-tip').boundingBox();
      await page.mouse.move(box.x+box.width/2+100,box.y+box.height/2+100);
      await page.mouse.down(); await page.mouse.move(box.x+box.width/2+160,box.y+box.height/2+100,{steps:10}); await page.mouse.up();
      await page.waitForTimeout(500);
      const after=await page.locator('.maplibregl-popup-tip').boundingBox();
      assert.ok(Math.abs(after.x-before.x)>10);
      if(server===production) await page.screenshot({path:require('node:path').join(require('node:os').tmpdir(),'map-product-ui-synthetic.png'),fullPage:true});
      assert.ok(counts.external>0); assert.equal(counts.blocked,0); assert.equal(counts.pageErrors,0); assert.equal(counts.consoleLeaks,0);
      // Failure leaves the independent observation list intact.
      for (const status of [403, 429, 0]) {
        await context.route('https://api.maptiler.com/**', route => status ? route.fulfill({ status, body: '{}' }) : route.abort());
        await page.getByRole('button', { name: '기록 지우기', exact: true }).click();
        await page.getByText('[MAP_UNAVAILABLE]', { exact: false }).waitFor();
        await page.getByRole('button',{name:'합성 예제로 체험'}).click();
        await page.getByRole('button',{name:'관측포인트 목록',exact:true}).click();
        assert.equal(await page.locator('.observation-list li').count(),4);
      }
      await page.getByRole('button', { name: '기록 지우기', exact: true }).click();
      assert.equal(await page.getByRole('dialog').count(), 0);
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
      assert.equal(await page.getByLabel('지도 표시', { exact: true }).count(), 0);
      await page.getByRole('button', { name: '합성 예제로 체험' }).click();
      await page.getByText('지도 키가 없습니다.', { exact: false }).waitFor();
      assert.equal(external, 0);
      await page.close();
      console.log('missing-key PASS');
    } finally { await noKey.close(); }
  } finally { await browser.close(); await dev.close(); await production.httpServer.close(); }
})().catch(() => {  console.error('FAIL at ' + stage + ' (details withheld to protect browser keys)'); process.exitCode = 1; });
