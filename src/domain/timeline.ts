/** IDs are assigned per loaded dataset; never derive visit identity from coordinates or marker order. */
export type DatasetId = `dataset:${string}`;
export type ObservationId = `observation:${string}`;
export type VisitId = `visit:${string}`;
export type PathId = `path:${string}`;
export type PhotoId = `photo:${string}`;

/** Decimal degrees (not E7); zero is valid. Parsers validate latitude ±90 and longitude ±180. */
export interface Coordinate { readonly latitude: number; readonly longitude: number }
/** Epoch milliseconds for ordering; source ISO/epoch text preserves precision and offset separately. */
export interface Instant { readonly epochMs: number; readonly sourceText: string }
export interface Observation {
  readonly id: ObservationId;
  readonly coordinate: Coordinate;
  readonly time: Instant;
}
export interface RecordedVisit {
  readonly id: VisitId;
  readonly origin: 'recorded';
  readonly coordinate: Coordinate;
  readonly start: Instant;
  readonly end: Instant;
  readonly name?: string;
}
export interface PathPoint { readonly coordinate: Coordinate; readonly time?: Instant }
export interface RecordedPath {
  readonly id: PathId;
  readonly origin: 'recorded';
  readonly points: readonly PathPoint[];
}
/** Read-only parser output. No inferred paths, photo URLs, or globe-library types. */
export interface TimelineData {
  readonly datasetId: DatasetId;
  readonly observations: readonly Observation[];
  readonly recordedVisits: readonly RecordedVisit[];
  readonly recordedPaths: readonly RecordedPath[];
}
/** A user's explicit choice, tied to a particular observation rather than all visits at a coordinate. */
export interface ManualVisit {
  readonly id: VisitId;
  readonly origin: 'manual';
  readonly datasetId: DatasetId;
  readonly observationId: ObservationId;
}
/** Session-only attachment. UI owns create/revokeObjectURL and clears it on dataset replacement. */
export interface PhotoAttachment {
  readonly id: PhotoId;
  readonly datasetId: DatasetId;
  readonly visitId: VisitId;
  readonly objectUrl: string;
}
export type DiagnosticCode = 'INVALID_JSON' | 'UNSUPPORTED_FORMAT' | 'INVALID_RECORD' | 'EMPTY_DATA' | 'INPUT_LIMIT';
/** Never include arbitrary keys, filenames, source values, or exception text in diagnostics. */
export interface Diagnostic { readonly code: DiagnosticCode; readonly count: number }
export type ParseResult =
  | { readonly ok: true; readonly data: TimelineData; readonly diagnostics: readonly Diagnostic[] }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };
/** Async boundary supports a future worker; supported formats and limits remain separate decisions. */
export type TimelineParser = (text: string, datasetId: DatasetId) => Promise<ParseResult>;
