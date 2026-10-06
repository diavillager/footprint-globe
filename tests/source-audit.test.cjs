'use strict';
// Authored synthetic structures only; never read exported location files.
const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeText, formatReport } = require('../tools/timeline-sample/sanitizer.js');
const { modern } = require('./synthetic-fixtures.cjs');
const { rawSignals } = require('./raw-signal-fixtures.cjs');
const run = data => sanitizeText(JSON.stringify(data));
const privateReport = result => assert.doesNotMatch(JSON.stringify(result.report) + formatReport(result.report),
  /SECRET|FICTIONAL|2022-|11\.250000|private@email|__proto__/);

test('successful raw sample audits excluded siblings without changing output', () => {
  const data = rawSignals();
  const before = run(data);
  data.SECRET_CONTAINER = { SECRET_NESTED: modern() };
  const result = run(data);
  assert.equal(result.ok, true);
  assert.equal(result.text, before.text);
  assert.ok(result.report.audit.otherArea.path > 0);
  assert.ok(result.report.audit.otherArea.visit > 0);
  assert.equal(result.report.audit.selectedArea.rawPosition, 3);
  assert.equal(result.report.audit.selectedArea.wifiScan, 1);
  assert.equal(result.report.audit.selectedArea.activityRecord, 1);
  assert.match(formatReport(result.report), /OUTSIDE_SAMPLE_CANDIDATE/);
  privateReport(result);
});

test('rejected route records report fixed exclusion reasons while accepted paths remain', () => {
  const data = modern();
  const path = data.semanticSegments.find(r => r.timelinePath);
  assert.ok(path);
  data.semanticSegments.push({ ...path, SECRET_EXTRA: 'private@email' });
  const result = run(data);
  assert.equal(result.ok, true);
  const stage = result.report.audit.stages.path;
  assert.equal(stage.excluded, 1);
  assert.equal(stage.reasons.UNKNOWN_FIELD, 1);
  assert.ok(stage.validated > 0);
  assert.ok(stage.selected > 0);
  privateReport(result);
});

test('size selection is distinguished from safety exclusions', () => {
  const position = rawSignals().rawSignals[1];
  const result = run({ rawSignals: Array(20).fill(position) });
  const stage = result.report.audit.stages.rawPosition;
  assert.deepEqual([stage.candidates, stage.validated, stage.excluded, stage.selected], [20, 20, 0, 9]);
  assert.equal(result.report.audit.recordsComplete, true);
  assert.match(formatReport(result.report), /크기로 미선택=11/);
  assert.match(formatReport(result.report), /원본에 경로가 없다는 뜻은 아닙니다/);
  privateReport(result);
});

test('empty or malformed path fields are not validated routes', () => {
  for (const timelinePath of [[], 'SECRET']) {
    const result = run({ semanticSegments: [{ ...modern().semanticSegments[0], timelinePath }] });
    assert.equal(result.ok, false);
    assert.equal(result.report.audit.stages.path.candidates, 1);
    assert.equal(result.report.audit.stages.path.validated, 0);
    assert.equal(result.report.audit.sampleSaved, false);
    assert.match(formatReport(result.report), /NO_SAMPLE_SAVED/);
    privateReport(result);
  }
});

test('large raw input and a late sibling are both inspected beyond old diagnosis limit', () => {
  const data = { rawSignals: Array(33738).fill(rawSignals().rawSignals[1]), SECRET_LATE: modern() };
  const result = run(data);
  assert.equal(result.ok, true);
  assert.equal(result.report.audit.scanLimited, false);
  assert.ok(result.report.audit.scannedNodes > 12000);
  assert.equal(result.report.audit.selectedArea.rawPosition, 33738);
  assert.ok(result.report.audit.otherArea.path > 0);
  privateReport(result);
});

test('unknown wrappers are counted safely; encoded strings stay opaque', () => {
  const result = run(JSON.parse('{"__proto__":{"SECRET":null},"SECRET_TEXT":"{\\"timelinePath\\":[]}","SECRET_WRAPPER":{"timelinePath":[]}}'));
  assert.equal(result.ok, false);
  assert.equal(result.report.audit.otherArea.path, 1);
  assert.equal(result.report.audit.recordsComplete, false);
  privateReport(result);
});

test('node and depth budgets explicitly leave the diagnosis unresolved', () => {
  let deep = modern();
  for (let i = 0; i < 40; i++) deep = { SECRET: deep };
  const result = run({ rawSignals: rawSignals().rawSignals, SECRET_DEEP: deep });
  assert.equal(result.ok, true);
  assert.equal(result.report.audit.scanLimited, true);
  privateReport(result);
  const wide = run({ SECRET_WIDE: Array(2000010).fill(null), SECRET_LATE: modern() });
  assert.equal(wide.report.audit.scannedNodes, 2000000);
  assert.equal(wide.report.audit.scanLimited, true);
  assert.ok(wide.report.audit.otherArea.path > 0);
  privateReport(wide);
});
