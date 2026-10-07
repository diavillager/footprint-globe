import { expect, it } from 'vitest';
import { parseRawPreview } from '../../parser/rawPreview';
import { observationDay, selectImportDays, summarizeImportDays } from './importDates';

const parse=(times:string[])=>{
  const result=parseRawPreview(JSON.stringify({rawSignals:times.map(timestamp=>({position:{LatLng:'0°, 0°',timestamp}}))}),'dataset:days');
  if(!result.ok) throw new Error('SYNTHETIC_FIXTURE');
  return result.data.observations;
};
it('summarizes all recorded days across months without requiring continuous recording',()=>{
  const points=parse(['2040-01-31T23:59:59Z','2040-02-01T00:00:00Z','2040-02-01T01:00:00Z','2040-03-31T00:00:00Z']);
  const summary=summarizeImportDays(points,'UTC');
  expect(summary.days).toEqual(['2040-01-31','2040-02-01','2040-03-31']);
  expect(summary.counts.get('2040-02-01')).toBe(2);
  expect([summary.first,summary.last]).toEqual(['2040-01-31','2040-03-31']);
});
it('uses the supplied timezone and preserves exact sub-millisecond day boundaries',()=>{
  const points=parse(['2040-01-31T23:59:59.999999999Z','2040-02-01T00:00:00Z']);
  expect(observationDay(points[0]!,'UTC')).toBe('2040-01-31');
  expect(observationDay(points[0]!,'Asia/Seoul')).toBe('2040-02-01');
  expect(summarizeImportDays(points,'Asia/Seoul').days).toEqual(['2040-02-01']);
});
it('selects inclusive calendar days without mutating values, IDs or source order',()=>{
  const points=parse(['2040-01-01T00:00:00Z','2040-02-01T00:00:00Z','2040-02-01T23:59:59.999999999Z','2040-02-02T00:00:00Z']);
  const before=JSON.stringify(points), selected=selectImportDays(points,'UTC','2040-02-01','2040-02-02');
  expect(selected.points).toEqual(points.slice(1));
  expect(selected.points[0]).toBe(points[1]);
  expect([...selected.dayBreaks]).toEqual([points[3]!.id]);
  expect(JSON.stringify(points)).toBe(before);
});
it('handles a single day, empty range and invalid calendar dates without fabricated points',()=>{
  const points=parse(['2040-02-29T00:00:00Z']);
  expect(selectImportDays(points,'UTC','2040-02-29','2040-02-29').points).toHaveLength(1);
  for(const range of [['2040-02-30','2040-03-01'],['2040-03-01','2040-02-29'],['2040-01-01','2040-01-02']]) expect(selectImportDays(points,'UTC',range[0]!,range[1]!).points).toHaveLength(0);
  expect(summarizeImportDays([],'UTC').first).toBe(null);
});
