import { parseRawPreview } from '../parser/rawPreview';

/** Entirely invented trace, not derived from personal samples. */
export function syntheticRawPreview() {
  return { rawSignals: [
    { position: { LatLng: '35.00°, 125.00°', timestamp: '2040-01-01T00:00:00Z' } },
    { position: { LatLng: '35.02°, 125.03°', timestamp: '2040-01-01T00:03:00Z' } },
    { position: { LatLng: '36.00°, 127.00°', timestamp: '2040-01-01T05:00:00Z' } },
    { position: { LatLng: '35.00°, 125.00°', timestamp: '2040-01-03T00:00:00Z' } },
  ] };
}
export function createPreviewDemo() { return parseRawPreview(JSON.stringify(syntheticRawPreview()), 'dataset:preview-demo'); }
