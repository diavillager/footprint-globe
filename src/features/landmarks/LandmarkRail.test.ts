import { expect, it } from 'vitest';
import { mappedStops } from './LandmarkRail';
import { groupObservations } from './groups';
import type { Observation } from '../../domain/timeline';
import type { LandmarkCandidate } from './geoapify';
it('매핑된 지점만 시간순으로 남기고 같은 장소 재방문의 identity를 보존한다',()=>{
 const points:Observation[]=Array.from({length:4},(_,i)=>({id:`observation:${i}`,coordinate:{latitude:37+i*.01,longitude:127},time:{epochMs:i*10_800_000,sourceText:new Date(i*10_800_000).toISOString()}}));
 const groups=groupObservations('dataset:test',points);
 const place:LandmarkCandidate={provider:'wikimedia',providerPlaceId:'wikidata:Q1',name:'합성 장소',coordinate:points[0]!.coordinate,categories:[],distanceMeters:0,attribution:'Wikidata'};
 const stops=mappedStops(groups,g=>g===groups[1]||g===groups[3]?place:null);
 expect(stops.map(stop=>stop.group.representative.id)).toEqual(['observation:1','observation:3']);
 expect(stops[0]!.group.groupId).not.toBe(stops[1]!.group.groupId);
 expect(stops.map(stop=>stop.place.providerPlaceId)).toEqual(['wikidata:Q1','wikidata:Q1']);
 expect(groups).toHaveLength(4);expect(mappedStops(groups,()=>null)).toEqual([]);
});
