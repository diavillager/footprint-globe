import type { DatasetId, Observation, TimelineData } from '../domain/timeline';

export const PREVIEW_LIMITS = { bytes: 64 * 1024 * 1024, records: 100000 } as const;
export type PreviewError = 'INVALID_JSON' | 'UNSUPPORTED_FORMAT' | 'INPUT_LIMIT' | 'NO_VALID_POSITIONS' | 'FILE_READ_FAILED';
export interface PreviewCounts { input: number; accepted: number; ignoredSignals: number; invalidPositions: number; ignoredRootFields: number }
export type PreviewResult = { ok: true; data: TimelineData; counts: PreviewCounts } | { ok: false; code: PreviewError; counts?: PreviewCounts };
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (v: object, k: string) => Object.hasOwn(v, k);

function timestamp(value: unknown) {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!m) return null;
  const datePart = `${m[1]}T${m[2]}:${m[3]}:${m[4]}`;
  const date = new Date(`${datePart}.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== datePart) return null;
  const zone = m[6]!;
  const hours = zone === 'Z' ? 0 : Number(zone.slice(1, 3));
  const minutes = zone === 'Z' ? 0 : Number(zone.slice(4, 6));
  if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) return null;
  const offset = (hours * 60 + minutes) * (zone[0] === '-' ? -1 : 1);
  const ns = BigInt(date.getTime() - offset * 60000) * 1000000n + BigInt((m[5] || '').padEnd(9, '0'));
  return { ns, instant: { epochMs: Number(ns) / 1000000, sourceText: value } };
}

function coordinate(value: unknown) {
  if (typeof value !== 'string') return null;
  const m = /^(geo:)?([+-]?\d{1,3}(?:\.\d{1,9})?)(°?),( *)([+-]?\d{1,3}(?:\.\d{1,9})?)(°?)$/.exec(value);
  if (!m || m[3] !== m[6] || (m[1] && m[3])) return null;
  const latitude = Number(m[2]), longitude = Number(m[5]);
  return Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 ? { latitude, longitude } : null;
}

/** Preview extractor, not the sample sanitizer. Copies only validated coordinates and timestamps. */
export function parseRawPreview(text: string, datasetId: DatasetId): PreviewResult {
  if (new TextEncoder().encode(text).length > PREVIEW_LIMITS.bytes) return { ok: false, code: 'INPUT_LIMIT' };
  let root: unknown;
  try { root = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { return { ok: false, code: 'INVALID_JSON' }; }
  if (!object(root) || !Array.isArray(root.rawSignals) || own(root, 'semanticSegments') || own(root, 'timelineObjects')) return { ok: false, code: 'UNSUPPORTED_FORMAT' };
  if (root.rawSignals.length > PREVIEW_LIMITS.records) return { ok: false, code: 'INPUT_LIMIT' };
  const counts: PreviewCounts = { input: root.rawSignals.length, accepted: 0, ignoredSignals: 0, invalidPositions: 0, ignoredRootFields: Object.keys(root).length - 1 };
  const entries: { point: Observation; ns: bigint }[] = [];
  for (const record of root.rawSignals) {
    if (!object(record) || !own(record, 'position')) { counts.ignoredSignals++; continue; }
    const position = record.position;
    if (!object(position) || Number(own(position, 'LatLng')) + Number(own(position, 'latLng')) !== 1) { counts.invalidPositions++; continue; }
    const coord = coordinate(own(position, 'LatLng') ? position.LatLng : position.latLng);
    const time = timestamp(position.timestamp);
    if (!coord || !time) { counts.invalidPositions++; continue; }
    entries.push({ ns: time.ns, point: { id: `observation:${datasetId}:${entries.length}`, coordinate: coord, time: time.instant } });
  }
  // Exact fractional timestamps order observations; equal instants keep source order.
  entries.sort((a, b) => a.ns < b.ns ? -1 : a.ns > b.ns ? 1 : 0);
  counts.accepted = entries.length;
  if (!entries.length) return { ok: false, code: 'NO_VALID_POSITIONS', counts };
  return { ok: true, counts, data: { datasetId, observations: entries.map(e => e.point), recordedVisits: [], recordedPaths: [] } };
}
