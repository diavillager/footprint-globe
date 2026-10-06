import { expect, it } from 'vitest';
import { formatObservationTime } from './observationTime';

it('switches UTC and Korea across a date boundary while retaining source fractional precision', () => {
  const sourceText = '2040-01-02T01:02:03.123456789+09:00';
  const instant = Object.freeze({ sourceText, epochMs: Date.parse(sourceText) });
  expect(formatObservationTime(instant, 'UTC')).toBe('2040-01-01 16:02:03.123456789 UTC');
  expect(formatObservationTime(instant, 'Asia/Seoul')).toBe('2040-01-02 01:02:03.123456789 KST');
  expect(instant.sourceText).toBe(sourceText);
});
