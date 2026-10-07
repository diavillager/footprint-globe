import type { TimelineParser } from '../domain/timeline';
import { parseTimelineRoutes } from './routeImport';

export { PREVIEW_LIMITS } from './rawPreview';
/** Timeline sources stay separate; representative path selection happens after import confirmation. */
export const parseTimeline: TimelineParser = async (text, datasetId) => parseTimelineRoutes(text, datasetId);
