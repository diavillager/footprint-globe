import { describe, expect, it } from 'vitest';
import { parseTimeline, PREVIEW_LIMITS } from './index';

// Entirely authored inputs; no personal export or derived sample is read.
const stamp = '2040-01-01T00:00:00Z';
const position = (coordinate: unknown = '0,0', timestamp: unknown = stamp) => ({ position: { LatLng: coordinate, timestamp } });
const parse = (rawSignals: unknown[], extra = {}) => parseTimeline(JSON.stringify({ rawSignals, ...extra }), 'dataset:test');

describe('rawSignals public parser boundary', () => {
  it.each([null, [], {}, { rawSignals: null }, { rawSignals: {} }, { locations: [] },
    { rawSignals: [], semanticSegments: null }, { rawSignals: [], timelineObjects: [] },
  ])('rejects unsupported or mixed roots without partial counts: %j', async root => {
    expect(await parseTimeline(JSON.stringify(root), 'dataset:test')).toEqual({ ok: false, code: 'UNSUPPORTED_FORMAT' });
  });

  it('accepts a leading BOM and reports empty and all-excluded inputs accurately', async () => {
    expect((await parseTimeline('\uFEFF' + JSON.stringify({ rawSignals: [position()] }), 'dataset:test')).ok).toBe(true);
    expect(await parse([])).toEqual({ ok: false, code: 'NO_VALID_POSITIONS', counts: {
      input: 0, accepted: 0, ignoredSignals: 0, invalidPositions: 0, ignoredRootFields: 0,
    } });
    expect(await parse([null, [], 0, {}, { wifiScan: {} }, { position: null }, { position: [] }, position(null)])).toEqual({
      ok: false, code: 'NO_VALID_POSITIONS', counts: {
        input: 8, accepted: 0, ignoredSignals: 5, invalidPositions: 3, ignoredRootFields: 0,
      },
    });
  });

  it.each([
    ['0,0', 0, 0], ['-90,-180', -90, -180], ['+90°, +180°', 90, 180],
    ['geo:-12.123456789,34.987654321', -12.123456789, 34.987654321],
  ])('preserves supported coordinate boundaries: %s', async (value, latitude, longitude) => {
    const result = await parse([position(value)]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('synthetic fixture failed');
    expect(result.data.observations[0]!.coordinate).toEqual({ latitude, longitude });
  });

  it('rejects invalid coordinate types, units and ambiguous keys while preserving accounting', async () => {
    const invalid = [null, 0, [0, 0], { latitudeE7: 0, longitudeE7: 0 }, '', '90.000000001,0', '0,-180.000000001',
      '125,35', '350000000,1250000000', '1e1,0', 'NaN,0', 'Infinity,0', '0°,0', 'geo:0°,0°', '0.1234567890,0'];
    const signals = [...invalid.map(value => position(value)), { position: { timestamp: stamp } },
      { position: { LatLng: '0,0', latLng: '0,0', timestamp: stamp } },
      { position: { latLng: 'geo:0,0', timestamp: stamp } }, { activityRecord: {} }];
    const result = await parse(signals, { extra: 'SYNTHETIC_PRIVATE_CANARY' });
    expect(result.counts).toEqual({ input: signals.length, accepted: 1, invalidPositions: invalid.length + 2, ignoredSignals: 1, ignoredRootFields: 1 });
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC_PRIVATE_CANARY');
  });

  it.each(['2000-02-29T12:00:00Z', '2040-02-29T00:00:00+14:00', '2040-01-01T00:00:00-14:00',
    '1969-12-31T23:59:59.999Z', '2040-01-01T00:00:00.001Z', '2040-01-01T00:00:00.123+09:30',
    '0001-01-01T00:00:00.007Z', '2200-01-01T00:00:00.008Z', '9999-01-01T00:00:00.001Z',
  ])('preserves exact millisecond instants: %s', async timestamp => {
    const result = await parse([position('0,0', timestamp)]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('synthetic fixture failed');
    expect(result.data.observations[0]!.time).toEqual({ sourceText: timestamp, epochMs: Date.parse(timestamp) });
  });

  it('excludes invalid calendar dates, offsets, precision and timestamp types', async () => {
    const invalid = [null, 0, {}, '', '1900-02-29T00:00:00Z', '2041-02-29T00:00:00Z',
      '2040-04-31T00:00:00Z', '2040-00-01T00:00:00Z', '2040-13-01T00:00:00Z', '2040-01-00T00:00:00Z',
      '2040-01-01T24:00:00Z', '2040-01-01T00:60:00Z', '2040-01-01T00:00:60Z',
      '2040-01-01T00:00:00+15:00', '2040-01-01T00:00:00-14:01', '2040-01-01T00:00:00+00:60',
      '2040-01-01T00:00:00', '2040-01-01', '2040-01-01T00:00:00.1234567890Z'];
    const result = await parse(invalid.map(value => position('0,0', value)));
    expect(result).toEqual({ ok: false, code: 'NO_VALID_POSITIONS', counts: {
      input: invalid.length, accepted: 0, invalidPositions: invalid.length, ignoredSignals: 0, ignoredRootFields: 0,
    } });
  });

  it('keeps nanosecond ordering, equivalent-instant source order and repeat identity across datasets', async () => {
    const times = ['2040-01-03T00:00:00Z', '2040-01-01T09:00:00.000000002+09:00',
      '2040-01-01T00:00:00.000000001Z', '2039-12-31T19:00:00.000000001-05:00'];
    const text = JSON.stringify({ rawSignals: times.map(t => position('0,0', t)) });
    const result = await parseTimeline(text, 'dataset:one');
    const other = await parseTimeline(text, 'dataset:two');
    if (!result.ok || !other.ok) throw new Error('synthetic fixture failed');
    expect(result.data.observations.map(o => o.time.sourceText)).toEqual([times[2], times[3], times[1], times[0]]);
    const ids = result.data.observations.map(o => o.id);
    expect(new Set(ids).size).toBe(4);
    expect(other.data.observations.every(o => !ids.includes(o.id))).toBe(true);
    expect(await parseTimeline(text, 'dataset:one')).toEqual(result);
    expect(result.data.recordedVisits).toEqual([]);
    expect(result.data.recordedPaths).toEqual([]);
  });

  it('retains every observation at the record limit and rejects the next record', async () => {
    const signals = Array.from({ length: PREVIEW_LIMITS.records }, (_, i) => position('0,0',
      new Date(Date.UTC(2040, 0, 1) + (PREVIEW_LIMITS.records - i) * 1000).toISOString()));
    const result = await parse(signals);
    if (!result.ok) throw new Error('synthetic fixture failed');
    expect(result.data.observations).toHaveLength(PREVIEW_LIMITS.records);
    expect(new Set(result.data.observations.map(o => o.id)).size).toBe(PREVIEW_LIMITS.records);
    expect(result.counts).toEqual({ input: PREVIEW_LIMITS.records, accepted: PREVIEW_LIMITS.records, invalidPositions: 0, ignoredSignals: 0, ignoredRootFields: 0 });
    expect(result.data.observations[0]!.time.epochMs).toBe(Date.UTC(2040, 0, 1) + 1000);
    expect(result.data.observations.at(-1)!.time.epochMs).toBe(Date.UTC(2040, 0, 1) + PREVIEW_LIMITS.records * 1000);
    signals.push(position());
    expect(await parse(signals)).toEqual({ ok: false, code: 'INPUT_LIMIT' });
  });

  it('enforces the UTF-8 byte limit including multibyte metadata at the exact boundary', async () => {
    const json = JSON.stringify({ rawSignals: [position()], extra: '가😀' });
    const exact = json + ' '.repeat(PREVIEW_LIMITS.bytes - new TextEncoder().encode(json).length);
    const result = await parseTimeline(exact, 'dataset:bytes');
    expect(result.ok).toBe(true);
    expect(result.counts?.accepted).toBe(1);
    expect(await parseTimeline(exact + ' ', 'dataset:bytes')).toEqual({ ok: false, code: 'INPUT_LIMIT' });
  });
});
