import { describe, expect, it } from 'vitest';
import { parseRawPreview } from '../../parser/rawPreview';
import { auditApp, createAudit, emptyAudit, formatAuditReport } from './structureAudit';

const position = { LatLng: '0°, 0°', timestamp: '2040-01-01T00:00:00Z', accuracyMeters: 0 };
function scan(root: unknown, batch = 10000) {
  const audit = createAudit(root);
  while (audit.report.status === 'scanning') audit.step(batch);
  audit.report.app = auditApp(root);
  return audit.report;
}

describe('local whole-structure audit', () => {
  it('uses actual app parser counts and preserves the input', () => {
    const root = { rawSignals: [{ position }, { wifiScan: {} }, { position: { timestamp: position.timestamp } }, { position: { ...position, LatLng: 'invalid' } }], extra: { position } };
    const before = JSON.stringify(root);
    const report = scan(root, 1);
    const parsed = parseRawPreview(before, 'dataset:synthetic');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(report.app.counts).toEqual(parsed.counts);
    expect(report.app.counts).toEqual({ input: 4, accepted: 1, ignoredSignals: 1, invalidPositions: 2, ignoredRootFields: 1 });
    expect(report.knownPositionObjects).toBe(3);
    expect(report.outsideRawPositionObjects).toBe(1);
    expect(report.paths.find(p => p.path === '$.rawSignals')?.parserReadable).toBe(true);
    expect(JSON.stringify(root)).toBe(before);
  });

  it('does not treat sample-tool support as app support', () => {
    for (const root of [{ semanticSegments: [{ visit: {} }] }, { rawSignals: [{ position }], timelineObjects: [] }, [{ position }]]) {
      const report = scan(root);
      expect(report.status).toBe('complete');
      expect(report.app).toEqual({ checked: true, ok: false, code: 'UNSUPPORTED_FORMAT' });
      expect(formatAuditReport(report)).toContain('0건으로 해석하지 마세요');
    }
  });

  it('visits beyond old node limits and still reaches late siblings', () => {
    const report = scan({ padding: Array(2_000_010).fill(null), late: { position } });
    expect(report.visited).toBe(2_000_017);
    expect(report.types.null).toBe(2_000_010);
    expect(report.knownPositionObjects).toBe(1);
    expect(report.outsideRawPositionObjects).toBe(1);
    expect(report.status).toBe('complete');
  });

  it('traverses deep structures while disclosing shortened display paths', () => {
    let root: unknown = { position };
    for (let i = 0; i < 200; i++) root = { nested: root };
    const report = scan(root, 11);
    expect(report.visited).toBe(205);
    expect(report.knownPositionObjects).toBe(1);
    expect(report.shortenedPaths).toBeGreaterThan(180);
    expect(report.status).toBe('complete');
  });

  it('does not sample arrays and finds a rare schema at the end', () => {
    const items: unknown[] = Array.from({ length: 30000 }, () => ({ activityRecord: {} }));
    items.push({ unknownTrack: [{ latitude: 0, longitude: 0, time: position.timestamp }] });
    const report = scan({ items });
    expect(report.numericCoordinateObjects).toBe(1);
    expect(report.timeStrings).toBe(1);
    expect(report.paths.some(p => p.path.includes('필드2[].latitude'))).toBe(true);
  });

  it('replaces arbitrary keys and never includes source values in either report', () => {
    const root = { 'PRIVATE_EMAIL@example.invalid': Object.fromEntries([
      ['__proto__', { SECRET_ID: 'CANARY_VALUE' }],
      ['37.123,127.456', { position: { LatLng: '38.123°, 128.456°', timestamp: '2049-02-03T12:34:56Z' } }],
      ['<script>PRIVATE_KEY</script>', '{"HIDDEN_JSON":123}'],
    ]) };
    const report = scan(root);
    const output = JSON.stringify(report) + formatAuditReport(report);
    for (const secret of ['PRIVATE_EMAIL', '__proto__', 'SECRET_ID', 'CANARY_VALUE', '37.123', '38.123', '128.456', '2049-02-03', 'PRIVATE_KEY', 'HIDDEN_JSON']) expect(output).not.toContain(secret);
    expect(output).toContain('필드1');
    expect(report.coordinateStrings).toBe(1);
    expect(report.encodedStrings).toBe(1);
    expect(report.types.number).toBe(0); // Embedded JSON is explicitly opaque.
  });

  it('reports detail caps without truncating traversal', () => {
    const root = Object.fromEntries(Array.from({ length: 1500 }, (_, i) => [`private-${i}`, { position }]));
    const report = scan(root);
    expect(report.visited).toBe(7501);
    expect(report.knownPositionObjects).toBe(1500);
    expect(report.paths).toHaveLength(1200);
    expect(report.unlistedNodes).toBeGreaterThan(0);
    expect(report.unaliasedFields).toBe(300);
    expect(report.status).toBe('complete');
    expect(formatAuditReport(report)).not.toContain('private-');
  });

  it('keeps the app record cap distinct from traversal completeness', () => {
    const report = scan({ rawSignals: Array(100001).fill(null) });
    expect(report.app.code).toBe('INPUT_LIMIT');
    expect(report.visited).toBe(100003);
    expect(report.status).toBe('complete');
  });

  it('handles empty and scalar JSON with no claim of app compatibility', () => {
    for (const root of [null, true, 1, 'private', {}, []]) {
      const report = scan(root);
      expect(report.visited).toBe(1);
      expect(report.app.ok).toBe(false);
      expect(report.status).toBe('complete');
    }
  });

  it('never describes cancellation or failure as a fully explored document', () => {
    for (const status of ['scanning', 'cancelled', 'failed'] as const) {
      const report = emptyAudit(); report.status = status;
      const output = formatAuditReport(report);
      expect(output).toContain('미탐색 JSON 항목: 건수 미확정');
      expect(output).not.toContain('미탐색 JSON 항목: 0개');
    }
  });

  it('discloses standard JSON duplicate-key and semantic limits', () => {
    const report = scan(JSON.parse('{"rawSignals":[],"rawSignals":[{"wifiScan":{}}]}'));
    expect(report.app.counts?.input).toBe(1);
    expect(formatAuditReport(report)).toContain('중복 키는 마지막 값만');
    expect(formatAuditReport(report)).toContain('모든 형식의 의미를 이해했거나');
  });
});
