import type { FeatureCollection, Point, LineString } from 'geojson';
import type { Observation } from '../../domain/timeline';
import type { Connection } from './analysis';
import { arcVertices } from './geometry';

export function mapPoints(points: readonly Observation[]): FeatureCollection<Point> {
  return { type: 'FeatureCollection', features: points.map((point, index) => ({
    type: 'Feature', id: index, properties: { observationId: point.id },
    geometry: { type: 'Point', coordinates: [point.coordinate.longitude, point.coordinate.latitude] },
  })) };
}

/** Display-only great-circle geometry. Unwrap longitude to cross the dateline locally. */
export function mapConnections(connections: readonly Connection[], differentiated: boolean, threshold: number): FeatureCollection<LineString> {
  let vertices = 0;
  return { type: 'FeatureCollection', features: connections.map(link => {
    const coordinates = arcVertices(link.from.coordinate, link.to.coordinate).map(vector => {
      vector.normalize();
      return [Math.atan2(vector.x, vector.z) * 180 / Math.PI, Math.asin(Math.max(-1, Math.min(1, vector.y))) * 180 / Math.PI];
    });
    vertices += coordinates.length;
    if (vertices > 2000000) throw new Error('DISPLAY_LIMIT');
    for (let i = 1; i < coordinates.length; i++) {
      const current = coordinates[i]!, previous = coordinates[i - 1]!;
      while (current[0]! - previous[0]! > 180) current[0]! -= 360;
      while (current[0]! - previous[0]! < -180) current[0]! += 360;
    }
    return { type: 'Feature', properties: { gap: differentiated && link.seconds > threshold }, geometry: { type: 'LineString', coordinates } };
  }) };
}
