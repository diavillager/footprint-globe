import type { Coordinate, Observation } from '../../domain/timeline';
import { separationKm } from '../preview/analysis';
import { REGION_PAGE_SIZE, SEARCH_POLICY, type LandmarkPlace, type LandmarkCandidate, type LandmarkError, type RegionBounds, type RegionPage } from './geoapify';

const STEP = .02, ROWS = 9000, RAD = Math.PI / 180;
const columns = (row: number) => Math.max(1, Math.ceil(360 * Math.cos((-90 + (row + .5) * STEP) * RAD) / STEP));
const rowOf = (lat: number) => Math.max(0, Math.min(ROWS - 1, Math.floor((lat + 90) / STEP)));
const lonOf = (lon: number) => ((lon + 180) % 360 + 360) % 360 - 180;
export interface RegionCell { id: string; bounds: RegionBounds }
/** Spherical-cap bounding coverage, including poles and both sides of the date line. */
export function nearbyCells(point: Coordinate): RegionCell[] {
  const angle = SEARCH_POLICY.radiusMeters / 6371008.8;
  const deltaLat = angle / RAD;
  const south = Math.max(-90, point.latitude - deltaLat), north = Math.min(90, point.latitude + deltaLat);
  const deltaLon = south <= -90 || north >= 90 ? 180 : Math.asin(Math.min(1, Math.sin(angle) / Math.cos(point.latitude * RAD))) / RAD;
  const lon = lonOf(point.longitude), west = lon - deltaLon, east = lon + deltaLon;
  const ranges = deltaLon >= 180 ? [[-180, 180]] : west < -180 ? [[west + 360, 180], [-180, east]]
    : east >= 180 ? [[west, 180], [-180, east - 360]] : [[west, east]];
  const cells = new Map<string, RegionCell>();
  for (let row = rowOf(south); row <= rowOf(north); row++) {
    const count = columns(row), width = 360 / count;
    for (const [left, right] of ranges) {
      const first = Math.max(0, Math.min(count - 1, Math.floor((left! + 180) / width)));
      const last = Math.max(0, Math.min(count - 1, Math.floor((right! + 180) / width)));
      for (let col = first; col <= last; col++) {
        const id = `${row}:${col}`;
        cells.set(id, {id, bounds:{west:-180 + col * width, east:Math.min(180, -180 + (col + 1) * width),
          south:-90 + row * STEP, north:Math.min(90, -90 + (row + 1) * STEP)}});
      }
    }
  }
  return [...cells.values()];
}
type RegionStatus = 'idle' | 'loading' | 'success' | 'error' | 'cancelled';
interface Root extends RegionCell { status: RegionStatus; pending: number; error: LandmarkError | null }
export interface RegionTask { id: string; root: string; bounds: RegionBounds; offset: number; depth: number }
/** Paging is bounded per rectangle, not per file. Saturated leaves are explicitly incomplete. */
export class RegionPlan {
  readonly roots = new Map<string, Root>();
  readonly places = new Map<string, LandmarkPlace>();
  private buckets = new Map<string, Map<string, LandmarkPlace>>();
  private queue: RegionTask[] = [];
  private cursor = 0;
  constructor(points: readonly Observation[]) {
    const coordinates = new Set<string>();
    for (const point of points) {
      const key = `${point.coordinate.latitude},${point.coordinate.longitude}`;
      if (coordinates.has(key)) continue;
      coordinates.add(key);
      for (const cell of nearbyCells(point.coordinate)) if (!this.roots.has(cell.id)) {
        this.roots.set(cell.id, {...cell, status:'idle', pending:0, error:null});
        this.enqueue(cell.id, cell.bounds, 0, 0);
      }
    }
  }
  private enqueue(root: string, bounds: RegionBounds, offset: number, depth: number) {
    this.roots.get(root)!.pending++;
    this.queue.push({id:`${root}:${this.queue.length}`, root, bounds, offset, depth});
  }
  next(): RegionTask | undefined {
    const task = this.queue[this.cursor++];
    if (!task) { this.cursor--; return undefined; }
    this.roots.get(task.root)!.status = 'loading';
    return task;
  }
  get finished() { return [...this.roots.values()].every(root => root.pending === 0); }
  summary() {
    const roots = [...this.roots.values()];
    return { total: roots.length, processed: roots.filter(root => root.pending === 0).length,
      failed: roots.filter(root => root.status === 'error').length, places:this.places.size };
  }
  private settle(task: RegionTask) {
    const root = this.roots.get(task.root)!;
    root.pending--;
    if (root.pending === 0) root.status = root.error ? 'error' : 'success';
  }
  accept(task: RegionTask, page: RegionPage) {
    const bucket = this.buckets.get(task.root) ?? new Map<string, LandmarkPlace>();
    this.buckets.set(task.root, bucket);
    for (const place of page.places) { bucket.set(place.providerPlaceId, place); this.places.set(place.providerPlaceId, place); }
    if (page.rawCount === REGION_PAGE_SIZE) {
      if (task.offset === 0) this.enqueue(task.root, task.bounds, REGION_PAGE_SIZE, task.depth);
      else if (task.depth < 3) {
        const {west,south,east,north} = task.bounds, midX = (west + east) / 2, midY = (south + north) / 2;
        for (const [w,e] of [[west,midX],[midX,east]]) for (const [s,n] of [[south,midY],[midY,north]]) this.enqueue(task.root, {west:w!,east:e!,south:s!,north:n!}, 0, task.depth + 1);
      } else this.roots.get(task.root)!.error = 'SEARCH_INCOMPLETE';
    }
    this.settle(task);
  }
  fail(task: RegionTask, code: LandmarkError) { this.roots.get(task.root)!.error = code; this.settle(task); }
  cancel(task: RegionTask) { this.roots.get(task.root)!.status = 'cancelled'; }
  candidates(point: Coordinate): {candidates: LandmarkCandidate[]; error: LandmarkError | null} {
    const nearby = new Map<string, LandmarkPlace>();
    for (const cell of nearbyCells(point)) {
      const root = this.roots.get(cell.id);
      if (!root || root.status !== 'success') return {candidates:[], error:root?.error ?? 'SEARCH_INCOMPLETE'};
      for (const place of this.buckets.get(cell.id)?.values() ?? []) nearby.set(place.providerPlaceId, place);
    }
    const candidates = [...nearby.values()].map(place => ({...place, distanceMeters:separationKm(point, place.coordinate) * 1000}))
      .filter(place => place.distanceMeters <= SEARCH_POLICY.radiusMeters)
      .sort((a,b) => a.distanceMeters - b.distanceMeters || (a.providerPlaceId < b.providerPlaceId ? -1 : a.providerPlaceId > b.providerPlaceId ? 1 : 0)).slice(0, SEARCH_POLICY.limit);
    return {candidates, error:null};
  }
}
