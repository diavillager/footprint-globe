import type { ManualVisit, ParseResult, TimelineData, TimelineParser } from '../domain/timeline';

// Authored from scratch. No user export or generated personal sample is copied here.
export function createSyntheticTimeline(): TimelineData {
  const instant = (sourceText: string) => ({ epochMs: Date.parse(sourceText), sourceText });
  return {
    datasetId: 'dataset:synthetic-demo',
    observations: [
      { id: 'observation:first', coordinate: { latitude: 0, longitude: 0 }, time: instant('2040-01-01T00:00:00Z') },
      { id: 'observation:second', coordinate: { latitude: 1, longitude: 2 }, time: instant('2040-01-01T00:10:00Z') },
      { id: 'observation:return', coordinate: { latitude: 0, longitude: 0 }, time: instant('2040-01-03T00:00:00Z') },
    ],
    recordedVisits: [],
    recordedPaths: [],
  };
}
export function createSyntheticManualVisits(): readonly ManualVisit[] {
  return [
    { id: 'visit:first', origin: 'manual', datasetId: 'dataset:synthetic-demo', observationId: 'observation:first' },
    { id: 'visit:return', origin: 'manual', datasetId: 'dataset:synthetic-demo', observationId: 'observation:return' },
  ];
}
/** Separately authored recorded-data scenario, not inferred from the raw observation fixture. */
export function createSyntheticRecordedTimeline(): TimelineData {
  const instant = (sourceText: string) => ({ epochMs: Date.parse(sourceText), sourceText });
  return {
    datasetId: 'dataset:synthetic-recorded', observations: [],
    recordedVisits: [{ id: 'visit:recorded', origin: 'recorded', coordinate: { latitude: 4, longitude: 5 },
      start: instant('2040-02-01T00:00:00Z'), end: instant('2040-02-01T00:30:00Z'), name: '가상 방문지' }],
    recordedPaths: [{ id: 'path:recorded', origin: 'recorded', points: [
      { coordinate: { latitude: 4, longitude: 5 }, time: instant('2040-02-01T00:30:00Z') },
      { coordinate: { latitude: 6, longitude: 7 }, time: instant('2040-02-01T00:50:00Z') },
    ] }],
  };
}
export function createSyntheticEmptyResult(): ParseResult {
  return { ok: false, code: 'NO_VALID_POSITIONS', counts: { input: 0, accepted: 0, ignoredSignals: 0, invalidPositions: 0, ignoredRootFields: 0 } };
}
/** UI development substitute; deliberately not a JSON parser and never used for real file input. */
export const syntheticParser: TimelineParser = async (_text, datasetId): Promise<ParseResult> => ({
  ok: true, data: { ...createSyntheticTimeline(), datasetId }, counts: { input: 3, accepted: 3, ignoredSignals: 0, invalidPositions: 0, ignoredRootFields: 0 },
});
