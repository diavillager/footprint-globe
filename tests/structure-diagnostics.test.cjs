'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeText, formatReport } = require('../tools/timeline-sample/sanitizer.js');
const fixtures = require('./synthetic-fixtures.cjs');
const run = input => sanitizeText(JSON.stringify(input));
const noLeaks = result => {
  assert.equal(result.ok, false);
  assert.equal(result.text, undefined);
  assert.doesNotMatch(JSON.stringify(result) + formatReport(result.report), /SECRET|FICTIONAL|2022-|11\.250000|private@email|123456789/);
};
test('nested supported container is diagnosed without exposing wrapper keys or enabling conversion', () => {
  const result = run({ 'private@email': { SECRET_WRAPPER: fixtures.modern() } });
  noLeaks(result);
  assert.equal(result.report.structure.knownFields.semanticSegments.nested, 1);
  assert.equal(result.report.structure.knownFields.semanticSegments.root, 0);
  assert.ok(result.report.structure.hints.includes('NESTED_RECORD_FIELD'));
  assert.ok(result.report.structure.recordShapes.semantic > 0);
  assert.equal(result.report.structure.scanLimited, false);
});
test('raw coordinates disclose counts and types, never numeric values or dates', () => {
  const result = run({ locations: [{ latitudeE7: 123456789, longitudeE7: 987654321, timestampMs: '123456789', deviceId: 'SECRET_DEVICE' }], SECRET_ROOT: null });
  noLeaks(result);
  assert.equal(result.report.structure.recordShapes.rawCoordinate, 1);
  assert.equal(result.report.structure.knownFields.locations.root, 1);
  assert.equal(result.report.structure.knownFields.timestampMs.types.string, 1);
  assert.ok(result.report.structure.hints.includes('RAW_COORDINATE_STRUCTURE'));
});
test('edit structure diagnosis never emits edit payload or reflects unusual types', () => {
  const result = run({ timelineEdits: [{ SECRET_FIELD: 'SECRET_VALUE' }], SECRET_EMAIL: 'private@email' });
  noLeaks(result);
  assert.equal(result.report.structure.knownFields.timelineEdits.types.array, 1);
  assert.ok(result.report.structure.hints.includes('TIMELINE_EDITS_STRUCTURE'));
  assert.equal(result.report.structure.topLevelTypes.string, 1);
});
test('unknown fields, prototype names and coordinate-shaped keys do not leak', () => {
  const result = sanitizeText('{"__proto__":{"SECRET":"private@email"},"constructor":false,"11.250000":["SECRET"],"latitudeE7":"SECRET_VALUE"}');
  noLeaks(result);
  assert.doesNotMatch(JSON.stringify(result), /__proto__|constructor/);
  assert.equal(result.report.structure.knownFields.latitudeE7.types.string, 1);
  assert.equal({}.SECRET, undefined);
});
test('diagnostic scan is bounded and explicitly marks incomplete results', () => {
  const result = run({ SECRET_WRAPPER: Array(20000).fill({ SECRET_FIELD: 'SECRET_VALUE' }) });
  noLeaks(result);
  assert.equal(result.report.structure.scannedNodes, 12000);
  assert.equal(result.report.structure.scanLimited, true);
  assert.match(formatReport(result.report), /일부만 검사: 예/);
  let deep = { semanticSegments: [] };
  for (let i = 0; i < 30; i++) deep = { SECRET_WRAPPER: deep };
  const nested = run(deep);
  noLeaks(nested);
  assert.equal(nested.report.structure.scanLimited, true);
  assert.equal(nested.report.structure.knownFields.semanticSegments, undefined);
});
test('embedded JSON strings stay opaque and are never recursively parsed', () => {
  const result = run({ SECRET_WRAPPER: JSON.stringify(fixtures.modern()) });
  noLeaks(result);
  assert.equal(result.report.structure.knownFields.semanticSegments, undefined);
  assert.equal(result.report.structure.topLevelTypes.string, 1);
});
test('ambiguity and wrong root types remain fail-closed with diagnostics', () => {
  for (const data of [{ semanticSegments: 'SECRET' }, { semanticSegments: [], timelineObjects: [] }, 'SECRET']) {
    const result = run(data);
    noLeaks(result);
    assert.ok(result.report.structure);
  }
});
test('successful samples retain existing shape and do not run unsupported-root diagnosis', () => {
  const result = run(fixtures.modern());
  assert.equal(result.ok, true);
  assert.equal(result.report.structure, undefined);
  assert.doesNotMatch(formatReport(result.report), /구조 진단 v1/);
});
