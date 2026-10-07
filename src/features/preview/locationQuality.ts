import type { Observation, ObservationId } from '../../domain/timeline';
import { separationKm, type Connection } from './analysis';
import { emptyMovingScreening,inspectMovingExcursions, type MovingScreening } from './movingExcursions';

export const QUALITY_POLICY = {
  contextRadiusMeters: 100, contextDurationMs: 60_000, returnMeters: 200,
  excursionMeters: 1000, burstMs: 5 * 60_000, roundTripMs: 10 * 60_000,
  speedKmh: 300, gapMs: 30 * 60_000,
} as const;
export interface Suspicion {
  reason: 'brief-return' | 'moving-excursion';
  entryKmh: number;
  exitKmh: number;
  durationMs: number;
  count: number;
  accuracyUsed: boolean;
  deviationMeters?: number;
  detourRatio?: number;
  surroundingKmh?: number;
  beforeId?: ObservationId;
  afterId?: ObservationId;
  detailComparison?: 'distant' | 'nearby';
}
export const SCREENING_LABELS = {
  conflict: '동일 시각 충돌', accuracy: '제공된 정확도 반영 후 거리 부족',
  entrySpeed: '진입 속도가 300km/h 이하이거나 시간 차가 없음',
  beforeContext: '이탈 전 100m 이내·1분 이상 관측 부족',
  returnWindow: '시간·거리 조건에 맞는 복귀 구간 없음',
  exitSpeed: '복귀 속도가 300km/h 이하이거나 시간 차가 없음',
  afterContext: '복귀 후 100m 이내·1분 이상 관측 부족',
} as const;
export type ScreeningReason = keyof typeof SCREENING_LABELS;
export interface Screening { candidates: number; detected: number; rejected: Record<ScreeningReason,number> }
export interface PatternScreening {
  completed: number; skipped: number; stableBefore: number; shortReturn: number; stableAfter: number;
  pattern: number; accuracySupported: number; speed100: number; speed200: number; speed300: number;
}
export interface QualityReport {
  movingScreening?: MovingScreening;
  patternScreening?: PatternScreening;
  /** Entry candidates, not rejected observations; each has exactly one first failing condition. */
  screening?: Screening;
  suspects: Map<ObservationId, Suspicion>;
  conflicts: Set<ObservationId>;
}
export type BreakReason = 'hidden' | 'long-gap' | 'time-conflict' | 'source-boundary' | 'day-boundary';
const meters = (a: Observation, b: Observation) => separationKm(a.coordinate, b.coordinate) * 1000;
// Reported accuracy only weakens evidence. This is not a guaranteed error bound.
const adjustedMeters = (a: Observation, b: Observation) => Math.max(0, meters(a,b) - (a.accuracyMeters ?? 0) - (b.accuracyMeters ?? 0));
const speed = (a: Observation, b: Observation) => {
  const ms = b.time.epochMs - a.time.epochMs;
  return ms > 0 ? adjustedMeters(a,b) / ms * 3600 : 0;
};
function stable(points: readonly Observation[], anchor: number, direction: -1 | 1, conflicts: ReadonlySet<ObservationId>, budget?: { remaining: number }) {
  const point = points[anchor]!;
  for (let i = anchor + direction; i >= 0 && i < points.length; i += direction) {
    if (budget && --budget.remaining < 0) return false;
    const next = points[i]!, adjacent = points[i - direction]!;
    if (conflicts.has(next.id) || Math.abs(next.time.epochMs - adjacent.time.epochMs) > QUALITY_POLICY.gapMs
      || meters(point,next) > QUALITY_POLICY.contextRadiusMeters) return false;
    if (Math.abs(next.time.epochMs - point.time.epochMs) >= QUALITY_POLICY.contextDurationMs) return true;
  }
  return false;
}
function sameInstant(a: Observation, b: Observation) {
  // epochMs can round distinct sub-ms timestamps together. Preserve exact parser semantics.
  const remainder = (point: Observation) => (/\.(\d+)/.exec(point.time.sourceText)?.[1] ?? '').padEnd(9,'0').slice(3);
  return a.time.epochMs === b.time.epochMs && Date.parse(a.time.sourceText) === Date.parse(b.time.sourceText) && remainder(a) === remainder(b);
}
type Vector = [number,number,number];
interface Bounds { min: Vector; max: Vector; left?: Bounds; right?: Bounds; values?: Vector[] }
function conflictInBatch(points: readonly Observation[]) {
  // A 3D bounding tree prunes nearby batches; repeated coordinates are deduplicated.
  // Chord distance has the same ordering as great-circle distance on a sphere.
  const unique = new Map<string,Vector>();
  for (const {coordinate:{latitude,longitude}} of points) {
    const lat=latitude*Math.PI/180,lon=longitude*Math.PI/180;
    unique.set(`${latitude},${longitude}`,[Math.cos(lat)*Math.cos(lon),Math.cos(lat)*Math.sin(lon),Math.sin(lat)]);
  }
  if (unique.size<2) return false;
  const threshold=(2*Math.sin(QUALITY_POLICY.excursionMeters/(2*6371008.8)))**2;
  const vectors=[...unique.values()];
  const tree=(values:Vector[]):Bounds => {
    const min:Vector=[Infinity,Infinity,Infinity],max:Vector=[-Infinity,-Infinity,-Infinity];
    for (const value of values) for (const axis of [0,1,2] as const) {min[axis]=Math.min(min[axis],value[axis]);max[axis]=Math.max(max[axis],value[axis]);}
    if (values.length<=16) return {min,max,values};
    const axis=([0,1,2] as const).reduce((best,index)=>max[index]-min[index]>max[best]-min[best]?index:best,0 as 0|1|2);
    values.sort((a,b)=>a[axis]-b[axis]); const half=Math.floor(values.length/2);
    return {min,max,left:tree(values.slice(0,half)),right:tree(values.slice(half))};
  };
  const root=tree(vectors);
  const far=(point:Vector,node:Bounds):boolean => {
    const upper=point.reduce((sum,value,axis)=>sum+Math.max(Math.abs(value-node.min[axis]!),Math.abs(value-node.max[axis]!))**2,0);
    if (upper<threshold) return false;
    if (node.values) return node.values.some(other=>point.reduce((sum,value,axis)=>sum+(value-other[axis]!)**2,0)>=threshold);
    return far(point,node.left!) || far(point,node.right!);
  };
  return vectors.some(point=>far(point,root));
}
/** Diagnostic only: inspect the shape even when speed/accuracy would stop automatic detection. */
function diagnosePatterns(points: readonly Observation[], starts: readonly number[], conflicts: ReadonlySet<ObservationId>): PatternScreening {
  const totals: PatternScreening = { completed:0, skipped:0, stableBefore:0, shortReturn:0, stableAfter:0,
    pattern:0, accuracySupported:0, speed100:0, speed200:0, speed300:0 };
  // Bounded work for dense exports. Incomplete candidates must never look like failed evidence.
  const budget = { remaining: 2_000_000 };
  for (const index of starts) {
    if (budget.remaining < 0) { totals.skipped++; continue; }
    const before=points[index-1]!, first=points[index]!;
    const beforeStable=stable(points,index-1,-1,conflicts,budget);
    let returned=-1, clean=!conflicts.has(before.id) && !conflicts.has(first.id);
    let accuracySupported=adjustedMeters(before,first)>=QUALITY_POLICY.excursionMeters;
    for (let j=index+1;j<points.length;j++) {
      if (--budget.remaining < 0) break;
      const after=points[j]!,last=points[j-1]!;
      if (after.time.epochMs-before.time.epochMs>QUALITY_POLICY.roundTripMs
        || last.time.epochMs-first.time.epochMs>QUALITY_POLICY.burstMs) break;
      clean=clean && !conflicts.has(last.id) && !conflicts.has(after.id);
      if (meters(before,after)<=QUALITY_POLICY.returnMeters) { returned=j; break; }
      if (meters(before,after)<QUALITY_POLICY.excursionMeters) break;
      accuracySupported=accuracySupported && adjustedMeters(before,after)>=QUALITY_POLICY.excursionMeters;
    }
    const afterStable=returned>=0 && stable(points,returned,1,conflicts,budget);
    if (budget.remaining < 0) {totals.skipped++;continue;}
    totals.completed++;
    if (beforeStable) totals.stableBefore++;
    if (returned>=0) totals.shortReturn++;
    if (afterStable) totals.stableAfter++;
    if (!beforeStable || returned<0 || !afterStable || !clean) continue;
    totals.pattern++;
    if (!accuracySupported) continue;
    totals.accuracySupported++;
    const both=Math.min(speed(before,first),speed(points[returned-1]!,points[returned]!));
    if (both>100) totals.speed100++;
    if (both>200) totals.speed200++;
    if (both>300) totals.speed300++;
  }
  return totals;
}
/** Run once on immutable parser order, in the import worker. Never reclassify after restoration. */
export function inspectLocations(points: readonly Observation[]): QualityReport {
  const suspects = new Map<ObservationId,Suspicion>(), conflicts = new Set<ObservationId>();
  for (let start=0;start<points.length;) {
    let end=start+1;
    while(end<points.length && sameInstant(points[start]!,points[end]!)) end++;
    if (end-start>1 && conflictInBatch(points.slice(start,end))) {
      // No arbitrary winner within an internally inconsistent timestamp batch.
      for(let index=start;index<end;index++) conflicts.add(points[index]!.id);
    }
    start=end;
  }
  const candidateStarts: number[] = [];
  const screening: Screening = { candidates:0, detected:0, rejected:{conflict:0,accuracy:0,entrySpeed:0,beforeContext:0,returnWindow:0,exitSpeed:0,afterContext:0} };
  for (let i = 1; i < points.length; i++) {
    const before = points[i-1]!, first = points[i]!;
    if (suspects.has(before.id) || meters(before,first) < QUALITY_POLICY.excursionMeters) continue;
    screening.candidates++; candidateStarts.push(i);
    if (conflicts.has(before.id) || conflicts.has(first.id)) { screening.rejected.conflict++; continue; }
    if (adjustedMeters(before,first) < QUALITY_POLICY.excursionMeters) { screening.rejected.accuracy++; continue; }
    if (speed(before,first) <= QUALITY_POLICY.speedKmh) { screening.rejected.entrySpeed++; continue; }
    if (!stable(points,i-1,-1,conflicts)) { screening.rejected.beforeContext++; continue; }
    let failure: ScreeningReason | null = 'returnWindow';
    for (let j = i + 1; j < points.length; j++) {
      const after = points[j]!, last = points[j-1]!;
      if (after.time.epochMs - before.time.epochMs > QUALITY_POLICY.roundTripMs
        || last.time.epochMs - first.time.epochMs > QUALITY_POLICY.burstMs) break;
      if (conflicts.has(last.id)) { failure='conflict'; break; }
      if (meters(before,after) <= QUALITY_POLICY.returnMeters) {
        if (conflicts.has(after.id)) failure='conflict';
        else if (speed(last,after) <= QUALITY_POLICY.speedKmh) failure='exitSpeed';
        else if (!stable(points,j,1,conflicts)) failure='afterContext';
        else {
          failure=null; screening.detected++;
          const evidence: Suspicion = {reason:'brief-return', entryKmh:speed(before,first), exitKmh:speed(last,after),
            durationMs:last.time.epochMs-first.time.epochMs, count:j-i,
            accuracyUsed:points.slice(i-1,j+1).some(point => point.accuracyMeters !== undefined)};
          for (let k=i;k<j;k++) suspects.set(points[k]!.id,evidence);
          i=j-1;
        }
        break;
      }
      if (adjustedMeters(before,after) < QUALITY_POLICY.excursionMeters) break;
    }
    if (failure) screening.rejected[failure]++;
  }
  const moving=inspectMovingExcursions(points,conflicts,suspects);
  for(const [id,evidence] of moving.suspects) suspects.set(id,evidence);
  return {suspects,conflicts,screening,movingScreening:moving.screening,patternScreening:diagnosePatterns(points,candidateStarts,conflicts)};
}

