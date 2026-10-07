import { inspectLocations } from './locationQuality';
import { parseTimeline, PREVIEW_LIMITS } from '../../parser';
import { importFile, type ImportRequest } from './importFile';

self.onmessage = async (event: MessageEvent<ImportRequest>) => {
  const result = await importFile(event.data.file, event.data.datasetId, parseTimeline, PREVIEW_LIMITS.bytes);
  self.postMessage({ ...result, quality: result.ok ? inspectLocations(result.data.observations) : null });
};
