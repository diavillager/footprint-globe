import { expect, it, vi } from 'vitest';
import type { ParseResult, TimelineParser } from '../../domain/timeline';
import { syntheticParser, createSyntheticEmptyResult } from '../../fixtures/timeline';
import { syntheticRawPreview } from '../../fixtures/preview';
import { parseTimeline, PREVIEW_LIMITS } from '../../parser';
import { importFile } from './importFile';

// A renderer-neutral consumer demonstrates that either implementation meets the same boundary.
function viewState(result: ParseResult) {
  return result.ok ? { count: result.data.observations.length, dataset: result.data.datasetId } : { error: result.code };
}
it('swaps a synthetic parser and real parser without changing the file consumer', async () => {
  for (const [parser, count] of [[syntheticParser, 3], [parseTimeline, 4]] as const) {
    const text = vi.fn(async () => JSON.stringify(syntheticRawPreview()));
    const result = await importFile({ size: 1000, text }, 'dataset:contract', parser, PREVIEW_LIMITS.bytes);
    expect(viewState(result)).toEqual({ count, dataset: 'dataset:contract' });
    expect(text).toHaveBeenCalledTimes(1);
    expect(result.counts?.accepted).toBe(count);
    if (result.ok) expect(result.data.recordedPaths).toEqual([]);
  }
  expect(viewState(createSyntheticEmptyResult())).toEqual({ error: 'NO_VALID_POSITIONS' });
});
it('preserves partial failure accounting and fixed errors across the async boundary', async () => {
  const raw = syntheticRawPreview();
  const result = await parseTimeline(JSON.stringify({ rawSignals: [...raw.rawSignals, { position: { LatLng: 'CANARY', timestamp: 'CANARY' } }, { wifiScan: 'CANARY' }] }), 'dataset:partial');
  expect(result.ok).toBe(true);
  expect(result.counts).toEqual({ input: 6, accepted: 4, invalidPositions: 1, ignoredSignals: 1, ignoredRootFields: 0 });
  expect(JSON.stringify(result)).not.toContain('CANARY');
  expect(await parseTimeline('{CANARY', 'dataset:bad')).toEqual({ ok: false, code: 'INVALID_JSON' });
  const empty = await parseTimeline('{"rawSignals":[]}', 'dataset:empty');
  expect(empty).toEqual(createSyntheticEmptyResult());
});
it('checks size before reading and hides file or parser exception content', async () => {
  const text = vi.fn(async () => { throw new Error('CANARY'); });
  const parser = vi.fn<TimelineParser>();
  expect(await importFile({ size: 2, text }, 'dataset:test', parser, 1)).toEqual({ ok: false, code: 'INPUT_LIMIT' });
  expect(text).not.toHaveBeenCalled(); expect(parser).not.toHaveBeenCalled();
  expect(await importFile({ size: 1, text }, 'dataset:test', parser, 1)).toEqual({ ok: false, code: 'FILE_READ_FAILED' });
  const throwing: TimelineParser = async () => { throw new Error('CANARY'); };
  expect(await importFile({ size: 1, text: async () => 'CANARY' }, 'dataset:test', throwing, 1)).toEqual({ ok: false, code: 'FILE_READ_FAILED' });
});
