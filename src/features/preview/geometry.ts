import { BufferGeometry, Float32BufferAttribute, Group, LineBasicMaterial, LineDashedMaterial, LineSegments, PerspectiveCamera, Points, PointsMaterial, Vector2, Vector3 } from 'three';
import type { Coordinate, Observation } from '../../domain/timeline';
import type { Connection } from './analysis';

// Points and line endpoints must share a radius to avoid parallax while orbiting.
export const TRACE_RADIUS = 100.4;
// Altitude is measured from the globe, not from the elevated observation layer.
export const TRACE_ALTITUDE = TRACE_RADIUS / 100 - 1;
export const MIN_ALTITUDE = TRACE_ALTITUDE + .00000003;
export const MAX_ALTITUDE = 4;
export function focusAltitude(km: number): number {
  return Math.max(MIN_ALTITUDE, Math.min(MAX_ALTITUDE, TRACE_ALTITUDE + km / 6371.0088 * 2));
}

/** Approximate world units per screen pixel on the facing trace surface. */
export function dashUnit(cameraDistance: number, verticalFov: number, height: number): number {
  return 2 * Math.max(.0000001, cameraDistance - TRACE_RADIUS) * Math.tan(verticalFov * Math.PI / 360) / Math.max(1, height);
}

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
export function buildPreviewObjects(points: readonly Observation[], connections: readonly Connection[], differentiated: boolean, thresholdSeconds: number, origin = new Vector3(), selectedPoint?: Observation) {
  const positions: number[][] = [[], []];
  let vertices = 0;
  for (const link of connections) {
    const arc = arcVertices(link.from.coordinate, link.to.coordinate);
    vertices += (arc.length - 1) * 2;
    if (vertices > 2000000) throw new Error('DISPLAY_LIMIT');
    const target = positions[differentiated && link.seconds > thresholdSeconds ? 1 : 0]!;
    for (let i = 1; i < arc.length; i++) target.push(...arc[i - 1]!.clone().sub(origin).toArray(), ...arc[i]!.clone().sub(origin).toArray());
  }
  const group = new Group();
  // Subtract in double precision before making GPU Float32 buffers. This keeps
  // metre-scale differences when a close-up is centered far from world zero.
  group.position.copy(origin);
  const geometries: BufferGeometry[] = [], materials: (LineBasicMaterial | LineDashedMaterial | PointsMaterial)[] = [];
  positions.forEach((values, i) => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(values, 3));
    const material = i === 0 ? new LineBasicMaterial({ color: '#69e6d0' }) : new LineDashedMaterial({ color: '#ffc07b', dashSize: .8, gapSize: .45 });
    const lines = new LineSegments(geometry, material);
    lines.computeLineDistances();
    if (material instanceof LineDashedMaterial) {
      const viewport = new Vector2(), cameraPosition = new Vector3(), center = new Vector3();
      lines.onBeforeRender = (renderer, _scene, camera) => {
        if (!(camera instanceof PerspectiveCamera)) return;
        renderer.getSize(viewport);
        group.parent?.getWorldPosition(center);
        const unit = dashUnit(camera.getWorldPosition(cameraPosition).distanceTo(center), camera.getEffectiveFOV(), viewport.y);
        material.dashSize = unit * 6;
        material.gapSize = unit * 4;
      };
    }
    group.add(lines); geometries.push(geometry); materials.push(material);
  });
  const dots = new BufferGeometry();
  dots.setAttribute('position', new Float32BufferAttribute(points.flatMap(p => globeVector(p.coordinate).multiplyScalar(TRACE_RADIUS).sub(origin).toArray()), 3));
  // Screen-sized circles keep dense observations readable when zooming in.
  const dotMaterial = new PointsMaterial({ color: '#ecfff9', size: 3, sizeAttenuation: false });
  dotMaterial.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('void main() {', `void main() {
      if (distance(gl_PointCoord, vec2(0.5)) > 0.5) discard;
    `);
  };
  group.add(new Points(dots, dotMaterial)); geometries.push(dots); materials.push(dotMaterial);
  if (selectedPoint && points.some(point => point.id === selectedPoint.id)) {
    const highlight = new BufferGeometry();
    highlight.setAttribute('position', new Float32BufferAttribute(globeVector(selectedPoint.coordinate).multiplyScalar(TRACE_RADIUS).sub(origin).toArray(), 3));
    const highlightMaterial = new PointsMaterial({ color: '#ffdf59', size: 9, sizeAttenuation: false });
    highlightMaterial.onBeforeCompile = dotMaterial.onBeforeCompile;
    group.add(new Points(highlight, highlightMaterial)); geometries.push(highlight); materials.push(highlightMaterial);
  }
  return { group, dispose: () => { geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); } };
}
