import type { FeatureCollection, Point, LineString } from 'geojson';
import type { PlaceSummary } from '../landmarks/placeSummary';
import { connectAll } from './analysis';
import type { Observation, ObservationId } from '../../domain/timeline';
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

export function summaryLines(summary: PlaceSummary, selected: ObservationId | null) {
  const data = mapConnections(summary.edges.map(edge => connectAll([edge.from.point,edge.to.point])[0]!),false,0);
  data.features.forEach((feature,index) => {
    const edge = summary.edges[index]!;
    feature.properties = {summary:true, edgeKey:edge.key, count:edge.transitions.length,
      highlighted:selected !== null && edge.transitions.some(pair => pair.from === selected || pair.to === selected)};
  });
  return data;
}

/** Inferred gap geometry is independent of recorded/summary edges and mapping input. */
export function gapLines(connections: readonly Connection[], summary: PlaceSummary | null, selected: ObservationId | null) {
  const anchors = new Map<ObservationId, { point: Observation; selected: boolean }>();
  for (const node of summary ? [...summary.nodes, ...summary.waypoints] : []) {
    for (const group of node.groups) for (const id of group.sourceObservationIds) {
      anchors.set(id, { point: node.point, selected: group.representative.id === selected });
    }
  }
  const projected = connections.flatMap(link => {
    const from = anchors.get(link.from.id), to = anchors.get(link.to.id);
    if (summary && (!from || !to || from.point.id === to.point.id)) return [];
    return [{ ...link, from: from?.point ?? link.from, to: to?.point ?? link.to,
      highlighted: Boolean(summary && (from?.selected || to?.selected)) }];
  });
  const data = mapConnections(projected, true, 0);
  data.features.forEach((feature, index) => {
    feature.properties = { gap: true, highlighted: projected[index]!.highlighted };
  });
  return data;
}
