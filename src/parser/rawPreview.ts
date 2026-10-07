import type { DatasetId, Observation, ImportCounts, ParseResult } from '../domain/timeline';

export const PREVIEW_LIMITS = { bytes: 64 * 1024 * 1024, records: 100000 } as const;
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (v: object, k: string) => Object.hasOwn(v, k);

export function rawTimestamp(value: unknown) {
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
  const wholeMs = date.getTime() - offset * 60000;
  const fractionNs = Number((m[5] || '').padEnd(9, '0'));
  const ns = BigInt(wholeMs) * 1000000n + BigInt(fractionNs);
  // Convert only the small fractional part: converting the full ns value first
  // can introduce rounding error even when the input has exact milliseconds.
  return { ns, instant: { epochMs: wholeMs + fractionNs / 1000000, sourceText: value } };
}

export function rawCoordinate(value: unknown) {
  if (typeof value !== 'string') return null;
  const m = /^(geo:)?([+-]?\d{1,3}(?:\.\d{1,9})?)(°?),( *)([+-]?\d{1,3}(?:\.\d{1,9})?)(°?)$/.exec(value);
  if (!m || m[3] !== m[6] || (m[1] && m[3])) return null;
  const latitude = Number(m[2]), longitude = Number(m[5]);
  return Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 ? { latitude, longitude } : null;
}

/** Preview extractor, not the sample sanitizer. Copies validated coordinates, timestamps and optional reported accuracy. */
export function parseRawPreview(text: string, datasetId: DatasetId): ParseResult {
  if (new TextEncoder().encode(text).length > PREVIEW_LIMITS.bytes) return { ok: false, code: 'INPUT_LIMIT' };
  let root: unknown;
  try { root = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { return { ok: false, code: 'INVALID_JSON' }; }
  return parseRawValue(root, datasetId);
}

/** Internal parsed-value entry for the offline audit; callers enforce the input byte limit. */
export function parseRawValue(root: unknown, datasetId: DatasetId): ParseResult {
  if (!object(root) || !Array.isArray(root.rawSignals) || own(root, 'semanticSegments') || own(root, 'timelineObjects')) return { ok: false, code: 'UNSUPPORTED_FORMAT' };
  if (root.rawSignals.length > PREVIEW_LIMITS.records) return { ok: false, code: 'INPUT_LIMIT' };
  const counts: ImportCounts = { input: root.rawSignals.length, accepted: 0, ignoredSignals: 0, invalidPositions: 0, ignoredRootFields: Object.keys(root).length - 1 };
  const entries: { point: Observation; ns: bigint }[] = [];
  for (const record of root.rawSignals) {
    if (!object(record) || !own(record, 'position')) { counts.ignoredSignals++; continue; }
    const position = record.position;
    if (!object(position) || Number(own(position, 'LatLng')) + Number(own(position, 'latLng')) !== 1) { counts.invalidPositions++; continue; }
    const coord = rawCoordinate(own(position, 'LatLng') ? position.LatLng : position.latLng);
    const time = rawTimestamp(position.timestamp);
    if (!coord || !time) { counts.invalidPositions++; continue; }
    entries.push({ ns: time.ns, point: { id: `observation:${datasetId}:${entries.length}`, coordinate: coord, time: time.instant,
      ...(typeof position.accuracyMeters === 'number' && Number.isFinite(position.accuracyMeters) && position.accuracyMeters >= 0 ? { accuracyMeters: position.accuracyMeters } : {}) } });
  }
  // Exact fractional timestamps order observations; equal instants keep source order.
  entries.sort((a, b) => a.ns < b.ns ? -1 : a.ns > b.ns ? 1 : 0);
  counts.accepted = entries.length;
  if (!entries.length) return { ok: false, code: 'NO_VALID_POSITIONS', counts };
  return { ok: true, counts, data: { datasetId, observations: entries.map(e => e.point), recordedVisits: [], recordedPaths: [] } };
}
