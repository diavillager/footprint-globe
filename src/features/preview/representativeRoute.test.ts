import { expect,it } from 'vitest';
import type { Observation,TimelineData } from '../../domain/timeline';
import { representativeRoute,allSourcePoints } from './representativeRoute';
import { selectImportDays,observationDay } from './importDates';
const p=(n:number,minute:number,source:'raw'|'semantic'='raw',lon=0,previous:number|null=null,segment='a'):Observation=>({id:`observation:${source}:${n}`,coordinate:{latitude:0,longitude:lon},time:{epochMs:Date.UTC(2040,0,1)+minute*60000,sourceText:new Date(Date.UTC(2040,0,1)+minute*60000).toISOString()},source,...(source==='semantic'?{sourceSegment:segment,predecessorId:previous===null?null:`observation:semantic:${previous}` as const}:{})});
const data=(raw:Observation[],detail:Observation[]):TimelineData=>({datasetId:'dataset:test',observations:raw,detailedObservations:detail,recordedVisits:[],recordedPaths:[]});
const quality={suspects:new Map(),conflicts:new Set<Observation['id']>()};
const route=(value:TimelineData,excluded:Observation['id'][]=[])=>representativeRoute(value,quality,excluded,new Set());
it('uses one detailed path inside its coverage and retains raw originals and outside fallback',()=>{
  const value=data([p(0,0),p(1,1),p(2,2),p(3,3),p(4,4)],[p(0,1,'semantic'),p(1,3,'semantic',0,0)]),before=JSON.stringify(value);
  const r=route(value);expect(r.points.map(p=>p.source)).toEqual(['raw','semantic','semantic','raw']);expect(r.connections).toHaveLength(3);expect(r.coveredRaw).toBe(3);expect(JSON.stringify(value)).toBe(before);
});
it('does not treat overlapping detailed segments as a single authoritative path',()=>{
  const r=route(data([p(0,0),p(1,1),p(2,2),p(3,3)],[p(0,0,'semantic',0,null,'a'),p(2,1,'semantic',0,null,'b'),p(1,2,'semantic',0,0,'a'),p(3,3,'semantic',0,2,'b')]));
  expect(r.ambiguousEdges).toBe(2);expect(r.points.every(p=>p.source==='raw')).toBe(true);
});
it('keeps long gaps and distant or fast source changes disconnected',()=>{
  expect(route(data([p(0,0),p(1,40)],[])).connections).toHaveLength(0);
  const r=route(data([p(0,0),p(1,4)],[p(0,1,'semantic',1),p(1,3,'semantic',1,0)]));
  expect(r.connections).toHaveLength(1);expect(r.breaks.size).toBe(2);
  const fast=route(data([p(0,0)],[p(0,.0001,'semantic',.001),p(1,1,'semantic',.001,0)]));
  expect(fast.connections).toHaveLength(1);
});
it('does not let detail gaps suppress raw fallback or reconnect filtered raw neighbors',()=>{
  const value=data([p(0,0),p(1,1),p(2,2)],[p(0,0,'semantic'),p(1,2,'semantic')]);
  expect(route(value).points.every(p=>p.source==='raw')).toBe(true);
  expect(route(value,['observation:raw:1']).connections).toHaveLength(0);
});
it('does not bridge a hidden raw point by changing to a detailed source',()=>{
  const r=route(data([p(0,0),p(1,2),p(2,4)],[p(0,3,'semantic'),p(1,5,'semantic',0,0)]),['observation:raw:1']);
  expect(r.connections).toHaveLength(1);expect(r.connections[0]!.from.source).toBe('semantic');
});
it('splits every source on import-day boundaries even when a boundary point is replaced',()=>{
  const value=data([p(0,1439),p(1,1440),p(2,1441)],[p(0,1439,'semantic'),p(1,1441,'semantic',0,0)]);
  const all=allSourcePoints(value),selected=selectImportDays(all,'UTC','2040-01-01','2040-01-02');
  const r=representativeRoute(value,quality,[],selected.dayBreaks,new Map(all.map(p=>[p.id,observationDay(p,'UTC')])));
  expect(r.points.every(p=>p.source==='raw')).toBe(true);expect(r.connections).toHaveLength(1);
});
