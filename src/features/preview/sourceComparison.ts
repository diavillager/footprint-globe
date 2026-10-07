import type { Observation } from '../../domain/timeline';
import { rawTimestamp } from '../../parser/rawPreview';
import type { QualityReport } from './locationQuality';
import { MOVING_POLICY,segmentDistanceMeters } from './movingExcursions';

/** Supplemental evidence only. Never adds/removes a suspect or interpolates an observation. */
export function compareDetailedSource(raw:readonly Observation[],detail:readonly Observation[],report:QualityReport) {
  const instant=(p:Observation)=>rawTimestamp(p.time.sourceText)!.ns;
  const byId=new Map(detail.map(p=>[p.id,p]));
  const edges=detail.flatMap(to=>{
    const from=to.predecessorId?byId.get(to.predecessorId):undefined;
    if(!from || from.sourceSegment!==to.sourceSegment || [from,to].some(p=>report.suspects.has(p.id)||report.conflicts.has(p.id))) return [];
    const start=instant(from),end=instant(to);
    return end>start && end-start<=BigInt(MOVING_POLICY.contextMaxMs)*1000000n?[{from,to,start,end}]:[];
  });
  const starts=[...edges].sort((a,b)=>a.start<b.start?-1:a.start>b.start?1:0);
  const ends=[...edges].sort((a,b)=>a.end<b.end?-1:a.end>b.end?1:0);
  const active=new Set<typeof edges[number]>();let entered=0,exited=0;
  for(const point of raw) {
    const time=instant(point);
    while(entered<starts.length && starts[entered]!.start<=time) active.add(starts[entered++]!);
    while(exited<ends.length && ends[exited]!.end<time) active.delete(ends[exited++]!);
    const evidence=report.suspects.get(point.id);
    if(!evidence || active.size!==1) continue;
    const edge=active.values().next().value!;
    const distance=Math.max(0,segmentDistanceMeters(point.coordinate,edge.from.coordinate,edge.to.coordinate)-(point.accuracyMeters??0)-Math.max(edge.from.accuracyMeters??0,edge.to.accuracyMeters??0));
    report.suspects.set(point.id,{...evidence,detailComparison:distance>=MOVING_POLICY.deviationMeters?'distant':'nearby'});
  }
}
