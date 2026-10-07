import type { DatasetId, Instant, Observation, ObservationId } from '../../domain/timeline';
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
