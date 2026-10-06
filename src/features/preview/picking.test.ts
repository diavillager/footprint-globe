import { expect, it } from 'vitest';
import { PerspectiveCamera } from 'three';
import type { Observation } from '../../domain/timeline';
import { pickObservations } from './picking';

it('returns every overlapping ID in parser order while excluding the far hemisphere and offscreen points', () => {
  const camera = new PerspectiveCamera(50, 1, .1, 1000);
  camera.position.set(0, 0, 270); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const points: Observation[] = [0, 180, 0, 30].map((longitude, i) => ({
    id: `observation:${i}`, coordinate: { latitude: 0, longitude }, time: { epochMs: i, sourceText: '' },
  }));
  expect(pickObservations(points, camera, 560, 560, 280, 280).map(p => p.id)).toEqual(['observation:0', 'observation:2']);
  expect(pickObservations(points, camera, 560, 560, 0, 0)).toEqual([]);
  expect(points).toHaveLength(4);
});
