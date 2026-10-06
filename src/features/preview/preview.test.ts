import { expect, it } from 'vitest';
import { parseRawPreview } from '../../parser/rawPreview';
import { syntheticRawPreview } from '../../fixtures/preview';
import { connectAll, distribution, separationKm } from './analysis';
import { arcVertices, buildPreviewObjects, dashUnit } from './geometry';
import { LineSegments, PerspectiveCamera, Points, Vector3 } from 'three';

it('anchors line endpoints to point centers through rotation and close zoom', () => {
  const result = parse({ rawSignals: [pos('2040-01-01T00:00:00Z', '35°, 125°'), pos('2040-01-01T00:01:00Z', '36°, 127°')] });
  if (!result.ok) throw new Error('fixture');
  for (const differentiated of [false, true]) {
    const drawing = buildPreviewObjects(result.data.observations, connectAll(result.data.observations), differentiated, 0);
    try {
      const dots = (drawing.group.children.find(child => child instanceof Points) as Points).geometry.getAttribute('position');
      const line = (drawing.group.children[differentiated ? 1 : 0] as LineSegments).geometry.getAttribute('position');
      for (const [pointIndex, lineIndex] of [[0, 0], [1, line.count - 1]]) {
        const point = new Vector3().fromBufferAttribute(dots, pointIndex!);
        const endpoint = new Vector3().fromBufferAttribute(line, lineIndex!);
        expect(endpoint.toArray()).toEqual(point.toArray());
        for (const radius of [270, 108, 101.5]) {
          for (const rotation of [-.2, 0, .2]) {
            const camera = new PerspectiveCamera(50, 2, .1, 1000);
            camera.position.copy(point).normalize().applyAxisAngle(new Vector3(0, 1, 0), rotation).multiplyScalar(radius);
            camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
            expect(endpoint.clone().project(camera).distanceTo(point.clone().project(camera))).toBeLessThan(1e-8);
          }
        }
      }
    } finally { drawing.dispose(); }
  }
});

