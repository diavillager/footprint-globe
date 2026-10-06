import type { TimelineParser } from '../domain/timeline';
import { parseRawPreview } from './rawPreview';

export { PREVIEW_LIMITS } from './rawPreview';
/** Data entry point; unchanged rawSignals-only preview policy. Called in a UI-owned worker. */
export const parseTimeline: TimelineParser = async (text, datasetId) => parseRawPreview(text, datasetId);
