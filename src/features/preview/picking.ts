import { type Camera, Vector3 } from 'three';
import type { Observation } from '../../domain/timeline';
import { globeVector, TRACE_RADIUS } from './geometry';

/** Screen-space candidates, kept in parser order; overlap never merges records. */
export function pickObservations(points: readonly Observation[], camera: Camera, width: number, height: number, x: number, y: number): Observation[] {
  const position = camera.getWorldPosition(new Vector3());
  return points.filter(point => {
    const world = globeVector(point.coordinate).multiplyScalar(TRACE_RADIUS);
    if (world.dot(position) < TRACE_RADIUS * TRACE_RADIUS) return false;
    const projected = world.project(camera);
    if (projected.z < -1 || projected.z > 1) return false;
    return Math.hypot((projected.x + 1) * width / 2 - x, (1 - projected.y) * height / 2 - y) <= 10;
  });
}