/** Only original adjacent observations may connect. Filtering can never create a new edge. */
export function excludedLocationIds(report: QualityReport, hide: boolean, restored: ReadonlySet<ObservationId>): ObservationId[] {
  return hide ? [...report.suspects.keys()].filter(id => !restored.has(id)) : [];
}
export function projectLocations(points: readonly Observation[], report: QualityReport, hide: boolean, restored: ReadonlySet<ObservationId>) {
  return projectLocationSubset(points, report, excludedLocationIds(report,hide,restored));
}
export function projectLocationSubset(points: readonly Observation[], report: QualityReport, excludedIds: readonly ObservationId[], forcedBreaks:ReadonlySet<ObservationId>=new Set()) {
  const visible: Observation[] = [], connections: Connection[] = [], breaks = new Map<ObservationId,BreakReason>();
  const excluded = new Set(excludedIds);
  let previous: Observation | undefined;
  for (let index=0;index<points.length;index++) {
    const point=points[index]!;
    if (excluded.has(point.id)) continue;
    visible.push(point);
    if (previous) {
      const ms=point.time.epochMs-previous.time.epochMs;
      const reason: BreakReason | undefined = points[index-1] !== previous ? 'hidden'
        : forcedBreaks.has(point.id) ? 'day-boundary'
        : point.predecessorId!==undefined && point.predecessorId!==previous.id ? 'source-boundary'
        : ms > QUALITY_POLICY.gapMs ? 'long-gap'
        : report.conflicts.has(previous.id) || report.conflicts.has(point.id) ? 'time-conflict' : undefined;
      if (reason) breaks.set(point.id,reason);
      else connections.push({from:previous,to:point,seconds:Math.max(0,ms/1000),km:separationKm(previous.coordinate,point.coordinate)});
    }
    previous=point;
  }
  return {points:visible,connections,breaks,excluded};
}

/** Never create outlier context across independent GPX/detail runs. */
export function inspectSourceLocations(points:readonly Observation[]):QualityReport {
  if(points.every(p=>p.predecessorId===undefined)) return inspectLocations(points);
  const combined:QualityReport={suspects:new Map(),conflicts:new Set()};
  let run:Observation[]=[];
  const flush=()=>{
    if(!run.length) return;
    const part=inspectLocations(run);
    mergeMovingScreening(combined,part);
    for(const [id,evidence] of part.suspects) combined.suspects.set(id,evidence);
    for(const id of part.conflicts) combined.conflicts.add(id);
    run=[];
  };
  for(const point of points) {if(run.length && point.predecessorId!==run.at(-1)!.id) flush();run.push(point);}
  flush();return combined;
}

export function mergeMovingScreening(target:QualityReport,source:QualityReport) {
  if(!source.movingScreening) return;
  const total=target.movingScreening??=emptyMovingScreening();
  for(const key of ['candidates','detected','skipped'] as const) total[key]+=source.movingScreening[key];
  for(const key of ['context','returnPattern','persistence','speed'] as const) total.rejected[key]+=source.movingScreening.rejected[key];
}
