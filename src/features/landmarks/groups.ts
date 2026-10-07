import type { DatasetId, Instant, Observation, ObservationId } from '../../domain/timeline';
import type { LandmarkCandidate } from './geoapify';
import { separationKm } from '../preview/analysis';

export const GROUP_POLICY = { radiusMeters: 100, maxGapMs: 120 * 60_000 } as const;
export interface ObservationGroup {
  readonly groupId: string;
  readonly sourceObservationIds: readonly ObservationId[];
  readonly representative: Observation;
  readonly start: Instant;
  readonly end: Instant;
  readonly observationCount: number;
}

/** Input is validated, in parser order (including exact sub-ms ties). Never re-sort it. */
export function groupObservations(datasetId: DatasetId, observations: readonly Observation[]): ObservationGroup[] {
  const groups: ObservationGroup[] = [];
  let members: Observation[] = [];
  const finish = () => {
    if (!members.length) return;
    const first = members[0]!, last = members.at(-1)!;
    const ids = members.map(point => point.id);
    groups.push({
      // Exact membership, dataset and policy identify the group, never coordinates or display order.
      groupId: JSON.stringify([datasetId, GROUP_POLICY, ids]), sourceObservationIds: ids,
      representative: first, start: first.time, end: last.time, observationCount: ids.length,
    });
    members = [];
  };
  for (const point of observations) {
    const first = members[0], last = members.at(-1);
    if (first && last && (point.time.epochMs - last.time.epochMs > GROUP_POLICY.maxGapMs
      || separationKm(first.coordinate, point.coordinate) * 1000 > GROUP_POLICY.radiusMeters)) finish();
    members.push(point);
  }
  finish();
  return groups;
}


export interface LandmarkGroup extends ObservationGroup { readonly landmarkId: string | null }
/** Same-place consecutive episodes first; each spatial subset is anchored by its closest observation. */
export function groupByLandmark(datasetId: DatasetId, observations: readonly Observation[],
  matches: ReadonlyMap<ObservationId, readonly LandmarkCandidate[]>, breakBefore: ReadonlySet<ObservationId> = new Set()): LandmarkGroup[] {
  const output: {start:number; group:LandmarkGroup}[] = [];
  const append = (from: number, to: number, anchor: number, landmarkId: string | null) => {
    const members = observations.slice(from, to + 1), ids = members.map(point => point.id);
    output.push({start:from, group:{groupId:JSON.stringify([datasetId, 'landmark-v1', GROUP_POLICY, landmarkId, ids]),
      sourceObservationIds:ids, representative:observations[anchor]!, start:members[0]!.time,
      end:members.at(-1)!.time, observationCount:members.length, landmarkId}});
  };
  let start = 0;
  while (start < observations.length) {
    const id = matches.get(observations[start]!.id)?.[0]?.providerPlaceId ?? null;
    if (!id) { append(start, start, start, null); start++; continue; }
    let end = start + 1;
    while (end < observations.length && !breakBefore.has(observations[end]!.id) && matches.get(observations[end]!.id)?.[0]?.providerPlaceId === id
      && observations[end]!.time.epochMs - observations[end - 1]!.time.epochMs <= GROUP_POLICY.maxGapMs) end++;
    const assigned = new Set<number>();
    const anchors = Array.from({length:end - start}, (_, i) => start + i).sort((a,b) =>
      matches.get(observations[a]!.id)![0]!.distanceMeters - matches.get(observations[b]!.id)![0]!.distanceMeters || a - b);
    for (const anchor of anchors) {
      if (assigned.has(anchor)) continue;
      const within = (index: number) => !assigned.has(index) && separationKm(observations[anchor]!.coordinate, observations[index]!.coordinate) * 1000 <= GROUP_POLICY.radiusMeters;
      let from = anchor, to = anchor;
      while (from > start && within(from - 1)) from--;
      while (to + 1 < end && within(to + 1)) to++;
      for (let index = from; index <= to; index++) assigned.add(index);
      append(from, to, anchor, id);
    }
    start = end;
  }
  return output.sort((a,b) => a.start - b.start).map(item => item.group);
}
