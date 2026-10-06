import { BufferGeometry, Float32BufferAttribute, Group, LineBasicMaterial, LineDashedMaterial, LineSegments, Points, PointsMaterial, Vector3 } from 'three';
import type { Coordinate, Observation } from '../../domain/timeline';
import type { Connection } from './analysis';

// Points and line endpoints must share a radius to avoid parallax while orbiting.
const TRACE_RADIUS = 100.4;

export function globeVector(c: Coordinate): Vector3 {
  const lat = c.latitude * Math.PI / 180, lng = c.longitude * Math.PI / 180;
  return new Vector3(Math.cos(lat) * Math.sin(lng), Math.sin(lat), Math.cos(lat) * Math.cos(lng));
}
/** Spherical display interpolation only; no road prediction. */
export function arcVertices(a: Coordinate, b: Coordinate): Vector3[] {
  const start = globeVector(a), end = globeVector(b);
  const angle = Math.acos(Math.min(1, Math.max(-1, start.dot(end))));
  const steps = Math.max(1, Math.ceil(angle / (2 * Math.PI / 180)));
  const axis = new Vector3().crossVectors(start, end);
  if (axis.lengthSq() < 1e-16) axis.crossVectors(start, Math.abs(start.y) < .9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0));
  axis.normalize();
  return Array.from({ length: steps + 1 }, (_, i) => i === steps ? end.clone().multiplyScalar(TRACE_RADIUS) : start.clone().applyAxisAngle(axis, angle * i / steps).multiplyScalar(TRACE_RADIUS));
}
export function buildPreviewObjects(points: readonly Observation[], connections: readonly Connection[], differentiated: boolean, thresholdSeconds: number) {
  const positions: number[][] = [[], []];
  let vertices = 0;
  for (const link of connections) {
    const arc = arcVertices(link.from.coordinate, link.to.coordinate);
    vertices += (arc.length - 1) * 2;
    if (vertices > 2000000) throw new Error('DISPLAY_LIMIT');
    const target = positions[differentiated && link.seconds > thresholdSeconds ? 1 : 0]!;
    for (let i = 1; i < arc.length; i++) target.push(...arc[i - 1]!.toArray(), ...arc[i]!.toArray());
  }
  const group = new Group();
  const geometries: BufferGeometry[] = [], materials: (LineBasicMaterial | LineDashedMaterial | PointsMaterial)[] = [];
  positions.forEach((values, i) => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(values, 3));
    const material = i === 0 ? new LineBasicMaterial({ color: '#69e6d0' }) : new LineDashedMaterial({ color: '#ffc07b', dashSize: .8, gapSize: .45 });
    const lines = new LineSegments(geometry, material);
    lines.computeLineDistances();
    group.add(lines); geometries.push(geometry); materials.push(material);
  });
  const dots = new BufferGeometry();
  dots.setAttribute('position', new Float32BufferAttribute(points.flatMap(p => globeVector(p.coordinate).multiplyScalar(TRACE_RADIUS).toArray()), 3));
  // Screen-sized circles keep dense observations readable when zooming in.
  const dotMaterial = new PointsMaterial({ color: '#ecfff9', size: 3, sizeAttenuation: false });
  dotMaterial.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('void main() {', `void main() {
      if (distance(gl_PointCoord, vec2(0.5)) > 0.5) discard;
    `);
  };
  group.add(new Points(dots, dotMaterial)); geometries.push(dots); materials.push(dotMaterial);
  return { group, dispose: () => { geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); } };
}
