'use strict';
// Entirely synthetic input; every external request is intercepted.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
let stage = 'startup';
(async () => {
  const { createServer, preview, build } = await import('vite');
  const define = { __MAPTILER_KEY__: JSON.stringify('synthetic-key'), __GEOAPIFY_KEY__: JSON.stringify('') };
  const outDir = 'node_modules/.cache/location-quality-smoke-dist';
  await build({ define, build: { outDir }, logLevel: 'error' });
  const dev = await createServer({ define, server: { port: 0 } }); await dev.listen();
  const production = await preview({ build: { outDir }, preview: { port: 0 } });
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-swiftshader'] });
  try {
    for (const server of [dev, production]) {
      stage = server === dev ? 'development' : 'production';
      const origin = server.resolvedUrls.local[0];
      const context = await browser.newContext({viewport:{width:1440,height:1000}});
      let requests=0, remoteQueries=0, unexpected=0, errors=0;
      await context.route('**/*', async route => {
        const request=route.request(), url=new URL(request.url());
        if (url.origin === new URL(origin).origin) return route.continue();
        if (url.hostname==='api.maptiler.com') return route.fulfill(url.pathname.endsWith('logo.svg')
          ? {contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" />'}
          : {json:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#edf3ef'}}]}});
        requests++;
        assert.equal(request.method(),'GET'); assert.equal(request.postData(),null);
        if(url.hostname==='www.wikidata.org') return route.fulfill({json:{claims:{}}});
        if (!['en.wikipedia.org','ja.wikipedia.org'].includes(url.hostname)) {unexpected++;return route.abort();}
        const [north,west,south,east]=url.searchParams.get('ggsbbox').split('|').map(Number);
        if (west<=127.02 && east>=127.02) remoteQueries++;
        return route.fulfill({json:{batchcomplete:true,query:{pages:[127,127.02].flatMap((lon,i)=>
          lon>=west && lon<=east && 37>=south && 37<=north ? [{pageid:100+i,ns:0,title:`합성 장소 ${i}`,coordinates:[{lat:37,lon,type:'landmark',primary:true}],pageprops:{wikibase_item:`Q${100+i}`}}] : [])}}});
      });
      const page=await context.newPage(); page.setDefaultTimeout(20000);
      page.on('pageerror',()=>errors++);
      page.on('console',message=>assert.doesNotMatch(message.text(),/QUALITY_CANARY/));
      await page.goto(origin);
      await page.getByText('상세 지도 준비 완료',{exact:false}).waitFor({state:'attached'});
      const timeline={rawSignals:[[0,127],[60,127],[70,127.02],[80,127],[140,127]].map(([seconds,lon])=>({position:{LatLng:`37°, ${lon}°`,timestamp:new Date(Date.UTC(2040,0,1)+seconds*1000).toISOString(),accuracyMeters:5}}))};
      const upload=()=>page.getByLabel('JSON 올리기',{exact:true}).setInputFiles({name:'QUALITY_CANARY.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(timeline))});
      const close=()=>page.getByRole('button',{name:'창 닫기',exact:true}).click();
      const inspect=()=>page.getByRole('button',{name:/^위치 검사/}).click();
      const mapped=page.getByRole('button',{name:'장소별 보기',exact:true});
      const allow=async()=>{
        await page.getByRole('button',{name:'허용하고 장소 매핑',exact:true}).click();
        await page.waitForFunction(()=>![...document.querySelectorAll('button')].find(b=>b.textContent==='장소별 보기').disabled);
      };
      await upload();
      await page.getByRole('dialog',{name:'장소 매핑 안내',exact:true}).waitFor();
      assert.match(await page.locator('.import-status').textContent(),/관측 5개 · 연결 2개 · 숨김 1개/);
      assert.equal(await page.getByRole('checkbox',{name:'오류 의심 지점 숨기기'}).isChecked(),true);
      assert.equal(requests,0);
      await allow(); await mapped.click();
      assert.equal(await page.locator('.landmark-rail li button').count(),2);
      assert.equal(remoteQueries,0,'hidden coordinates must not generate region requests');
      await inspect();
      await page.getByRole('button',{name:'이 지점 복원',exact:true}).click();
      assert.equal(await mapped.isDisabled(),true);
      assert.equal(await page.locator('.landmark-rail').count(),0);
      assert.equal(await page.getByRole('button',{name:'원본 경로',exact:true}).getAttribute('aria-pressed'),'true');
      const before=requests; await page.waitForTimeout(900); assert.equal(requests,before,'restore must not fetch');
      assert.match(await page.locator('.import-status').textContent(),/연결 4개 · 숨김 0개/);
      await page.screenshot({path:`node_modules/.cache/location-quality-${stage}.png`});
      await page.getByRole('button',{name:'현재 지점으로 장소 매핑 안내 열기',exact:true}).click();
      assert.equal(requests,before); await allow(); await mapped.click();
      assert.equal(await page.locator('.landmark-rail li button').count(),3);
      assert.ok(remoteQueries>0);
      const restoredRequests=requests;
      for (const checked of [false,true]) {
        await page.getByRole('checkbox',{name:'오류 의심 지점 숨기기'}).setChecked(checked);
        assert.equal(await mapped.isDisabled(),false,'fully restored input keeps mapping');
        assert.equal(await mapped.getAttribute('aria-pressed'),'true');
        assert.equal(await page.locator('.landmark-rail li button').count(),3);
      }
      await page.waitForTimeout(600); assert.equal(requests,restoredRequests);
      await inspect(); await page.getByRole('button',{name:'복원 취소',exact:true}).click(); await close();
      await page.getByRole('button',{name:'위치 기록',exact:true}).click();
      assert.equal(await page.locator('.observation-list li').count(),5,'full original list retained');
      await page.getByRole('button',{name:/^관측 3 ·/}).click();
      await page.getByRole('dialog',{name:'포인트 정보',exact:true}).waitFor();
      await page.getByRole('button',{name:'말풍선 닫기',exact:true}).click();
      const afterReset=requests;
      await page.getByRole('checkbox',{name:'오류 의심 지점 숨기기'}).uncheck();
      assert.match(await page.locator('.import-status').textContent(),/연결 4개 · 숨김 0개/);
      await page.waitForTimeout(600);assert.equal(requests,afterReset);
      await upload(); await page.getByRole('button',{name:'원본만 보기',exact:true}).click();
      assert.equal(await page.getByRole('checkbox',{name:'오류 의심 지점 숨기기'}).isChecked(),true);
      assert.match(await page.locator('.import-status').textContent(),/숨김 1개/);
      await inspect(); assert.match(await page.getByRole('dialog',{name:'위치 검사',exact:true}).textContent(),/개별 복원 0개/);await close();
      const stationary={rawSignals:timeline.rawSignals.filter((_,index)=>index!==2)};
      await page.getByLabel('JSON 올리기',{exact:true}).setInputFiles({name:'QUALITY_CANARY.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(stationary))});
      await page.getByRole('dialog',{name:'장소 매핑 안내',exact:true}).waitFor();
      await allow(); await mapped.click();
      const stationaryRequests=requests;
      for (const checked of [false,true]) {
        await page.getByRole('checkbox',{name:'오류 의심 지점 숨기기'}).setChecked(checked);
        assert.equal(await mapped.isDisabled(),false,'zero suspects must keep mapped mode enabled');
        assert.equal(await mapped.getAttribute('aria-pressed'),'true');
        assert.equal(await page.locator('.landmark-rail li button').count(),1);
      }
      await inspect();
      assert.equal(await page.getByRole('heading',{name:'관측을 선택하세요'}).count(),0);
      await page.getByText('탐지되지 않은 이유 확인',{exact:true}).click();
      assert.match(await page.getByRole('dialog',{name:'위치 검사',exact:true}).textContent(),/이탈 시작 후보 0건/);
      await close(); await page.waitForTimeout(600); assert.equal(requests,stationaryRequests);
      await page.getByRole('button',{name:'지우기',exact:true}).click();
      assert.equal(await page.getByRole('button',{name:/^위치 검사/}).isDisabled(),true);
      assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);
      assert.equal(unexpected,0); assert.equal(errors,0);
      await context.close(); console.log(`${stage} PASS: quality defaults, consent, excluded regions/rail, restore/reset/remap, original inspection, replacement/clear, no storage`);
    }
  } finally {await browser.close();await dev.close();await new Promise(resolve=>production.httpServer.close(resolve));}
})().catch(()=>{console.error('Location quality smoke failed at '+stage+' (details withheld)');process.exitCode=1;});
