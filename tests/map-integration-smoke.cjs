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
      await page.getByText('상세 지도 준비 완료', { exact: false }).waitFor({timeout:45000,state:'attached'});
      if(server===production) await page.screenshot({path:require('node:path').join(require('node:os').tmpdir(),'map-korea-initial.png')});
      const rawSignals = [0, 1, 2].map(i => ({ position: { LatLng: '37.5665°, 126.978°', timestamp: `2040-01-01T0${i}:00:00Z` } }));
      await page.getByLabel('JSON 올리기', { exact: true }).setInputFiles({ name: 'CANARY.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ rawSignals })) });
      console.log(stage, 'map-loading');
      await page.getByText('상세 지도 준비 완료', { exact: false }).waitFor({ timeout: 45000, state:'attached' });
      console.log(stage, 'map-ready');
      assert.equal(await page.getByRole('combobox').count(),0);
      assert.equal(await page.locator('dialog[open]').count(),0);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight>innerHeight),false);
      await page.waitForTimeout(1500);
      const box = await page.locator('canvas').boundingBox();
      const containerBox = await page.getByLabel('MapTiler 상세 지구본', { exact: true }).boundingBox();
      assert.ok(Math.abs(box.width - containerBox.width) < 2);
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      const popup = page.getByRole('dialog',{name:'관측포인트 상세 정보'});
      await popup.waitFor();
      await popup.getByText('겹친 관측 1 / 3',{exact:true}).waitFor();
      await popup.getByRole('button',{name:'다음 관측',exact:true}).click();
      await popup.getByRole('heading',{name:'관측 2',exact:true}).waitFor();
      await page.getByRole('button',{name:'한국 시간',exact:true}).click();
      assert.match(await popup.textContent(),/10:00:00/);
      const before=await page.locator('.maplibregl-popup-tip').boundingBox();
      await page.mouse.move(box.x+box.width/2+100,box.y+box.height/2+100);
      await page.mouse.down(); await page.mouse.move(box.x+box.width/2+160,box.y+box.height/2+100,{steps:10}); await page.mouse.up();
      await page.waitForTimeout(500);
      const after=await page.locator('.maplibregl-popup-tip').boundingBox();
      assert.ok(Math.abs(after.x-before.x)>10);
      if(server===production) await page.screenshot({path:require('node:path').join(require('node:os').tmpdir(),'map-fullscreen-synthetic.png'),fullPage:true});
      assert.ok(counts.external>0); assert.equal(counts.blocked,0); assert.equal(counts.pageErrors,0); assert.equal(counts.consoleLeaks,0);
      await page.getByRole('button',{name:'상세 정보 닫기',exact:true}).click();
      for(const name of ['포인트 목록','시간별 분포','거리별 분포']) {
        await page.getByRole('button',{name,exact:true}).click();
        await page.getByRole('dialog',{name,exact:true}).waitFor();
        if(server===production && name==='포인트 목록') await page.screenshot({path:require('node:path').join(require('node:os').tmpdir(),'map-fullscreen-window.png')});
        await page.getByRole('button',{name:'창 닫기',exact:true}).click();
      }
      await page.getByRole('button',{name:'지우기',exact:true}).click();
      assert.equal(await page.getByRole('button',{name:'포인트 목록',exact:true}).isDisabled(),true);
      if(server===production) {
        await page.setViewportSize({width:390,height:844});
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth || document.documentElement.scrollHeight>innerHeight),false);
        await page.getByRole('button',{name:'이용 안내',exact:true}).click();
        const modalBox=await page.locator('dialog[open]').boundingBox();
        assert.ok(modalBox.x>=0 && modalBox.y>=0 && modalBox.x+modalBox.width<=390 && modalBox.y+modalBox.height<=844);
        await page.screenshot({path:require('node:path').join(require('node:os').tmpdir(),'map-fullscreen-mobile.png')});
        await page.keyboard.press('Escape');
      }
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
      await page.getByLabel('JSON 올리기',{exact:true}).setInputFiles({name:'CANARY.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({rawSignals:[{position:{LatLng:'37°, 127°',timestamp:'2040-01-01T00:00:00Z'}}]}))});
      await page.getByText('지도 키가 없습니다.', { exact: false }).waitFor();
      assert.equal(external, 0);
      await page.close();
      console.log('missing-key PASS');
    } finally { await noKey.close(); }
  } finally { await browser.close(); await dev.close(); await production.httpServer.close(); }
})().catch(() => {  console.error('FAIL at ' + stage + ' (details withheld to protect browser keys)'); process.exitCode = 1; });
