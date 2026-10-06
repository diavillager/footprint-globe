import type { Coordinate, Observation } from '../../domain/timeline';

export interface Connection { from: Observation; to: Observation; seconds: number; km: number }
const radians = (n: number) => n * Math.PI / 180;
/** Great-circle separation, not travelled road distance. */
export function separationKm(a: Coordinate, b: Coordinate): number {
  const lat = radians(b.latitude - a.latitude), lng = radians(b.longitude - a.longitude);
  const h = Math.sin(lat / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(lng / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}
export function connectAll(points: readonly Observation[]): Connection[] {
  return points.slice(1).map((to, i) => {
    const from = points[i]!;
    return { from, to, seconds: Math.max(0, (to.time.epochMs - from.time.epochMs) / 1000), km: separationKm(from.coordinate, to.coordinate) };
  });
}
export function distribution(values: readonly number[], edges: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const quantile = (p: number) => sorted.length ? sorted[Math.ceil((sorted.length - 1) * p)]! : null;
  const bins = Array<number>(edges.length + 1).fill(0);
  for (const value of sorted) {
    const index = edges.findIndex(edge => value <= edge);
    bins[index < 0 ? edges.length : index]!++;
  }
  return { count: sorted.length, median: quantile(.5), p90: quantile(.9), max: quantile(1), bins };
}
