import {describe,it,expect} from 'vitest';
import {groupPoints,shortlist,pointsFromTimeline,normalizePlaces,placesUrl} from './landmark';
import {buildTrip,trips} from '../fixtures/travel';
const point={lat:0,lon:0,ms:0};
describe('랜드마크 비교 실험',()=>{
 it('고정 기준점으로 묶어 이동하는 사슬과 재방문을 구별한다',()=>{
 const groups=groupPoints([point,{...point,lon:.0007,ms:60000},{...point,lon:.0014,ms:120000},{...point,ms:180000},{...point,ms:10000000}]);
 expect(groups.map(g=>g.count)).toEqual([2,1,1,1]);
 expect(groups.reduce((n,g)=>n+g.count,0)).toBe(5);
 });
 it.each(trips.map(t=>t.id))('%s의 양쪽 API는 동일한 최대 8개 지점을 사용한다',id=>{
 const points=pointsFromTimeline(buildTrip(id).timeline),groups=groupPoints(points),sample=shortlist(groups);
 expect(groups.reduce((n,g)=>n+g.count,0)).toBe(points.length);
 expect(sample.length).toBeGreaterThan(0);expect(sample.length).toBeLessThanOrEqual(8);
 expect(shortlist(groups)).toEqual(sample);expect(sample.every(g=>g.end-g.start>=600000)).toBe(true);
 });
 it('API에는 좌표 기반 검색만 보내며 날짜와 전체 경로를 보내지 않는다',()=>{
 for(const provider of ['maptiler','geoapify']){const url=placesUrl(provider,point,'synthetic-key');expect(url.protocol).toBe('https:');expect(url.search).not.toContain('timestamp');expect(url.searchParams.get('limit')).toBe('10');}
 expect(()=>placesUrl('unknown',point,'')).toThrow();
 });
 it('먼 후보·잘못된 좌표·중복은 제거하고 유효한 0 좌표는 보존한다',()=>{
 const feature=(name:string,coordinates:number[])=>({properties:{name},geometry:{type:'Point',coordinates}});
 const places=normalizePlaces('geoapify',{features:[feature('합성',[0,0]),feature('합성',[0,0]),feature('원거리',[1,1]),feature('오류',[0,91]),feature('가까움',[.001,0])]},point);
 expect(places.map(p=>p.name)).toEqual(['합성','가까움']);expect(places[0]!.meters).toBe(0);
 expect(()=>normalizePlaces('geoapify',{},point)).toThrow();
 });
 it('MapTiler center와 명칭을 처리한다',()=>{expect(normalizePlaces('maptiler',{features:[{center:[0,0],text:'가상 POI'}]},point)[0]!.name).toBe('가상 POI');});
});
