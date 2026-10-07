import { expect,it } from 'vitest';
import type { Observation } from '../../domain/timeline';
import { inspectLocations } from './locationQuality';
import { compareDetailedSource } from './sourceComparison';

const raw:Observation[]=Array.from({length:7},(_,i)=>({id:`observation:r${i}`,coordinate:{latitude:i===3?.02:0,longitude:i*.001},time:{epochMs:Date.UTC(2040,0,1)+i*30000,sourceText:new Date(Date.UTC(2040,0,1)+i*30000).toISOString()}}));
const details=(lat=0):Observation[]=>[2,4].map((i,n)=>({...raw[i]!,id:`observation:d${n}`,coordinate:{...raw[i]!.coordinate,latitude:lat},source:'semantic',sourceSegment:'a',predecessorId:n?'observation:d0':null}));
it('adds source disagreement as evidence only and never changes suspect membership',()=>{
  for(const [latitude,expected] of [[0,'distant'],[.02,'nearby']] as const) {
    const report=inspectLocations(raw),ids=[...report.suspects.keys()],original=JSON.stringify(raw);
    compareDetailedSource(raw,details(latitude),report);
    expect(report.suspects.get('observation:r3')?.detailComparison).toBe(expected);
    expect([...report.suspects.keys()]).toEqual(ids);expect(JSON.stringify(raw)).toBe(original);
  }
});
it('does not corroborate from overlapping, invalid, suspicious or missing detailed edges',()=>{
  for(const detail of [[],details().map(p=>({...p,predecessorId:null})),[...details(),...details().map(p=>({...p,id:`${p.id}x` as const,predecessorId:p.predecessorId?`${p.predecessorId}x` as const:null,sourceSegment:'b'}))]]) {
    const report=inspectLocations(raw);compareDetailedSource(raw,detail,report);
    expect(report.suspects.get('observation:r3')?.detailComparison).toBeUndefined();
  }
  const report=inspectLocations(raw);report.conflicts.add('observation:d0');compareDetailedSource(raw,details(),report);
  expect(report.suspects.get('observation:r3')?.detailComparison).toBeUndefined();
});
