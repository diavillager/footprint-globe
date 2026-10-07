import type { Coordinate } from '../../domain/timeline';
import { separationKm } from '../preview/analysis';

export const SEARCH_POLICY = { radiusMeters: 300, limit: 10, categories: ['tourism.attraction', 'tourism.sights', 'entertainment.museum'] } as const;
export type LandmarkError = 'CONFIGURATION' | 'AUTH' | 'RATE_LIMIT' | 'NETWORK' | 'TIMEOUT' | 'RESPONSE_INVALID' | 'PROVIDER_FAILURE' | 'SEARCH_INCOMPLETE';
export interface LandmarkCandidate {
  readonly provider: 'geoapify' | 'wikimedia';
  readonly sourceUrl?: string;
  readonly providerPlaceId: string;
  readonly name: string;
  readonly originalName?: string;
  readonly coordinate: Coordinate;
  readonly categories: readonly string[];
  readonly distanceMeters: number;
  readonly attribution: string;
}
export class LandmarkFailure extends Error {
  constructor(readonly code: LandmarkError) { super(code); }
}
export interface LandmarkImage { url: string; source: string; author?: string; license?: string }
export class ImageFailure extends Error {
  constructor(readonly code: 'UNSUPPORTED' | 'METADATA' | 'NETWORK') { super(code); }
}
export function commonsFile(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  let name = '';
  try {
    if (/^File:/i.test(value)) name = value.slice(5);
    else {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
      if (url.hostname === 'commons.wikimedia.org') {
        const match = url.pathname.match(/^\/wiki\/(?:File:|Special:FilePath\/|Special:Redirect\/file\/)(.+)$/i);
        if (match) name = decodeURIComponent(match[1]!);
      } else if (['upload.wikimedia.org', 'thumb.wikimedia.org'].includes(url.hostname)) {
        const match = url.pathname.match(/^\/wikipedia\/commons\/(?:thumb\/)?[a-f0-9]\/[a-f0-9]{2}\/([^/]+)(?:\/[^/]+)?$/i);
        if (match) name = decodeURIComponent(match[1]!);
      }
    }
  } catch { return null; }
  return name && !/[\x00-\x1f|/\\#]/.test(name) && /\.(jpe?g|png|webp|gif|tiff?)$/i.test(name) ? name.replace(/_/g, ' ') : null;
}
export function imageReference(body: unknown): { file: string | null; unsupported: boolean } {
  const features = record(body)?.features;
  if (!Array.isArray(features)) throw new LandmarkFailure('RESPONSE_INVALID');
  let unsupported = false;
  for (const feature of features) {
    const media = record(record(record(feature)?.properties)?.wiki_and_media);
    for (const value of [media?.image, media?.wikimedia_commons]) {
      const file = commonsFile(value);
      if (file) return { file, unsupported: false };
      if (typeof value === 'string' && value.trim()) unsupported = true;
    }
  }
  return { file: null, unsupported };
}
/** Direct safe media normalization; Commons file references are resolved via Imageinfo. */
export function normalizeImage(body: unknown): LandmarkImage | null {
  const ref = imageReference(body);
  if (!ref.file) return null;
  const features = record(body)!.features as unknown[];
  for (const feature of features) {
    const value = record(record(record(feature)?.properties)?.wiki_and_media)?.image;
    if (typeof value === 'string' && commonsFile(value) === ref.file) {
      try {
        const url = new URL(value);
        if (['upload.wikimedia.org', 'thumb.wikimedia.org'].includes(url.hostname) && /\.(jpe?g|png|webp|gif)$/i.test(url.pathname)) return { url: `${url.origin}${url.pathname}`, source: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(ref.file)}` };
      } catch { /* Resolved by Imageinfo below. */ }
    }
  }
  return null;
}
async function imageJson(url: URL, signal: AbortSignal, fetcher: typeof fetch, provider: boolean): Promise<unknown> {
  let response: Response;
  try { response = await fetcher(url, { signal, credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: provider ? 'strict-origin' : 'no-referrer' }); }
  catch { throw new ImageFailure('NETWORK'); }
  if (provider && (response.status === 401 || response.status === 403)) throw new LandmarkFailure('AUTH');
  if (provider && response.status === 429) throw new LandmarkFailure('RATE_LIMIT');
  if (!response.ok) throw new ImageFailure('METADATA');
  try { return await response.json(); } catch { throw new ImageFailure('METADATA'); }
}
export const plainMetadata = (value: unknown) => typeof value === 'string' ? value.replace(/<[^>]*>/g, '').replace(/&(?:nbsp|amp|quot|lt|gt);/g, ' ').trim().slice(0, 300) : '';
export async function fetchImage(id: string, key: string, signal: AbortSignal, fetcher: typeof fetch = fetch, onAdditionalRequest: () => void = () => {}): Promise<LandmarkImage | null> {
  const url = new URL('https://api.geoapify.com/v2/place-details');
  url.search = new URLSearchParams({ id, apiKey: key, features: 'details', lang: 'ko' }).toString();
  const details = await imageJson(url, signal, fetcher, true);
  const ref = imageReference(details);
  if (!ref.file) {
    const features = record(details)!.features as unknown[];
    const entity = features.map(feature => record(record(record(feature)?.properties)?.wiki_and_media)?.wikidata)
      .find((value): value is string => typeof value === 'string' && /^Q[1-9][0-9]{0,15}$/.test(value));
    if (entity) {
      if (signal.aborted) throw new ImageFailure('NETWORK');
      const wikidata = new URL('https://www.wikidata.org/w/api.php');
      wikidata.search = new URLSearchParams({ action: 'wbgetclaims', format: 'json', origin: '*', entity, property: 'P18' }).toString();
      onAdditionalRequest();
      const claimsBody = await imageJson(wikidata, signal, fetcher, false);
      const claims = record(record(claimsBody)?.claims)?.P18;
      if (record(claimsBody)?.error || !record(record(claimsBody)?.claims)) throw new ImageFailure('METADATA');
      if (Array.isArray(claims)) {
        for (const claim of [...claims].sort((a, b) => Number(record(b)?.rank === 'preferred') - Number(record(a)?.rank === 'preferred'))) {
          if (record(claim)?.rank === 'deprecated') continue;
          const value = record(record(record(claim)?.mainsnak)?.datavalue)?.value;
          if (typeof value === 'string') ref.file = commonsFile(`File:${value}`);
          if (ref.file) break;
        }
      }
    }
  }
  if (!ref.file) { if (ref.unsupported) throw new ImageFailure('UNSUPPORTED'); return null; }
  if (signal.aborted) throw new ImageFailure('NETWORK');
  const commons = new URL('https://commons.wikimedia.org/w/api.php');
  commons.search = new URLSearchParams({ action: 'query', format: 'json', origin: '*', titles: `File:${ref.file}`, prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '480', iiextmetadatafilter: 'Artist|LicenseShortName' }).toString();
  onAdditionalRequest();
  const body = await imageJson(commons, signal, fetcher, false);
  const pages = record(record(body)?.query)?.pages;
  if (!record(pages)) throw new ImageFailure('METADATA');
  for (const page of Object.values(pages as Record<string, unknown>)) {
    const infos = record(page)?.imageinfo;
    if (!Array.isArray(infos) || !infos.length) continue;
    const info = record(infos[0]);
    const image = normalizeImage({ features: [{ properties: { wiki_and_media: { image: info?.thumburl ?? info?.url } } }] });
    if (!image || commonsFile(image.url) !== ref.file) throw new ImageFailure('UNSUPPORTED');
    const metadata = record(info?.extmetadata);
    return { ...image, author: plainMetadata(record(metadata?.Artist)?.value), license: plainMetadata(record(metadata?.LicenseShortName)?.value) };
  }
  return null;
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


// Region discovery returns places independently of any observation or distance ranking.
export type LandmarkPlace = Omit<LandmarkCandidate, 'distanceMeters'>;
export interface RegionBounds { west: number; south: number; east: number; north: number }
export interface RegionPage { places: LandmarkPlace[]; rawCount: number; subdivide?: boolean }
export const REGION_PAGE_SIZE = 500;
export function regionUrl(bounds: RegionBounds, offset: number, key: string): URL {
  if (!key.trim()) throw new LandmarkFailure('CONFIGURATION');
  if (![bounds.west, bounds.south, bounds.east, bounds.north].every(Number.isFinite)
    || bounds.west < -180 || bounds.east > 180 || bounds.south < -90 || bounds.north > 90
    || bounds.west >= bounds.east || bounds.south >= bounds.north || !Number.isInteger(offset) || offset < 0) throw new LandmarkFailure('RESPONSE_INVALID');
  const url = new URL('https://api.geoapify.com/v2/places');
  url.search = new URLSearchParams({apiKey: key, categories: SEARCH_POLICY.categories.join(','),
    filter: `rect:${bounds.west},${bounds.south},${bounds.east},${bounds.north}`,
    limit: String(REGION_PAGE_SIZE), offset: String(offset), lang: 'ko'}).toString();
  return url;
}
export function normalizeRegionPage(body: unknown, bounds: RegionBounds): RegionPage {
  const features = record(body)?.features;
  if (!Array.isArray(features) || features.length > REGION_PAGE_SIZE) throw new LandmarkFailure('RESPONSE_INVALID');
  const places: LandmarkPlace[] = [], seen = new Set<string>();
  for (const value of features) {
    const feature = record(value), properties = record(feature?.properties), geometry = record(feature?.geometry);
    if (!properties || geometry?.type !== 'Point' || !Array.isArray(geometry.coordinates)) continue;
    const [longitude, latitude] = geometry.coordinates;
    if (typeof longitude !== 'number' || typeof latitude !== 'number' || !validCoordinate({longitude, latitude})) continue;
    if (longitude < bounds.west || longitude > bounds.east || latitude < bounds.south || latitude > bounds.north) continue;
    const name = typeof properties.name === 'string' ? properties.name.trim().slice(0, 160) : '';
    const id = properties.place_id;
    if (!name || !/[\p{L}\p{N}]/u.test(name) || typeof id !== 'string' || !id.trim() || id.length > 2048 || seen.has(id)) continue;
    seen.add(id);
    const categories = Array.isArray(properties.categories) ? properties.categories.filter((item): item is string => typeof item === 'string' && item.length <= 120).slice(0, 20) : [];
    places.push({provider:'geoapify', providerPlaceId:id, name, coordinate:{latitude,longitude}, categories,
      attribution:'Powered by Geoapify · © OpenStreetMap contributors'});
  }
  return {places, rawCount:features.length};
}
export async function fetchRegion(bounds: RegionBounds, offset: number, key: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<RegionPage> {
  let response: Response;
  try { response = await fetcher(regionUrl(bounds, offset, key), {signal, credentials:'omit', cache:'no-store', redirect:'error', referrerPolicy:'strict-origin'}); }
  catch (error) { if (error instanceof LandmarkFailure) throw error; throw new LandmarkFailure('NETWORK'); }
  if (response.status === 401 || response.status === 403) throw new LandmarkFailure('AUTH');
  if (response.status === 429) throw new LandmarkFailure('RATE_LIMIT');
  if (!response.ok) throw new LandmarkFailure('PROVIDER_FAILURE');
  let body: unknown;
  try { body = await response.json(); } catch { throw new LandmarkFailure('RESPONSE_INVALID'); }
  return normalizeRegionPage(body, bounds);
}
