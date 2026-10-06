// Node 24: node --expose-gc src/parser/benchmark.mjs
// Synthetic inputs only. No file arguments, exports, network or personal data.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { parseRawPreview, PREVIEW_LIMITS } from './rawPreview.ts';

if (!globalThis.gc) throw new Error('Run with --expose-gc');
const mib = bytes => Math.round(bytes / 1024 / 1024 * 10) / 10;
for (const [records, padded] of [[10123, false], [100000, false], [100000, true]]) {
  let text = JSON.stringify({ rawSignals: Array.from({ length: records }, (_, i) => ({ position: {
    LatLng: `0,${i % 180}`, timestamp: new Date(Date.UTC(2040, 0, 1) + (records - i) * 1000).toISOString(),
  } })) });
  if (padded) text += ' '.repeat(PREVIEW_LIMITS.bytes - Buffer.byteLength(text));
  const bytes = Buffer.byteLength(text);
  // Warm up once; input generation is excluded from parse timings.
  assert.equal(parseRawPreview(text, 'dataset:benchmark').ok, true);
  const runs = [];
  for (let run = 0; run < 3; run++) {
    globalThis.gc();
    const before = process.memoryUsage();
    const start = performance.now();
    const result = parseRawPreview(text, 'dataset:benchmark');
    const elapsedMs = performance.now() - start;
    const after = process.memoryUsage();
    assert.equal(result.ok, true);
    assert.equal(result.counts.accepted, records);
    assert.equal(result.data.observations.length, records);
    runs.push({ elapsedMs: Math.round(elapsedMs), heapDeltaMiB: mib(after.heapUsed - before.heapUsed), rssDeltaMiB: mib(after.rss - before.rss) });
  }
  // Memory snapshots are not peak usage, and do not include browser/worker/rendering overhead.
  console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch,
    records, inputMiB: mib(bytes), runs, medianMs: runs.map(r => r.elapsedMs).sort((a, b) => a - b)[1] }));
}
