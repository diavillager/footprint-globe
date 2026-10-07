export interface ScreenPlace { index: number; x: number; y: number; selected: boolean }
export interface ScreenCluster { indices: number[]; x: number; y: number; selected: boolean; label: boolean }
export type MarkerScale = 'overview' | 'names' | 'photos';
export const markerScale = (zoom: number): MarkerScale => zoom < 11 ? 'overview' : zoom < 15 ? 'names' : 'photos';

/** Display-only grouping. Every input index remains accessible, including revisits. */
export function clusterScreenPlaces(points: readonly ScreenPlace[], zoom: number): ScreenCluster[] {
  const radius = markerScale(zoom) === 'overview' ? 64 : 42;
  const buckets = new Map<string, ScreenCluster[]>(), clusters: ScreenCluster[] = [];
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    const col = Math.floor(point.x / radius), row = Math.floor(point.y / radius);
    let nearest: ScreenCluster | undefined, distance = radius;
    if (!point.selected) for (let x = col - 1; x <= col + 1; x++) for (let y = row - 1; y <= row + 1; y++) {
      for (const cluster of buckets.get(`${x}:${y}`) ?? []) {
        const d = Math.hypot(point.x - cluster.x, point.y - cluster.y);
        if (!cluster.selected && d <= distance) { distance = d; nearest = cluster; }
      }
    }
    if (nearest) nearest.indices.push(point.index);
    else {
      const cluster = { indices: [point.index], x: point.x, y: point.y, selected: point.selected, label: false };
      clusters.push(cluster);
      const key = `${col}:${row}`, bucket = buckets.get(key) ?? []; bucket.push(cluster); buckets.set(key, bucket);
    }
  }
  // Keep all pins. Only their text labels compete for space.
  const labels: ScreenCluster[] = [];
  for (const cluster of [...clusters].sort((a,b) => Number(b.selected) - Number(a.selected))) {
    if (cluster.indices.length !== 1 || (markerScale(zoom) === 'overview' && !cluster.selected)) continue;
    cluster.label = cluster.selected || (!clusters.some(other => other !== cluster && Math.abs(other.x - cluster.x) < 118 && Math.abs(other.y - cluster.y) < 38)
      && !labels.some(other => Math.abs(other.x - cluster.x) < 190 && Math.abs(other.y - cluster.y) < 38));
    if (cluster.label) labels.push(cluster);
  }
  return clusters;
}
