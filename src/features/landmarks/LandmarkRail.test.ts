import { expect, it } from 'vitest';
import { mappedStops } from './LandmarkRail';
import { groupObservations } from './groups';
import type { Observation } from '../../domain/timeline';
import type { LandmarkCandidate } from './geoapify';
it('같은 장소의 번호를 하나로 통합하고 내부 재방문의 identity를 보존한다',()=>{
 const points:Observation[]=Array.from({length:4},(_,i)=>({id:`observation:${i}`,coordinate:{latitude:37+i*.01,longitude:127},time:{epochMs:i*10_800_000,sourceText:new Date(i*10_800_000).toISOString()}}));
 const groups=groupObservations('dataset:test',points);
 const place:LandmarkCandidate={provider:'wikimedia',providerPlaceId:'wikidata:Q1',name:'합성 장소',coordinate:points[0]!.coordinate,categories:[],distanceMeters:0,attribution:'Wikidata'};
 const stops=mappedStops(groups,g=>g===groups[1]||g===groups[3]?place:null);
 expect(stops.map(stop=>stop.group.representative.id)).toEqual(['observation:1']);
 expect(stops[0]!.groups.map(g=>g.representative.id)).toEqual(['observation:1','observation:3']);
 expect(stops.map(stop=>stop.place.providerPlaceId)).toEqual(['wikidata:Q1']);
 expect(groups).toHaveLength(4);expect(mappedStops(groups,()=>null)).toEqual([]);
});

it('이름이 같아도 다른 장소 ID는 첫 등장 순서로 각각 번호를 갖는다',()=>{
 const points:Observation[]=Array.from({length:5},(_,i)=>({id:`observation:${i}`,coordinate:{latitude:37+i*.01,longitude:127},time:{epochMs:i*10_800_000,sourceText:new Date(i*10_800_000).toISOString()}}));
 const groups=groupObservations('dataset:test',points);
 const ids=['B','A','B','C','A'];
 const stops=mappedStops(groups,g=>({provider:'wikimedia',providerPlaceId:ids[groups.indexOf(g)]!,name:'같은 이름',coordinate:g.representative.coordinate,categories:[],distanceMeters:0,attribution:'Wikidata'}));
 expect(stops.map(s=>s.place.providerPlaceId)).toEqual(['B','A','C']);
 expect(stops.map(s=>s.groups.length)).toEqual([2,2,1]);
 expect(stops.flatMap(s=>s.groups)).toHaveLength(groups.length);
});