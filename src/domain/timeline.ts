/** IDs are assigned per loaded dataset; never derive visit identity from coordinates or marker order. */
export type DatasetId = `dataset:${string}`;
export type ObservationId = `observation:${string}`;
export type VisitId = `visit:${string}`;
export type PathId = `path:${string}`;
export type PhotoId = `photo:${string}`;

/** Decimal degrees (not E7); zero is valid. Parsers validate latitude ±90 and longitude ±180. */
export interface Coordinate { readonly latitude: number; readonly longitude: number }
/** Approximate epoch milliseconds for statistics. Preserve parser order for sub-ms instants. */
export interface Instant { readonly epochMs: number; readonly sourceText: string }
export interface Observation {
  readonly id: ObservationId;
  readonly coordinate: Coordinate;
  readonly time: Instant;
  /** Optional reported horizontal accuracy in metres; never inferred. */
  readonly accuracyMeters?: number;
  readonly source?: 'raw' | 'semantic' | 'gpx';
  /** Explicit source continuity; null starts an isolated point or a new run. */
  readonly predecessorId?: ObservationId | null;
  readonly sourceSegment?: string;
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
  readonly detailedObservations?: readonly Observation[];
  readonly format?: 'timeline' | 'gpx';
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
export type ImportError = 'INVALID_JSON' | 'INVALID_XML' | 'UNSUPPORTED_ENCODING' | 'DTD_FORBIDDEN' | 'UNSUPPORTED_FORMAT' | 'INPUT_LIMIT' | 'NO_VALID_POSITIONS' | 'FILE_READ_FAILED';
/** Supported signal/path-point accounting; missing counts means input was not fully inspected, not zero. */
export interface ImportCounts { input: number; accepted: number; ignoredSignals: number; invalidPositions: number; ignoredRootFields: number }
/** Never include arbitrary keys, filenames, source values, or exception text in diagnostics. */
export type ParseResult =
  | { readonly ok: true; readonly data: TimelineData; readonly counts: ImportCounts }
  | { readonly ok: false; readonly code: ImportError; readonly counts?: ImportCounts };
/** Promise alone does not move CPU work off-thread; the UI invokes this inside its worker. */
export type TimelineParser = (text: string, datasetId: DatasetId) => Promise<ParseResult>;
