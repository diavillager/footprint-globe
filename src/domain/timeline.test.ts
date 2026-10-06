import { describe, expect, it } from 'vitest';
import { createSyntheticManualVisits, createSyntheticTimeline, syntheticParser } from '../fixtures/timeline';

describe('parallel-development fixture contract', () => {
  it('keeps return visits separate even at identical coordinates', () => {
    const data = createSyntheticTimeline();
    const visits = createSyntheticManualVisits();
    expect(new Set(visits.map(v => v.id)).size).toBe(2);
    const targets = visits.map(v => data.observations.find(o => o.id === v.observationId));
    expect(targets.every(Boolean)).toBe(true);
    expect(targets[0]?.coordinate).toEqual(targets[1]?.coordinate);
    expect(targets[0]?.time.epochMs).not.toEqual(targets[1]?.time.epochMs);
    expect(visits.every(v => v.datasetId === data.datasetId)).toBe(true);
  });
  it('retains valid zero coordinates and a long gap without fabricating paths or visits', () => {
    const data = createSyntheticTimeline();
    expect(data.observations[0]?.coordinate).toEqual({ latitude: 0, longitude: 0 });
    for (const point of data.observations) {
      expect(Math.abs(point.coordinate.latitude)).toBeLessThanOrEqual(90);
      expect(Math.abs(point.coordinate.longitude)).toBeLessThanOrEqual(180);
      expect(point.time.epochMs).toBe(Date.parse(point.time.sourceText));
    }
    expect(data.recordedPaths).toEqual([]);
    expect(data.recordedVisits).toEqual([]);
  });
  it('lets UI consume the async parser boundary with a fresh fixture per dataset', async () => {
    const a = await syntheticParser('', 'dataset:a');
    const b = await syntheticParser('', 'dataset:b');
    expect(a.ok && a.data.datasetId).toBe('dataset:a');
    expect(b.ok && b.data.datasetId).toBe('dataset:b');
    expect(a.ok && b.ok && a.data.observations === b.data.observations).toBe(false);
  });
});
