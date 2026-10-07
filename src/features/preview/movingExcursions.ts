import type { Coordinate, Observation, ObservationId } from '../../domain/timeline';
import { separationKm } from './analysis';
import type { Suspicion } from './locationQuality';

export const MOVING_POLICY = {
  contextCount:3, contextMinMs:30_000, contextMaxMs:300_000, directionDegrees:60,
  netMeters:100, deviationMeters:1000, detourRatio:5, speedRatio:3, minSpeedKmh:60,
  burstMs:300_000, returnMs:600_000, persistenceMeters:100, persistenceMs:60_000,
  workLimit:2_000_000,
} as const;
export const MOVING_REJECTION_LABELS={context:'이탈 전 이동 문맥·시간 연속성 부족',returnPattern:'시간·방향·거리·우회 조건과 복귀 후 문맥을 함께 만족하는 복귀 없음',persistence:'이탈 위치에서 지속되는 관측 있음',speed:'양쪽 속도와 주변 속도 대비 조건 부족'} as const;
export interface MovingScreening { candidates:number; detected:number; skipped:number; rejected:Record<keyof typeof MOVING_REJECTION_LABELS,number> }
export const emptyMovingScreening=():MovingScreening=>({candidates:0,detected:0,skipped:0,rejected:{context:0,returnPattern:0,persistence:0,speed:0}});
interface Budget { remaining:number }
const spend=(budget:Budget)=>--budget.remaining>=0;
const meters=(a:Observation,b:Observation)=>separationKm(a.coordinate,b.coordinate)*1000;
const accuracy=(p:Observation)=>p.accuracyMeters??0;
const adjusted=(a:Observation,b:Observation)=>Math.max(0,meters(a,b)-accuracy(a)-accuracy(b));
const speed=(a:Observation,b:Observation,conservative=false)=>{
  const ms=b.time.epochMs-a.time.epochMs;
  return ms>0?(conservative?adjusted(a,b):meters(a,b))/ms*3600:0;
};
const bearing=(a:Coordinate,b:Coordinate)=>{
  const lat1=a.latitude*Math.PI/180,lat2=b.latitude*Math.PI/180,lon=(b.longitude-a.longitude)*Math.PI/180;
  return Math.atan2(Math.sin(lon)*Math.cos(lat2),Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(lon));
};
const angle=(a:number,b:number)=>Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)))*180/Math.PI;
/** Distance to the finite shortest great-circle segment, not a predicted road. */
export function segmentDistanceMeters(point:Coordinate,from:Coordinate,to:Coordinate) {
  const radius=6371008.8, length=separationKm(from,to)*1000, distance=separationKm(from,point)*1000;
  if(length<.001) return distance;
  const delta=distance/radius,direction=bearing(from,point)-bearing(from,to);
  const along=Math.atan2(Math.sin(delta)*Math.cos(direction),Math.cos(delta))*radius;
  if(along<0 || along>length) return Math.min(distance,separationKm(to,point)*1000);
  return Math.abs(Math.asin(Math.max(-1,Math.min(1,Math.sin(delta)*Math.sin(direction))))*radius);
}
function continuous(from:Observation,to:Observation) {
  const ms=to.time.epochMs-from.time.epochMs;
  return ms>0 && ms<=MOVING_POLICY.contextMaxMs
    && (from.source??'raw')===(to.source??'raw')
    && (to.predecessorId===undefined || to.predecessorId===from.id);
}
function context(points:readonly Observation[],anchor:number,direction:-1|1,blocked:ReadonlySet<ObservationId>,budget:Budget) {
  const selected=[points[anchor]!];
  if(blocked.has(selected[0]!.id)) return null;
  for(let i=anchor+direction;i>=0 && i<points.length;i+=direction) {
    if(!spend(budget)) return null;
    const point=points[i]!,previous=points[i-direction]!;
    if(blocked.has(point.id) || !continuous(direction===1?previous:point,direction===1?point:previous)) return null;
    const span=Math.abs(point.time.epochMs-points[anchor]!.time.epochMs);
    if(span>MOVING_POLICY.contextMaxMs) return null;
    selected.push(point);
    if(selected.length>=MOVING_POLICY.contextCount && span>=MOVING_POLICY.contextMinMs) return direction===1?selected:selected.reverse();
  }
  return null;
}
function coherent(points:readonly Observation[],direction:number) {
  if(meters(points[0]!,points.at(-1)!)===0 || angle(bearing(points[0]!.coordinate,points.at(-1)!.coordinate),direction)>MOVING_POLICY.directionDegrees) return false;
  return points.slice(1).every((point,i)=>meters(points[i]!,point)===0 || angle(bearing(points[i]!.coordinate,point.coordinate),direction)<=MOVING_POLICY.directionDegrees);
}
function persistent(points:readonly Observation[],start:number,end:number,budget:Budget) {
  for(let i=start;i<end;i++) {
    for(let j=i+1;j<end;j++) {
      if(!spend(budget)) return true;
      if(meters(points[i]!,points[j]!)>MOVING_POLICY.persistenceMeters) break;
      if(points[j]!.time.epochMs-points[i]!.time.epochMs>=MOVING_POLICY.persistenceMs) return true;
    }
  }
  return false;
}
/** Additive rule: never overwrite an existing diagnosis or change original observations. */
export function inspectMovingExcursions(points:readonly Observation[],conflicts:ReadonlySet<ObservationId>,existing:ReadonlyMap<ObservationId,Suspicion>,workLimit:number=MOVING_POLICY.workLimit) {
  const suspects=new Map<ObservationId,Suspicion>(),screening=emptyMovingScreening();
  const blocked=new Set([...conflicts,...existing.keys()]),budget={remaining:workLimit};
  for(let i=1;i<points.length;i++) {
    const before=points[i-1]!,first=points[i]!;
    if(blocked.has(before.id)||blocked.has(first.id)||meters(before,first)<MOVING_POLICY.deviationMeters) continue;
    screening.candidates++;
    if(!spend(budget)) {screening.skipped++;continue;}
    const prior=context(points,i-1,-1,blocked,budget);
    if(!prior || !continuous(before,first)) {if(budget.remaining<0)screening.skipped++;else screening.rejected.context++;continue;}
    let failure:keyof typeof MOVING_REJECTION_LABELS|null='returnPattern';
    for(let j=i+1;j<points.length;j++) {
      if(!spend(budget)) break;
      const after=points[j]!,last=points[j-1]!;
      if(after.time.epochMs-before.time.epochMs>MOVING_POLICY.returnMs || last.time.epochMs-first.time.epochMs>MOVING_POLICY.burstMs
        || blocked.has(after.id) || !continuous(last,after)) break;
      const direct=meters(before,after);
      if(direct<MOVING_POLICY.netMeters) continue;
      const direction=bearing(before.coordinate,after.coordinate);
      if(!coherent(prior,direction)) continue;
      const following=context(points,j,1,blocked,budget);
      if(!following || !coherent(following,direction) || angle(bearing(prior[0]!.coordinate,before.coordinate),bearing(after.coordinate,following.at(-1)!.coordinate))>MOVING_POLICY.directionDegrees) continue;
      let deviation=Infinity,detour=0;
      for(let k=i;k<j;k++) {
        if(!spend(budget)) break;
        deviation=Math.min(deviation,Math.max(0,segmentDistanceMeters(points[k]!.coordinate,before.coordinate,after.coordinate)-accuracy(points[k]!)-Math.max(accuracy(before),accuracy(after))));
        detour+=adjusted(points[k-1]!,points[k]!);
      }
      if(budget.remaining<0) break;
      detour+=adjusted(last,after);
      const ratio=detour/(direct+accuracy(before)+accuracy(after));
      if(deviation<MOVING_POLICY.deviationMeters || ratio<MOVING_POLICY.detourRatio) continue;
      // At the first coherent return, do not search for a later, more convenient return.
      if(persistent(points,i,j,budget)) {failure='persistence';break;}
      let surrounding=0;
      for(const run of [prior,following]) for(let k=1;k<run.length;k++) surrounding=Math.max(surrounding,speed(run[k-1]!,run[k]!));
      const entry=speed(before,first,true),exit=speed(last,after,true);
      if(entry<=MOVING_POLICY.minSpeedKmh || exit<=MOVING_POLICY.minSpeedKmh || entry<surrounding*MOVING_POLICY.speedRatio || exit<surrounding*MOVING_POLICY.speedRatio) {failure='speed';break;}
      const evidence:Suspicion={reason:'moving-excursion',entryKmh:entry,exitKmh:exit,durationMs:last.time.epochMs-first.time.epochMs,count:j-i,
        accuracyUsed:points.slice(i-1,j+1).some(p=>p.accuracyMeters!==undefined),deviationMeters:deviation,detourRatio:ratio,surroundingKmh:surrounding,beforeId:before.id,afterId:after.id};
      for(let k=i;k<j;k++) {suspects.set(points[k]!.id,evidence);blocked.add(points[k]!.id);}
      screening.detected++;failure=null;i=j-1;break;
    }
    if(budget.remaining<0) screening.skipped++;
    else if(failure) screening.rejected[failure]++;
  }
  return {suspects,screening};
}
