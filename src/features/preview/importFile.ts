import type { DatasetId, ParseResult, TimelineParser } from '../../domain/timeline';

export interface ImportRequest { file: File; datasetId: DatasetId }
/** UI-side file boundary. The parser only receives text, never File or DOM objects. */
export async function importFile(file: Pick<File, 'size' | 'text'>, datasetId: DatasetId, parser: TimelineParser, maxBytes: number): Promise<ParseResult> {
  if (file.size > maxBytes) return { ok: false, code: 'INPUT_LIMIT' };
  try { return await parser(await file.text(), datasetId); }
  catch { return { ok: false, code: 'FILE_READ_FAILED' }; }
}
