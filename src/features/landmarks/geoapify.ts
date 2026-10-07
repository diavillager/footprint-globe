import type { Coordinate } from '../../domain/timeline';
import { separationKm } from '../preview/analysis';

export const SEARCH_POLICY = { radiusMeters: 300, limit: 10, categories: ['tourism.attraction', 'tourism.sights', 'entertainment.museum'] } as const;
export type LandmarkError = 'CONFIGURATION' | 'AUTH' | 'RATE_LIMIT' | 'NETWORK' | 'TIMEOUT' | 'RESPONSE_INVALID' | 'PROVIDER_FAILURE' | 'REQUEST_LIMIT';
export interface LandmarkCandidate {
  readonly provider: 'geoapify';
  readonly providerPlaceId: string;
  readonly name: string;
  readonly coordinate: Coordinate;
  readonly categories: readonly string[];
  readonly distanceMeters: number;
  readonly attribution: string;
}
export class LandmarkFailure extends Error {
  constructor(readonly code: LandmarkError) { super(code); }
}
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
export const validCoordinate = (point: Coordinate) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude) && Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180;

/** Deliberately takes only a coordinate. No timestamps, file names, IDs, or full records. */
export function geoapifyUrl(point: Coordinate, key: string): URL {
  if (!key.trim()) throw new LandmarkFailure('CONFIGURATION');
  if (!validCoordinate(point)) throw new LandmarkFailure('RESPONSE_INVALID');
  const url = new URL('https://api.geoapify.com/v2/places');
  url.search = new URLSearchParams({ apiKey: key, categories: SEARCH_POLICY.categories.join(','),
    filter: `circle:${point.longitude},${point.latitude},${SEARCH_POLICY.radiusMeters}`,
    bias: `proximity:${point.longitude},${point.latitude}`, limit: String(SEARCH_POLICY.limit), lang: 'ko' }).toString();
  return url;
}

export function normalizeCandidates(body: unknown, origin: Coordinate): LandmarkCandidate[] {
  const root = record(body);
  if (!root || !Array.isArray(root.features) || !validCoordinate(origin)) throw new LandmarkFailure('RESPONSE_INVALID');
  const candidates: LandmarkCandidate[] = [];
  const seen = new Set<string>();
  for (const value of root.features.slice(0, SEARCH_POLICY.limit)) {
    const feature = record(value), properties = record(feature?.properties), geometry = record(feature?.geometry);
    if (!properties || geometry?.type !== 'Point' || !Array.isArray(geometry.coordinates)) continue;
    const [longitude, latitude] = geometry.coordinates;
    if (typeof longitude !== 'number' || typeof latitude !== 'number' || !validCoordinate({ longitude, latitude })) continue;
    const name = typeof properties.name === 'string' ? properties.name.trim().slice(0, 160) : '';
    const id = properties.place_id;
    if (!name || !/[\p{L}\p{N}]/u.test(name) || typeof id !== 'string' || !id.trim() || id.length > 2048 || seen.has(id)) continue;
    const coordinate = { longitude, latitude };
    const distanceMeters = separationKm(origin, coordinate) * 1000;
    if (distanceMeters > SEARCH_POLICY.radiusMeters) continue;
    const categories = Array.isArray(properties.categories) ? properties.categories.filter((item): item is string => typeof item === 'string' && item.length <= 120).slice(0, 20) : [];
    seen.add(id);
    candidates.push({ provider: 'geoapify', providerPlaceId: id, name, coordinate, categories,
      distanceMeters, attribution: 'Powered by Geoapify · © OpenStreetMap contributors' });
  }
  return candidates.sort((a, b) => a.distanceMeters - b.distanceMeters);
}

export async function fetchCandidates(point: Coordinate, key: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<LandmarkCandidate[]> {
  const url = geoapifyUrl(point, key);
  let response: Response;
  try {
    response = await fetcher(url, { signal, credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'strict-origin' });
  } catch { throw new LandmarkFailure('NETWORK'); }
  if (response.status === 401 || response.status === 403) throw new LandmarkFailure('AUTH');
  if (response.status === 429) throw new LandmarkFailure('RATE_LIMIT');
  if (!response.ok) throw new LandmarkFailure('PROVIDER_FAILURE');
  let body: unknown;
  try { body = await response.json(); } catch { throw new LandmarkFailure('RESPONSE_INVALID'); }
  return normalizeCandidates(body, point);
}
