import { describe, expect, it } from 'vitest';
import { areas, buildTrip, distance, trips } from './travel';
import { parseTimeline } from '../parser';

describe('authored travel demos', () => {
  it.each(trips)('$id: dates, offsets, ordering, bounded speed and real parser compatibility', async trip => {
    const { timeline, itinerary } = buildTrip(trip.id);
    expect(buildTrip(trip.id).timeline).toEqual(timeline);
    expect(timeline.rawSignals.length).toBeGreaterThan(1000);
    expect(timeline.rawSignals.length).toBeLessThan(5000);
    const text = JSON.stringify(timeline);
    expect(new TextEncoder().encode(text).length).toBeLessThan(1024 * 1024);
    const parsed = await parseTimeline(text, `dataset:synthetic-${trip.id}`);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('SYNTHETIC_PARSE_FAILED');
    expect(parsed.counts.accepted).toBe(timeline.rawSignals.length);
    expect(parsed.counts.invalidPositions).toBe(0);
    expect(parsed.data.recordedVisits).toEqual([]);
    expect(parsed.data.recordedPaths).toEqual([]);
    expect(itinerary[0]!.date).toBe(trip.start);
    expect(itinerary.at(-1)!.date).toBe(trip.end);
    expect(new Set(timeline.rawSignals.map(r => r.position.timestamp.slice(0, 10))).size).toBe(itinerary.length);
    const points = parsed.data.observations;
    for (let i = 0; i < points.length; i++) {
      expect(timeline.rawSignals[i]!.position.timestamp.endsWith(trip.offset)).toBe(true);
      if (!i) continue;
      const a = points[i - 1]!, b = points[i]!;
      const seconds = (b.time.epochMs - a.time.epochMs) / 1000;
      expect(seconds).toBeGreaterThan(0);
      const speed = distance([a.coordinate.latitude, a.coordinate.longitude], [b.coordinate.latitude, b.coordinate.longitude]) / seconds * 3.6;
      expect(speed).toBeLessThan(200);
    }
  });

  it('France ends exactly where and when the Italy transfer begins', () => {
    const france = buildTrip('france').timeline.rawSignals.at(-1);
    const italy = buildTrip('italy').timeline.rawSignals[0];
    expect(france).toEqual(italy);
    expect(italy!.position.timestamp).toBe('2024-08-06T08:00:00+02:00');
  });

  it('intercity windows include the planned durations and arrival cities', () => {
    const cases = [
      ['austria', '2023-08-08', 'vienna-salzburg', 180, areas.salzburg[0]],
      ['austria', '2023-08-08', 'salzburg-vienna', 180, areas.vienna[0]],
      ['france', '2024-08-03', 'annecy-chamonix', 160, areas.chamonix[0]],
      ['italy', '2024-08-06', 'chamonix-bolzano', 510, areas.bolzano[0]],
      ['italy', '2024-08-13', 'bolzano-milan', 240, areas.milan[0]],
      ['japan', '2025-10-24', 'fukuoka-saga', 60, areas.saga[0]],
      ['japan', '2025-10-25', 'fukuoka-kumamoto', 75, areas.kumamoto[0]],
      ['japan', '2025-10-28', 'kumamoto-fukuoka', 75, areas.fukuoka[0]],
    ] as const;
    for (const [id, date, prefix, duration, arrival] of cases) {
      const events = buildTrip(id).itinerary.find(day => day.date === date)!.events.filter(e => e.label === `${prefix}:fictional-transfer`);
      expect(events.at(-1)!.minute - events[0]!.minute).toBeCloseTo(duration, 5);
      expect(events.at(-1)!.coordinate).toEqual(arrival);
    }
  });

  it('contains stationary jitter, nearby separate stops, pass-through and overnight gaps', () => {
    const { timeline, itinerary } = buildTrip('austria');
    expect(itinerary[0]!.events.some(e => e.label.endsWith(':nearby-stop'))).toBe(true);
    expect(itinerary[0]!.events.some(e => e.label.endsWith(':pass-through'))).toBe(true);
    const points = timeline.rawSignals;
    const start = points[0]!.position;
    const next = points[1]!.position;
    const coord = (value: string) => value.replaceAll('°', '').split(',').map(Number) as [number, number];
    expect(distance(coord(start.LatLng), coord(next.LatLng))).toBeGreaterThan(0);
    expect(distance(coord(start.LatLng), coord(next.LatLng))).toBeLessThan(10);
    expect(points.some((r, i) => i > 0 && Date.parse(r.position.timestamp) - Date.parse(points[i - 1]!.position.timestamp) > 10 * 3600000)).toBe(true);
  });
});
