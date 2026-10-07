import type { Observation, ObservationId } from '../../domain/timeline';
import { separationKm, type Connection } from './analysis';

export const QUALITY_POLICY = {
  contextRadiusMeters: 100, contextDurationMs: 60_000, returnMeters: 200,
  excursionMeters: 1000, burstMs: 5 * 60_000, roundTripMs: 10 * 60_000,
  speedKmh: 300, gapMs: 30 * 60_000,
} as const;
export interface Suspicion {
  reason: 'brief-return';
  entryKmh: number;
  exitKmh: number;
  durationMs: number;
  count: number;
  accuracyUsed: boolean;
}
export interface QualityReport {
  suspects: Map<ObservationId, Suspicion>;
  conflicts: Set<ObservationId>;
}
export type BreakReason = 'hidden' | 'long-gap' | 'time-conflict';
const meters = (a: Observation, b: Observation) => separationKm(a.coordinate, b.coordinate) * 1000;
// Reported accuracy only weakens evidence. This is not a guaranteed error bound.
const adjustedMeters = (a: Observation, b: Observation) => Math.max(0, meters(a,b) - (a.accuracyMeters ?? 0) - (b.accuracyMeters ?? 0));
const speed = (a: Observation, b: Observation) => {
  const ms = b.time.epochMs - a.time.epochMs;
  return ms > 0 ? adjustedMeters(a,b) / ms * 3600 : 0;
};
function stable(points: readonly Observation[], anchor: number, direction: -1 | 1, conflicts: ReadonlySet<ObservationId>) {
  const point = points[anchor]!;
  for (let i = anchor + direction; i >= 0 && i < points.length; i += direction) {
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
  for (let i = 1; i + 1 < points.length; i++) {
    const before = points[i-1]!, first = points[i]!;
    if (suspects.has(before.id) || conflicts.has(before.id) || conflicts.has(first.id)
      || adjustedMeters(before,first) < QUALITY_POLICY.excursionMeters
      || speed(before,first) <= QUALITY_POLICY.speedKmh || !stable(points,i-1,-1,conflicts)) continue;
    for (let j = i + 1; j < points.length; j++) {
      const after = points[j]!, last = points[j-1]!;
      if (after.time.epochMs - before.time.epochMs > QUALITY_POLICY.roundTripMs
        || last.time.epochMs - first.time.epochMs > QUALITY_POLICY.burstMs || conflicts.has(last.id)) break;
      if (meters(before,after) <= QUALITY_POLICY.returnMeters) {
        if (!conflicts.has(after.id) && speed(last,after) > QUALITY_POLICY.speedKmh && stable(points,j,1,conflicts)) {
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
  }
  return {suspects,conflicts};
}

/** Only original adjacent observations may connect. Filtering can never create a new edge. */
export function projectLocations(points: readonly Observation[], report: QualityReport, hide: boolean, restored: ReadonlySet<ObservationId>) {
  const visible: Observation[] = [], connections: Connection[] = [], breaks = new Map<ObservationId,BreakReason>();
  const excluded = new Set<ObservationId>();
  for (const point of points) if (hide && report.suspects.has(point.id) && !restored.has(point.id)) excluded.add(point.id);
  let previous: Observation | undefined;
  for (let index=0;index<points.length;index++) {
    const point=points[index]!;
    if (excluded.has(point.id)) continue;
    visible.push(point);
    if (previous) {
      const ms=point.time.epochMs-previous.time.epochMs;
      const reason: BreakReason | undefined = points[index-1] !== previous ? 'hidden'
        : ms > QUALITY_POLICY.gapMs ? 'long-gap'
        : report.conflicts.has(previous.id) || report.conflicts.has(point.id) ? 'time-conflict' : undefined;
      if (reason) breaks.set(point.id,reason);
      else connections.push({from:previous,to:point,seconds:Math.max(0,ms/1000),km:separationKm(previous.coordinate,point.coordinate)});
    }
    previous=point;
  }
  return {points:visible,connections,breaks,excluded};
}
