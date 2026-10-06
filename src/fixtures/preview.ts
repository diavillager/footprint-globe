import type { ParseResult } from '../domain/timeline';

/** Entirely invented trace, not derived from personal samples. */
export function syntheticRawPreview() {
  return { rawSignals: [
    { position: { LatLng: '35.00°, 125.00°', timestamp: '2040-01-01T00:00:00Z' } },
    { position: { LatLng: '35.02°, 125.03°', timestamp: '2040-01-01T00:03:00Z' } },
    { position: { LatLng: '36.00°, 127.00°', timestamp: '2040-01-01T05:00:00Z' } },
    { position: { LatLng: '35.00°, 125.00°', timestamp: '2040-01-03T00:00:00Z' } },
  ] };
}
/** Independent normalized UI fixture: does not invoke or depend on a real parser. */
export function createPreviewDemo(): ParseResult {
  const points = [
    [35, 125, '2040-01-01T00:00:00Z'], [35.02, 125.03, '2040-01-01T00:03:00Z'],
    [36, 127, '2040-01-01T05:00:00Z'], [35, 125, '2040-01-03T00:00:00Z'],
  ] as const;
  return { ok: true, counts: { input: 4, accepted: 4, ignoredSignals: 0, invalidPositions: 0, ignoredRootFields: 0 },
    data: { datasetId: 'dataset:preview-demo', observations: points.map(([latitude, longitude, sourceText], i) => ({
      id: `observation:demo-${i}`, coordinate: { latitude, longitude }, time: { epochMs: Date.parse(sourceText), sourceText },
    })), recordedVisits: [], recordedPaths: [] } };
}
