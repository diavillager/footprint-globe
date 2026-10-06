import { parseRawPreview, PREVIEW_LIMITS } from '../../parser/rawPreview';
import type { DatasetId } from '../../domain/timeline';

self.onmessage = async (event: MessageEvent<{ file: File; datasetId: DatasetId }>) => {
  if (event.data.file.size > PREVIEW_LIMITS.bytes) { self.postMessage({ ok: false, code: 'INPUT_LIMIT' }); return; }
  try {
    const text = await event.data.file.text();
    self.postMessage(parseRawPreview(text, event.data.datasetId));
  } catch { self.postMessage({ ok: false, code: 'FILE_READ_FAILED' }); }
};
