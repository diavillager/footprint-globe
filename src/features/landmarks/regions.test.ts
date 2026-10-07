import { afterEach, expect, it, vi } from 'vitest';
import type { Observation } from '../../domain/timeline';
import { nearbyCells, RegionPlan } from './regions';
import { fetchRegion, regionUrl, normalizeRegionPage, LandmarkFailure, type LandmarkCandidate } from './geoapify';
import { groupByLandmark, groupObservations } from './groups';
import { LandmarkSession, startRegionMapping } from './session';
import { buildTrip, trips } from '../../fixtures/travel';
import { parseTimeline } from '../../parser';
const point = (id: number, longitude = .01, latitude = .01, ms = id * 60_000): Observation => ({id:`observation:${id}`,coordinate:{longitude,latitude},time:{epochMs:ms,sourceText:new Date(ms).toISOString()}});
const candidate = (id = 'one', longitude = .01, latitude = .01, distanceMeters = 0): LandmarkCandidate => ({provider:'geoapify',providerPlaceId:id,name:'가상 명소',coordinate:{longitude,latitude},categories:['tourism.sights'],attribution:'Geoapify',distanceMeters});
const feature = (id = 'one', coordinates = [.01,.01]) => ({properties:{place_id:id,name:'가상 명소',categories:['tourism.sights']},geometry:{type:'Point',coordinates}});
afterEach(() => vi.useRealTimers());
it('사각형 요청은 경계와 검색 조건만 전송하며 응답 건수와 유효 장소 수를 구분한다', async () => {
 const bounds = {west:0,south:0,east:.02,north:.02};
 const url = regionUrl(bounds,500,'synthetic');
 expect([...url.searchParams.keys()].sort()).toEqual(['apiKey','categories','filter','lang','limit','offset']);
 expect(url.searchParams.get('filter')).toBe('rect:0,0,0.02,0.02');
 const parsed = normalizeRegionPage({features:[feature(),feature(),feature('outside',[1,1]),{}]},bounds);
 expect(parsed.rawCount).toBe(4); expect(parsed.places).toHaveLength(1);
 const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({features:[]})));
 await fetchRegion(bounds,0,'synthetic',new AbortController().signal,fetcher);
 expect(fetcher.mock.calls[0]![1]).toMatchObject({credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'strict-origin'});
 expect(() => regionUrl({...bounds,west:2},0,'synthetic')).toThrow(LandmarkFailure);
});
it.each([[0,0],[180,0],[-180,0],[35,90],[35,-90],[127,37]])('경계·날짜변경선·극점의 300m 주변을 덮는다 (%s,%s)', (longitude,latitude) => {
 const cells = nearbyCells({longitude,latitude});
 expect(new Set(cells.map(c => c.id)).size).toBe(cells.length);
 for (const c of cells) expect(() => regionUrl(c.bounds,0,'synthetic')).not.toThrow();
 // Sample destinations on the spherical 299m circle, including date-line wrapping.
 const rad = Math.PI / 180, lat = latitude * rad, lon = longitude * rad, d = 299 / 6371008.8;
 for(let bearing=0;bearing<360;bearing+=15) {
  const b=bearing*rad, y=Math.asin(Math.sin(lat)*Math.cos(d)+Math.cos(lat)*Math.sin(d)*Math.cos(b));
  const x=lon+Math.atan2(Math.sin(b)*Math.sin(d)*Math.cos(lat),Math.cos(d)-Math.sin(lat)*Math.sin(y));
  const p={latitude:y/rad,longitude:((x/rad+180)%360+360)%360-180};
  expect(cells.some(c => p.longitude>=c.bounds.west-1e-10 && p.longitude<=c.bounds.east+1e-10 && p.latitude>=c.bounds.south-1e-10 && p.latitude<=c.bounds.north+1e-10)).toBe(true);
 }
});
it('같은 지역을 공유하고 장소를 중복 제거하며 300m 안의 가까운 10개만 연결한다', () => {
 const p=point(0), plan=new RegionPlan([p,point(1)]);
 expect(plan.roots.size).toBe(1);
 const task=plan.next()!;
 const places=Array.from({length:12},(_,i)=>candidate(String(i),.01+i*.0001));
 plan.accept(task,{places:[...places,...places,candidate('far',.019)],rawCount:25});
 expect(plan.finished).toBe(true); expect(plan.summary().places).toBe(13);
 const result=plan.candidates(p.coordinate); expect(result.error).toBeNull(); expect(result.candidates).toHaveLength(10);
 expect(result.candidates[0]!.providerPlaceId).toBe('0');
});
it('500개 페이지는 다음 페이지를 읽고 다시 가득 차면 4분할하며 포화 지역은 실패로 구분한다', () => {
 const plan=new RegionPlan([point(0)]);
 let task=plan.next()!; plan.accept(task,{places:[],rawCount:500});
 task=plan.next()!; expect(task.offset).toBe(500); plan.accept(task,{places:[],rawCount:500});
 let requests=2;
 while((task=plan.next()!)) {expect(task.depth).toBeLessThanOrEqual(3); plan.accept(task,{places:[],rawCount:500}); requests++;}
 expect(requests).toBe(170); expect(plan.finished).toBe(true);
 expect(plan.candidates(point(0).coordinate).error).toBe('SEARCH_INCOMPLETE');
 expect(plan.summary().failed).toBe(1);
});
it('페이지 중복·빈 후속 페이지와 네트워크 실패를 구분한다', () => {
 const plan=new RegionPlan([point(0)]);
 plan.accept(plan.next()!,{places:[candidate()],rawCount:500});
 plan.accept(plan.next()!,{places:[candidate()],rawCount:1});
 expect(plan.candidates(point(0).coordinate).candidates).toHaveLength(1);
 const failed=new RegionPlan([point(0)]); failed.fail(failed.next()!,'NETWORK');
 expect(failed.candidates(point(0).coordinate)).toEqual({candidates:[],error:'NETWORK'});
});
it('장소와 가장 가까운 원본 관측을 중심으로 묶고 다른 장소·미연결·재방문·공백은 분리한다', () => {
 const points=[point(0,.0106),point(1,.01),point(2,.0105),point(3),point(4),point(5),point(6,.01,.01,130*60_000)];
 const matches=new Map(points.map((p,i)=>[p.id,i===4 ? [] : [candidate(i===3 ? 'other':'one',.01,.01,i===1 ? 0:50)]]));
 const before=structuredClone(points), groups=groupByLandmark('dataset:test',points,matches);
 expect(groups.map(g=>g.observationCount)).toEqual([3,1,1,1,1]);
 expect(groups[0]!.representative).toBe(points[1]); expect(groups[0]!.start).toBe(points[0]!.time);
 expect(groups.flatMap(g=>g.sourceObservationIds)).toEqual(points.map(p=>p.id)); expect(points).toEqual(before);
 expect(groups[2]!.landmarkId).toBeNull();
 expect(new Set(groups.map(g=>g.groupId)).size).toBe(5);
 expect(groupByLandmark('dataset:other',points,matches)[0]!.groupId).not.toBe(groups[0]!.groupId);
});
it('100m 초과 연쇄 묶기를 막고 동일 거리·시각은 원본 순서로 결정한다', () => {
 const points=[point(0,.01),point(1,.0108),point(2,.0116)];
 const matches=new Map(points.map(p=>[p.id,[candidate('one',.01,.01,0)]]));
 const groups=groupByLandmark('dataset:test',points,matches);
 expect(groups.map(g=>g.observationCount)).toEqual([2,1]); expect(groups[0]!.representative).toBe(points[0]);
});
it('동의 후 지역→원본 대조→연결 장소 사진 순서, 삭제 및 재설정을 지킨다', async () => {
 vi.useFakeTimers();
 const lookup=vi.fn().mockResolvedValue({places:[candidate()],rawCount:1});
 const photo=vi.fn().mockResolvedValue(null);
 const session=new LandmarkSession('synthetic',undefined,photo,lookup);
 session.prepareRegions('dataset:test',[point(0),point(1)]);
 const stop=startRegionMapping(session);
 await vi.advanceTimersByTimeAsync(500); expect(lookup).not.toHaveBeenCalled();
 session.allow(); await vi.advanceTimersByTimeAsync(2000);
 expect(session.phase).toBe('complete'); expect(lookup).toHaveBeenCalledTimes(1); expect(photo).toHaveBeenCalledTimes(1);
 expect(session.pointCounts).toEqual({success:2,empty:0,error:0}); expect(session.groups).toHaveLength(1);
 expect(session.mappingComplete(session.groups)).toBe(true);
 stop(); session.dispose(); expect(session.groups).toEqual([]); expect(session.regionSummary.places).toBe(0);
 session.prepareRegions('dataset:next',[point(3)]); expect(session.pointCount).toBe(1); expect(session.consent).toBe(false);
});
it('실패를 후보 없음과 분리하고 취소·늦은 응답은 새 세션에 반영하지 않는다', async () => {
 vi.useFakeTimers();
 const session=new LandmarkSession('synthetic',undefined,vi.fn().mockResolvedValue(null),vi.fn().mockRejectedValue(new LandmarkFailure('NETWORK')));
 session.prepareRegions('dataset:test',[point(0)]); session.allow(); const stop=startRegionMapping(session);
 await vi.advanceTimersByTimeAsync(1500); expect(session.pointCounts).toEqual({success:0,empty:0,error:1}); stop();
 let resolve!: (page:{places:LandmarkCandidate[];rawCount:number})=>void;
 const pending=new LandmarkSession('synthetic',undefined,undefined,()=>new Promise(r=>{resolve=r;}));
 pending.prepareRegions('dataset:old',[point(0)]); pending.allow(); const request=pending.queryNextRegion(); pending.dispose();
 pending.prepareRegions('dataset:new',[point(1)]); resolve({places:[candidate()],rawCount:1}); await request;
 expect(pending.regionSummary.places).toBe(0); expect(pending.groups).toEqual([]);
});
it.each(trips.map(t=>t.id))('%s 합성 여행은 원본 건수를 보존하고 기존 대표점 조회보다 초기 구역 수를 줄인다', async id => {
 const parsed=await parseTimeline(JSON.stringify(buildTrip(id).timeline),'dataset:test');
 expect(parsed.ok).toBe(true); if(!parsed.ok) return;
 const points=parsed.data.observations, plan=new RegionPlan(points), old=groupObservations(parsed.data.datasetId,points);
 const oldCoordinates=new Set(old.map(g=>JSON.stringify(g.representative.coordinate)));
 expect(plan.roots.size).toBeLessThan(oldCoordinates.size);
 const groups=groupByLandmark(parsed.data.datasetId,points,new Map());
 expect(groups.flatMap(g=>g.sourceObservationIds)).toEqual(points.map(p=>p.id));
});

