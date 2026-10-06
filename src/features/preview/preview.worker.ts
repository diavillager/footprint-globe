import { parseTimeline, PREVIEW_LIMITS } from '../../parser';
import { importFile, type ImportRequest } from './importFile';

self.onmessage = async (event: MessageEvent<ImportRequest>) => {
  self.postMessage(await importFile(event.data.file, event.data.datasetId, parseTimeline, PREVIEW_LIMITS.bytes));
};
