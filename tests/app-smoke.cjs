'use strict';
// Synthetic-only app regression. Map resources are mocked; no external network.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
let stage = 'startup';
(async () => {
  const { createServer, preview } = await import('vite');
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-swiftshader'] });
  const dev = await createServer({ server: { port: 0 } }); await dev.listen();
  const production = await preview({ preview: { port: 0 } });
  try {
    for (const server of [dev, production]) {
      stage = server === dev ? 'development' : 'production';
      const origin = server.resolvedUrls.local[0];
      const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
      let errors = 0, leaked = false, unexpected = 0;
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin === new URL(origin).origin) return route.continue();
        if (url.hostname !== 'api.maptiler.com') { unexpected++; return route.abort(); }
        if (url.pathname.endsWith('logo.svg')) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" />' });
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#eef3f6' } }] }) });
      });
      const page = await context.newPage();
      page.on('pageerror', () => errors++);
      page.on('console', message => { if (message.text().includes('CANARY')) leaked = true; });
      await page.goto(origin); console.log(stage, 'opened');
      await page.getByText('상세 지도 준비 완료', { exact: false }).waitFor();
      assert.equal(await page.getByRole('combobox', { name: '지도 표시' }).count(), 0);
      assert.equal(await page.getByRole('radio').count(), 0);
      const signals = Array.from({length: 10123}, (_, i) => ({ position: { LatLng: '37.5665°, 126.978°', timestamp: new Date(Date.UTC(2040,0,1)+i*1000).toISOString() } }));
      await page.getByLabel('JSON 등록', {exact:true}).setInputFiles({name:'CANARY.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({rawSignals:signals}))});
      await page.getByRole('status').first().filter({hasText:'10,123'}).waitFor(); console.log(stage, 'imported');
      for(const name of ['관측포인트 목록','시간차 분포','거리 분포']) {
        const button=page.getByRole('button',{name,exact:true});
        assert.equal(await button.getAttribute('aria-expanded'),'false');
        await button.click(); assert.equal(await button.getAttribute('aria-expanded'),'true');
        await button.click();
      }
      await page.getByRole('button',{name:'관측포인트 목록',exact:true}).click();
      assert.equal(await page.locator('.observation-list li').count(),20);
      await page.getByRole('button',{name:'다음 관측 목록',exact:true}).click();
      await page.getByRole('button',{name:/^관측 21 ·/}).waitFor();
      await page.getByRole('button',{name:/^관측 21 ·/}).click();
      await page.getByRole('dialog',{name:'관측포인트 상세 정보'}).waitFor(); console.log(stage, 'popup');
      assert.equal(await page.locator('.observation-detail').count(),0);
      await page.getByLabel('표시 시간대',{exact:true}).selectOption('Asia/Seoul');
      assert.match(await page.getByRole('dialog').textContent(),/09:00:20/);
      await page.getByRole('button',{name:'상세 정보 닫기',exact:true}).click();
      assert.equal(await page.getByRole('dialog').count(),0);
      assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);
      await page.getByLabel('JSON 등록',{exact:true}).setInputFiles({name:'CANARY.json',mimeType:'application/json',buffer:Buffer.from('{CANARY')});
      await page.getByRole('status').first().filter({hasText:'INVALID_JSON'}).waitFor();
      assert.doesNotMatch(await page.locator('main').textContent(),/CANARY/);
      await page.getByRole('button',{name:'합성 예제로 체험'}).click();
      assert.equal(await page.getByRole('button',{name:'관측포인트 목록',exact:true}).getAttribute('aria-expanded'),'false');
      await page.getByRole('button',{name:'기록 지우기',exact:true}).click();
      assert.equal(await page.getByRole('button',{name:'관측포인트 목록',exact:true}).count(),0);
      assert.equal(await page.getByRole('dialog').count(),0);

      assert.equal(errors,0); assert.equal(leaked,false); assert.equal(unexpected,0);
      await context.close();
      console.log(stage+' PASS: mocked map, 10123 points, collapsed buttons, popup, timezone, import/clear/recovery, worker lifecycle');
    }
  } finally { await browser.close(); await dev.close(); await new Promise(resolve=>production.httpServer.close(resolve)); }
})().catch(()=>{console.error('App smoke failed at '+stage+' (details withheld)'); process.exitCode=1;});