it('지역 조회도 최대 3건·250ms 간격·10초 제한을 지키며 늦은 응답을 버린다', async () => {
 vi.useFakeTimers();
 const starts:number[]=[], resolvers:Array<(page:{places:LandmarkCandidate[];rawCount:number})=>void>=[];
 const lookup=vi.fn(()=>{starts.push(Date.now());return new Promise<{places:LandmarkCandidate[];rawCount:number}>(r=>resolvers.push(r));});
 const session=new LandmarkSession('synthetic',undefined,undefined,lookup);
 session.prepareRegions('dataset:test',Array.from({length:5},(_,i)=>point(i,.01+i*.04)));
 session.allow();const stop=startRegionMapping(session);
 await vi.advanceTimersByTimeAsync(1000);expect(lookup).toHaveBeenCalledTimes(3);
 expect(starts[1]!-starts[0]!).toBeGreaterThanOrEqual(250);expect(starts[2]!-starts[1]!).toBeGreaterThanOrEqual(250);
 await vi.advanceTimersByTimeAsync(10_000);expect(session.regionSummary.failed).toBe(3);
 expect(lookup).toHaveBeenCalledTimes(5);
 for(const resolve of resolvers.slice(0,3)) resolve({places:[candidate()],rawCount:1});
 await Promise.resolve();expect(session.regionSummary.places).toBe(0);
 session.stopMapping();stop();await vi.advanceTimersByTimeAsync(20_000);expect(lookup).toHaveBeenCalledTimes(5);
});
