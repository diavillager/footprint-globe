import { afterEach, expect, it, vi } from 'vitest';
import { WikimediaSource, normalizeWikipedia, wikipediaRegionUrl } from './wikimedia';
import { LandmarkSession } from './session';
import { LandmarkFailure } from './geoapify';
import { RegionPlan } from './regions';
const bounds={west:0,south:0,east:.02,north:.02};
const page=(id=1,entity='Q123')=>({pageid:id,ns:0,title:'合成博物館',coordinates:[{lat:.01,lon:.01,primary:true,type:'landmark'}],pageprops:{wikibase_item:entity},pageimage:'Synthetic.png'});
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status});
afterEach(()=>vi.useRealTimers());
it('경계와 검색 조건만 보내고 키·기록 ID·시각을 포함하지 않는다',()=>{
 const url=wikipediaRegionUrl(bounds,'ja');expect(url.origin).toBe('https://ja.wikipedia.org');
 expect(url.searchParams.get('ggsbbox')).toBe('0.02|0|0|0.02');expect(url.searchParams.get('pilicense')).toBe('free');
 expect(url.searchParams.has('apiKey')).toBe(false);
 expect(()=>wikipediaRegionUrl({...bounds,west:1},'ja')).toThrow(LandmarkFailure);
});
it('도시·잘못된 좌표를 제외하고 Q ID 또는 문서 ID로 식별한다',()=>{
 const result=normalizeWikipedia({query:{pages:[page(),{...page(2),pageprops:{}},{...page(3),coordinates:[{lat:.01,lon:.01,type:'city'}]},{...page(4),coordinates:[{lat:1,lon:1}]}]}},bounds,'ja');
 expect(result.pageCount).toBe(4);expect(result.items.map(i=>i.place.providerPlaceId)).toEqual(['wikidata:Q123','wikipedia:ja:2']);
 expect(normalizeWikipedia({batchcomplete:true},bounds,'ja').items).toEqual([]);
 expect(()=>normalizeWikipedia({error:{code:'badvalue'}},bounds,'ja')).toThrow();
});
it('언어별 중복을 합치고 속성 continuation을 빠짐없이 병합한다',async()=>{
 vi.useFakeTimers();const fetcher=vi.fn(async(input:URL|RequestInfo)=>{
  const u=new URL(String(input));if(u.hostname==='en.wikipedia.org')return json({query:{pages:[{...page(99),title:'English'}]}});
  if(u.searchParams.has('cocontinue'))return json({batchcomplete:true,query:{pages:[{pageid:1,ns:0,title:'合成博物館',coordinates:page().coordinates}]}});
  return json({continue:{continue:'||',cocontinue:'1|2'},query:{pages:[{...page(),coordinates:undefined}]}});
 });
 const source=new WikimediaSource(fetcher);const counter=vi.fn();source.onRequest=counter;
 const promise=source.fetchRegion(bounds,0,'',new AbortController().signal);await vi.runAllTimersAsync();const result=await promise;
 expect(result.places).toHaveLength(1);expect(result.places[0]!.name).toBe('合成博物館');expect(counter).toHaveBeenCalledTimes(3);
 for(const call of fetcher.mock.calls)expect(new URL(String(call[0])).hostname).not.toBe('api.geoapify.com');
});
it('반복 continuation은 빈 결과 대신 미완료 실패로 처리한다',async()=>{
 vi.useFakeTimers();const source=new WikimediaSource(vi.fn().mockImplementation(async()=>json({query:{pages:[page()]},continue:{continue:'same',cocontinue:'same'}})));
 const result=source.fetchRegion(bounds,0,'',new AbortController().signal).catch(e=>e.code);await vi.runAllTimersAsync();expect(await result).toBe('SEARCH_INCOMPLETE');
});
it('500개 미만 밀집 구역에서 좌표 속성의 10페이지 응답을 모두 수집한다',async()=>{
 vi.useFakeTimers();
 const source=new WikimediaSource(vi.fn(async(input:URL|RequestInfo)=>{
  const url=new URL(String(input));if(url.hostname==='en.wikipedia.org')return json({batchcomplete:true});
  const offset=Number(url.searchParams.get('cocontinue')??0);
  const pages=Array.from({length:Math.min(50,499-offset)},(_,i)=>page(offset+i+1,`Q${offset+i+1}`));
  return json({query:{pages},...(offset<450?{continue:{continue:'||',cocontinue:String(offset+50)}}:{batchcomplete:true})});
 }));
 const result=source.fetchRegion(bounds,0,'',new AbortController().signal);await vi.runAllTimersAsync();
 expect((await result).places).toHaveLength(499);expect((await result).subdivide).toBe(false);
});
it('Wikidata P18 우선·Commons 라이선스와 출처를 확인하고 문서 이미지를 대안으로 사용한다',async()=>{
 vi.useFakeTimers();const requests:URL[]=[];
 const source=new WikimediaSource(vi.fn(async(input:URL|RequestInfo)=>{
  const u=new URL(String(input));requests.push(u);
  if(u.hostname.endsWith('wikipedia.org'))return json({query:{pages:[page()]}});
  if(u.hostname==='www.wikidata.org')return json({claims:{P18:[{rank:'preferred',mainsnak:{datavalue:{value:'Missing.png'}}}]}});
  if(u.searchParams.get('titles')==='File:Missing.png')return json({query:{pages:{'-1':{missing:''}}}});
  return json({query:{pages:{'1':{imageinfo:[{thumburl:'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Synthetic.png/480px-Synthetic.png',extmetadata:{Artist:{value:'<b>Author</b>'},LicenseShortName:{value:'CC BY-SA 4.0'}}}]}}}});
 }));
 const region=source.fetchRegion(bounds,0,'',new AbortController().signal);await vi.runAllTimersAsync();await region;
 const promise=source.fetchImage('wikidata:Q123','',new AbortController().signal);await vi.runAllTimersAsync();const image=await promise;
 expect(image).toMatchObject({author:'Author',license:'CC BY-SA 4.0',source:'https://commons.wikimedia.org/wiki/File:Synthetic.png'});
 expect(requests.filter(u=>u.hostname==='commons.wikimedia.org').map(u=>u.searchParams.get('titles'))).toEqual(['File:Missing.png','File:Synthetic.png']);
 source.clear();expect(await source.fetchImage('wikidata:Q123','',new AbortController().signal)).toBeNull();
});
it('메타데이터의 임의 이미지 호스트와 라이선스 누락을 허용하지 않는다',async()=>{
 vi.useFakeTimers();
 for(const url of ['https://example.com/Synthetic.png','https://upload.wikimedia.org/wikipedia/commons/a/ab/Synthetic.png']) {
  const source=new WikimediaSource(vi.fn(async(input:URL|RequestInfo)=>new URL(String(input)).hostname.endsWith('wikipedia.org')?json({query:{pages:[{...page(),pageprops:{}}]}}):json({query:{pages:{'1':{imageinfo:[{thumburl:url}]}}}})));
  const p=source.fetchRegion(bounds,0,'',new AbortController().signal);await vi.runAllTimersAsync();await p;
  const image=source.fetchImage('wikipedia:ja:1','',new AbortController().signal).catch(e=>e.code);await vi.runAllTimersAsync();expect(['UNSUPPORTED','METADATA']).toContain(await image);
 }
});
it('포화 구역은 동일 검색 반복 없이 바로 세분화한다',()=>{
 const plan=new RegionPlan([{id:'observation:1',coordinate:{latitude:.01,longitude:.01},time:{epochMs:0,sourceText:'1970-01-01T00:00:00Z'}}]);
 plan.accept(plan.next()!,{places:[],rawCount:500,subdivide:true});
 const tasks=[plan.next(),plan.next(),plan.next(),plan.next()];expect(tasks.every(t=>t?.offset===0&&t.depth===1)).toBe(true);
});
it('400ms 간격으로 하위 요청도 제한하고 429에서 고정 코드로 중단한다',async()=>{
 vi.useFakeTimers();const starts:number[]=[];
 const source=new WikimediaSource(vi.fn(async()=>{starts.push(Date.now());return json({batchcomplete:true});}));
 const a=source.fetchRegion(bounds,0,'',new AbortController().signal),b=source.fetchRegion(bounds,0,'',new AbortController().signal);
 await vi.runAllTimersAsync();await Promise.all([a,b]);expect(starts).toHaveLength(4);
 for(let i=1;i<starts.length;i++)expect(starts[i]!-starts[i-1]!).toBeGreaterThanOrEqual(400);
 const limited=new WikimediaSource(vi.fn(async()=>json({private:'CANARY'},429)));
 await expect(limited.fetchRegion(bounds,0,'',new AbortController().signal)).rejects.toMatchObject({code:'RATE_LIMIT',message:'RATE_LIMIT'});
});
it('지우기 시 늦은 응답을 버리며 키 없이도 동의 전 호출하지 않는다',async()=>{
 let finish!:(r:Response)=>void;const fetcher=vi.fn(()=>new Promise<Response>(r=>{finish=r;}));const source=new WikimediaSource(fetcher);
 const session=new LandmarkSession('',undefined,source.fetchImage,source.fetchRegion,{clear:source.clear,actualRequests:true});source.onRequest=k=>session.noteRequest(k);
 session.prepareRegions('dataset:test',[{id:'observation:1',coordinate:{latitude:.01,longitude:.01},time:{epochMs:0,sourceText:'1970-01-01T00:00:00Z'}}]);
 expect(session.unavailable).toBeNull();await session.queryNextRegion();expect(fetcher).not.toHaveBeenCalled();
 session.allow();const pending=session.queryNextRegion();expect(session.attempts).toBe(1);session.dispose();finish(json({query:{pages:[page()]}}));await pending;
 expect(session.regionSummary.places).toBe(0);expect(await source.fetchImage('wikidata:Q123','',new AbortController().signal)).toBeNull();
});