const parse = (data: unknown) => parseRawPreview(JSON.stringify(data), 'dataset:test');
const pos = (stamp: string, coordinate = '0°, 0°') => ({ position: { LatLng: coordinate, timestamp: stamp } });
it('shrinks dash spacing with zoom and preserves 30/120-minute classification boundaries', () => {
  expect(dashUnit(101.5, 50, 560)).toBeLessThan(dashUnit(270, 50, 560) / 100);
  expect(dashUnit(108, 50, 1120)).toBeCloseTo(dashUnit(108, 50, 560) / 2);
  const result = parse({ rawSignals: [0, 30, 90, 210, 390].map(minutes => pos(new Date(Date.UTC(2040, 0, 1) + minutes * 60000).toISOString(), `0°, ${minutes / 100}°`)) });
  if (!result.ok) throw new Error('fixture');
  const links = connectAll(result.data.observations);
  for (const [threshold, expected] of [[30, 3], [120, 1]]) {
    const selected = links.filter(link => link.seconds > threshold! * 60);
    expect(selected).toHaveLength(expected!);
    const drawing = buildPreviewObjects(result.data.observations, links, true, threshold! * 60);
    const dashed = drawing.group.children[1] as LineSegments;
    expect(dashed.geometry.getAttribute('position').count).toBe(selected.reduce((sum, link) => sum + (arcVertices(link.from.coordinate, link.to.coordinate).length - 1) * 2, 0));
    drawing.dispose();
  }
});
it('retains every valid point and every adjacent link including long gaps and returns', () => {
  const result = parse(syntheticRawPreview());
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('fixture');
  const links = connectAll(result.data.observations);
  expect(links).toHaveLength(3);
  expect(links.at(-1)!.seconds).toBeGreaterThan(86400);
  expect(result.data.recordedPaths).toEqual([]);
  const vertexCounts: number[] = [];
  for (const differentiated of [false, true]) {
    const drawing = buildPreviewObjects(result.data.observations, links, differentiated, 3600);
    expect(drawing.group.children).toHaveLength(3);
    vertexCounts.push(drawing.group.children.reduce((sum, child) => sum + (child instanceof LineSegments ? child.geometry.getAttribute('position').count : 0), 0));
    drawing.dispose();
  }
  expect(vertexCounts[0]).toBeGreaterThan(0);
  expect(vertexCounts[0]).toBe(vertexCounts[1]);
});
it('orders offsets and sub-millisecond timestamps while keeping duplicate points', () => {
  const result = parse({ rawSignals: [pos('2040-01-01T09:00:00.000000002+09:00'), pos('2040-01-01T00:00:00.000000001Z'), pos('2040-01-01T00:00:00.000000001Z')] });
  if (!result.ok) throw new Error('fixture');
  expect(result.data.observations).toHaveLength(3);
  expect(result.data.observations[0]!.time.sourceText).toContain('000000001');
  expect(result.data.observations[2]!.time.sourceText).toContain('000000002');
  expect(new Set(result.data.observations.map(o => o.id)).size).toBe(3);
  expect(connectAll(result.data.observations)).toHaveLength(2);
});
it('drops unsafe values but never copies metadata or excludes safe positions due to unrelated fields', () => {
  const root = { rawSignals: [
    { ...pos('2040-01-01T00:00:00Z'), SECRET: 'CANARY', wifiScan: { mac: 'CANARY' } },
    pos('2040-02-30T00:00:00Z'), pos('2040-01-01T00:00:00Z', '91°, 0°'),
    { position: { LatLng: '0°, 0°', latLng: '0°, 0°', timestamp: '2040-01-01T00:00:00Z' } },
    { wifiScan: { mac: 'CANARY' } },
  ], SECRET: { name: 'CANARY' } };
  const result = parse(root);
  expect(result.ok).toBe(true);
  expect(result.counts).toMatchObject({ accepted: 1, invalidPositions: 3, ignoredSignals: 1, ignoredRootFields: 1 });
  expect(JSON.stringify(result)).not.toMatch(/SECRET|CANARY|wifiScan/);
});
it('fails with fixed codes for malformed, unsupported, empty and oversized records', () => {
  expect(parseRawPreview('{"CANARY', 'dataset:test')).toEqual({ ok: false, code: 'INVALID_JSON' });
  expect(parse({ semanticSegments: [], rawSignals: [] })).toEqual({ ok: false, code: 'UNSUPPORTED_FORMAT' });
  expect(parse({ rawSignals: [] })).toMatchObject({ ok: false, code: 'NO_VALID_POSITIONS' });
  expect(parse({ rawSignals: Array(100001).fill(null) })).toEqual({ ok: false, code: 'INPUT_LIMIT' });
});
it('handles raw coordinate spelling and rejects out-of-range timezones or dates', () => {
  const result = parse({ rawSignals: [
    { position: { latLng: 'geo:0,180', timestamp: '2040-01-01T00:00:00Z' } },
    pos('2040-01-01T00:00:00+14:01'), pos('2040-01-01T24:00:00Z'), pos('2040-01-01T00:00:00Z', '0°, CANARY'),
  ] });
  expect(result.counts).toMatchObject({ accepted: 1, invalidPositions: 3 });
});
it('computes known great-circle distances and bins without mutating input', () => {
  expect(separationKm({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 })).toBeCloseTo(111.195, 2);
  expect(separationKm({ latitude: 0, longitude: 179 }, { latitude: 0, longitude: -179 })).toBeCloseTo(222.39, 2);
  const values = [10, 0, 1, 2];
  expect(distribution(values, [1, 5]).bins).toEqual([2, 1, 1]);
  expect(distribution(values, [1, 5]).median).toBe(1.5);
  expect(values).toEqual([10, 0, 1, 2]);
  expect(distribution([], [1]).median).toBeNull();
});
it('keeps dateline and antipodal display arcs finite and outside the globe', () => {
  for (const pair of [[179, -179], [0, 180], [0, 0]]) {
    const arc = arcVertices({ latitude: 0, longitude: pair[0]! }, { latitude: 0, longitude: pair[1]! });
    expect(arc.every(v => Number.isFinite(v.length()) && Math.abs(v.length() - 100.4) < .001)).toBe(true);
    if (pair[0] === 179) expect(arc.length).toBeLessThan(5);
  }
});
it('supports a representative large raw trace without sampling', () => {
  const root = { rawSignals: Array.from({ length: 10123 }, (_, i) => pos(new Date(Date.UTC(2040, 0, 1) + i * 60000).toISOString(), `0°, ${(i % 10) / 100}°`)) };
  const result = parse(root);
  if (!result.ok) throw new Error('fixture');
  expect(result.data.observations).toHaveLength(10123);
  expect(connectAll(result.data.observations)).toHaveLength(10122);
});
