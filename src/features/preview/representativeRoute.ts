import type { Observation, ObservationId, TimelineData } from '../../domain/timeline';
import { compareObservations } from '../../parser/routeImport';
import { rawTimestamp } from '../../parser/rawPreview';
import { separationKm, type Connection } from './analysis';
import { projectLocationSubset, type BreakReason, type QualityReport } from './locationQuality';

export const SOURCE_JOIN={milliseconds:5*60000,km:.2,speedKmh:300} as const;
export const allSourcePoints=(data:TimelineData)=>[...data.observations,...(data.detailedObservations??[])].sort(compareObservations);
const instant=(point:Observation)=>rawTimestamp(point.time.sourceText)!.ns;
export function representativeRoute(data:TimelineData,quality:QualityReport,excludedIds:readonly ObservationId[],dayBreaks:ReadonlySet<ObservationId>,days:ReadonlyMap<ObservationId,string>=new Map()) {
  const boundaries=(points:readonly Observation[])=>new Set([...dayBreaks,...points.filter((p,i)=>i>0 && days.get(p.id)!==days.get(points[i-1]!.id)).map(p=>p.id)]);
  const raw=projectLocationSubset(data.observations,quality,excludedIds,boundaries(data.observations));
  const bySegment=new Map<string,Observation[]>();
  for(const point of data.detailedObservations??[]) {const id=point.sourceSegment??'';if(!bySegment.has(id)) bySegment.set(id,[]);bySegment.get(id)!.push(point);}
  const detailParts=[...bySegment.values()].map(points=>projectLocationSubset(points,quality,excludedIds,boundaries(points)));
  const detail={points:detailParts.flatMap(p=>p.points),breaks:new Map(detailParts.flatMap(p=>[...p.breaks]))};
  const edges=detailParts.flatMap(p=>p.connections).filter(e=>instant(e.to)>instant(e.from)).sort((a,b)=>compareObservations(a.from,b.from));
  // Discard every edge in an overlapping component; no arbitrary source winner.
  const ambiguous=new Set<Connection>();
  let batch:Connection[]=[],end:bigint|undefined;
  const flush=()=>{if(batch.length>1) for(const edge of batch) ambiguous.add(edge);batch=[];end=undefined;};
  for(const edge of edges) {
    const start=instant(edge.from),stop=instant(edge.to);
    if(end!==undefined && start<end) {batch.push(edge);if(stop>end) end=stop;}
    else {flush();batch=[edge];end=stop;}
  }
  flush();
  const accepted=edges.filter(e=>!ambiguous.has(e));
  const covered=new Set<ObservationId>();let interval=0;
  for(const point of raw.points) {
    const time=instant(point);
    while(interval<accepted.length && instant(accepted[interval]!.to)<time) interval++;
    const edge=accepted[interval];if(edge && instant(edge.from)<=time && time<=instant(edge.to)) covered.add(point.id);
  }
  const chosen=new Map<ObservationId,Observation>();
  for(const point of raw.points) if(!covered.has(point.id)) chosen.set(point.id,point);
  for(const edge of accepted) {chosen.set(edge.from.id,edge.from);chosen.set(edge.to.id,edge.to);}
  // A semantic-only isolated point is still a record, but never fabricates a path.
  if(!data.observations.length) for(const point of detail.points) chosen.set(point.id,point);
  const points=[...chosen.values()].sort(compareObservations),connections:Connection[]=[],gapConnections:Connection[]=[],breaks=new Map<ObservationId,BreakReason>();
  const excluded=new Set(excludedIds);
  const barriers=allSourcePoints(data).filter(p=>excluded.has(p.id)).map(instant);
  const crossesHidden=(from:Observation,to:Observation)=>{
    const left=instant(from),right=instant(to);let lo=0,hi=barriers.length;
    while(lo<hi) {const mid=(lo+hi)>>>1;if(barriers[mid]!<left)lo=mid+1;else hi=mid;}
    return lo<barriers.length && barriers[lo]!<=right;
  };
  const key=(a:Observation,b:Observation)=>`${a.id}|${b.id}`;
  const legal=new Set([...raw.connections,...accepted].map(e=>key(e.from,e.to)));
  for(let i=1;i<points.length;i++) {
    const from=points[i-1]!,to=points[i]!,ms=Number(instant(to)-instant(from))/1e6,km=separationKm(from.coordinate,to.coordinate);
    const different=(from.source??'raw')!==(to.source??'raw');
    let reason:BreakReason|undefined=days.get(from.id)!==days.get(to.id) || dayBreaks.has(to.id)?'day-boundary'
      :quality.conflicts.has(from.id)||quality.conflicts.has(to.id)?'time-conflict'
      :ms>30*60000?'long-gap':undefined;
    if(!reason && !legal.has(key(from,to))) {
      // An excluded point or a source break must not be bridged by a source switch.
      const blocked=raw.breaks.has(to.id)||detail.breaks.has(to.id)||crossesHidden(from,to);
      if(!different || blocked || ms<0 || ms>SOURCE_JOIN.milliseconds || km>SOURCE_JOIN.km || (ms===0?km>0:km/(ms/3600000)>SOURCE_JOIN.speedKmh)) reason='source-boundary';
    }
    if(reason) {
      breaks.set(to.id,reason);
      // Gap geometry never participates in recorded edges, grouping or place lookup.
      if(data.format==='gpx' && (reason==='long-gap'||reason==='source-boundary') && ms>0
        && (to.predecessorId===from.id || to.gapPredecessorId===from.id)) {
        gapConnections.push({from,to,seconds:ms/1000,km});
      }
    }
    else connections.push({from,to,seconds:Math.max(0,ms/1000),km});
  }
  return {points,connections,gapConnections,breaks,excluded:new Set(excludedIds),coveredRaw:covered.size,ambiguousEdges:ambiguous.size};
}
