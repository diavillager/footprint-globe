import { expect, it } from 'vitest';
import type { Observation } from '../../domain/timeline';
import type { LandmarkCandidate } from './geoapify';
import { groupObservations } from './groups';
import { summaryLines } from '../preview/mapData';
import { summarizePlaces } from './placeSummary';

function fixture(ids: (string | null)[], coordinates?: Observation['coordinate'][]) {
  const points: Observation[] = ids.map((_,i)=>({id:`observation:${i}`,coordinate:coordinates?.[i] ?? {latitude:37+i*.001,longitude:127},time:{epochMs:i*10_800_000,sourceText:new Date(i*10_800_000).toISOString()}}));
  const groups = groupObservations('dataset:summary',points);
  const candidates = groups.map((_,i): LandmarkCandidate | null => ids[i] ? {provider:'wikimedia',providerPlaceId:ids[i]!,name:'같은 이름',coordinate:points[i]!.coordinate,categories:[],distanceMeters:1000-i,attribution:'Wikidata'} : null);
  const summary = summarizePlaces(groups,g=>candidates[groups.indexOf(g)]!);
  return {points,groups,summary};
}
it('왕복과 같은 장소 내부 연결을 합쳐도 원본 기록과 재방문 순서를 보존한다',()=>{
  const {groups,summary}=fixture(['A','A','B','A','B']);
  expect(summary.nodes).toHaveLength(2);expect(summary.edges).toHaveLength(1);
  expect(summary.edges[0]!.transitions).toEqual([{from:'observation:1',to:'observation:2'},{from:'observation:2',to:'observation:3'},{from:'observation:3',to:'observation:4'}]);
  expect(summary.nodes[0]!.groups).toEqual([groups[0],groups[1],groups[3]]);
  expect(summary.nodes[0]!.point).toBe(groups[3]!.representative);
  expect(groups).toHaveLength(5);expect(new Set(groups.map(g=>g.groupId)).size).toBe(5);
});
it('같은 이름과 가까운 좌표라도 다른 장소 ID를 합치지 않는다',()=>{
  expect(fixture(['A','B']).summary.nodes).toHaveLength(2);
});
it('미매핑/실패 지점을 경유해 기존 연결을 유지하고 바로 가는 연결을 만들지 않는다',()=>{
  const {summary,points}=fixture(['A',null,'B','C',null,'A']);
  expect(summary.nodes).toHaveLength(3);expect(summary.edges).toHaveLength(5);
  expect(summary.edges.flatMap(edge=>edge.transitions)).toEqual(points.slice(1).map((point,i)=>({from:points[i]!.id,to:point.id})));
  expect(summary.edges[0]!.to.point).toBe(points[1]);
  expect(summary.edges[1]!.from.point).toBe(points[1]);
  expect(summary.edges[3]!.to.point).toBe(points[4]);
  expect(summary.edges.some(edge=>edge.key==='["A","B"]')).toBe(false);
  expect(fixture([null,null]).summary.edges).toHaveLength(1);
  expect(fixture(['A','A']).summary.edges).toEqual([]);
});
it('시작과 끝의 미매핑 구간, 같은 장소로 돌아오는 중간 경유를 보존한다',()=>{
  const {summary,points}=fixture([null,'A',null,'A',null]);
  expect(summary.nodes).toHaveLength(1);
  expect(summary.edges).toHaveLength(3);
  expect(summary.edges.reduce((n,edge)=>n+edge.transitions.length,0)).toBe(4);
  expect(summary.edges[0]!.from.point).toBe(points[0]);
  expect(summary.edges.at(-1)!.to.point).toBe(points[4]);
  expect(summary.nodes[0]!.groups).toHaveLength(2);
});
it('선택한 재방문 앞뒤만 강조하고 같은 장소의 다른 방문 연결은 강조하지 않는다',()=>{
  const {summary}=fixture(['A','B','C','A','D']);
  const selected=summaryLines(summary,'observation:3');
  expect(selected.features.filter(f=>f.properties?.highlighted).map(f=>f.properties?.edgeKey)).toEqual(['["A","C"]','["A","D"]']);
  expect(summaryLines(summary,null).features.every(f=>!f.properties?.highlighted && f.properties?.summary)).toBe(true);
});
it('500개 반복 기록은 세 장소와 세 연결로 요약하며 모든 기록에 접근 가능하다',()=>{
  const {summary,points}=fixture(Array.from({length:500},(_,i)=>['A','B','C'][i%3]!));
  expect(summary.nodes).toHaveLength(3);expect(summary.edges).toHaveLength(3);
  expect(summary.byObservation.size).toBe(500);
  expect(summary.edges.reduce((n,e)=>n+e.transitions.length,0)).toBe(499);
  expect(summary.nodes.reduce((n,p)=>n+p.groups.length,0)).toBe(points.length);
});

it('미매핑 600개를 세 근접 묶음과 세 연결로 통합하고 모든 원본 기록을 보존한다',()=>{
  const coordinates=Array.from({length:600},(_,i)=>({latitude:37+(i%3)*.003+(i%7)*.00001,longitude:127+(i%5)*.00001}));
  const {summary,groups}=fixture(coordinates.map(()=>null),coordinates);
  expect(summary.nodes).toHaveLength(0);expect(summary.byObservation.size).toBe(0);
  expect(summary.waypoints).toHaveLength(3);expect(summary.edges).toHaveLength(3);
  expect(summary.waypoints.flatMap(node=>node.groups)).toHaveLength(600);
  expect(new Set(summary.waypoints.flatMap(node=>node.groups.map(group=>group.groupId))).size).toBe(600);
  expect(summary.edges.reduce((n,edge)=>n+edge.transitions.length,0)).toBe(599);
  expect(groups).toHaveLength(600);
});
it('50m 묶음을 연쇄 확장하지 않고 같은 묶음 내부 선만 제거한다',()=>{
  const {summary}=fixture([null,null,null],[{latitude:0,longitude:0},{latitude:.00036,longitude:0},{latitude:.00072,longitude:0}]);
  expect(summary.waypoints).toHaveLength(2);
  expect(summary.waypoints[0]!.groups).toHaveLength(2);expect(summary.edges).toHaveLength(1);
  expect(summary.edges[0]!.transitions).toEqual([{from:'observation:1',to:'observation:2'}]);
});
it('셀 경계·날짜변경선·극점 주변에서도 실제 거리로 묶는다',()=>{
  for(const coordinates of [
    [{latitude:0,longitude:-.0001},{latitude:0,longitude:.0001}],
    [{latitude:0,longitude:179.9999},{latitude:0,longitude:-179.9999}],
    [{latitude:89.9999,longitude:0},{latitude:89.9999,longitude:180}],
  ]) expect(fixture([null,null],coordinates).summary.waypoints).toHaveLength(1);
});
it('가까운 미매핑 포인트를 랜드마크로 간주하지 않고 각 기록의 연결만 강조한다',()=>{
  const {summary}=fixture(['A',null,'B',null,'C'],[
    {latitude:37,longitude:127},{latitude:37,longitude:127.0001},
    {latitude:37.01,longitude:127},{latitude:37,longitude:127.0002},{latitude:37.02,longitude:127},
  ]);
  expect(summary.nodes).toHaveLength(3);expect(summary.waypoints).toHaveLength(1);
  expect(summary.byObservation.has('observation:1')).toBe(false);
  expect(summary.edges).toHaveLength(3);
  const lines=summaryLines(summary,'observation:0');
  expect(lines.features.filter(feature=>feature.properties?.highlighted)).toHaveLength(1);
  expect(summary.nodes[0]!.groups).toHaveLength(1);
});
