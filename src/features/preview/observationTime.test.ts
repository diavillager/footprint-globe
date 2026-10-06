import { expect, it } from 'vitest';
import { formatObservationTime } from './observationTime';
import { parseRawPreview } from '../../parser/rawPreview';

it('switches UTC and Korea across a date boundary while retaining source fractional precision', () => {
  const sourceText = '2040-01-02T01:02:03.123456789+09:00';
  const instant = Object.freeze({ sourceText, epochMs: Date.parse(sourceText) });
  expect(formatObservationTime(instant, 'UTC')).toBe('2040-01-01 16:02:03.123456789 UTC');
  expect(formatObservationTime(instant, 'Asia/Seoul')).toBe('2040-01-02 01:02:03.123456789 KST');
  expect(instant.sourceText).toBe(sourceText);
});

it('does not carry nanosecond rounding into the next second or day', () => {
  const sourceText = '2040-01-01T23:59:59.999999999Z';
  const parsed = parseRawPreview(JSON.stringify({ rawSignals: [{ position: { LatLng: '0°, 0°', timestamp: sourceText } }] }), 'dataset:rounding');
  if (!parsed.ok) throw new Error('SYNTHETIC_PARSE_FAILED');
  const instant = parsed.data.observations[0]!.time;
  expect(formatObservationTime(instant, 'UTC')).toBe('2040-01-01 23:59:59.999999999 UTC');
  expect(formatObservationTime(instant, 'Asia/Seoul')).toBe('2040-01-02 08:59:59.999999999 KST');
});
