'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeText, formatReport, LIMITS } = require('../tools/timeline-sample/sanitizer.js');
const { rawSignals } = require('./raw-signal-fixtures.cjs');
const semantic = require('./synthetic-fixtures.cjs');
const run = input => sanitizeText(JSON.stringify(input));
const single = () => ({ rawSignals: [rawSignals().rawSignals[1]] });
const output = result => { assert.equal(result.ok, true, formatReport(result.report)); return JSON.parse(result.text); };
function sameShape(a, b) {
  assert.equal(typeof a, typeof b);
  if (a === null || typeof a !== 'object') return;
  assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort());
  for (const key of Object.keys(a)) sameShape(a[key], b[key]);
}
test('raw-only sample retains positions, drops Wi-Fi/profile/activity and does not invent visits or routes', () => {
  const input = rawSignals(), before = JSON.stringify(input), result = run(input), sample = output(result);
  assert.deepEqual(Object.keys(sample), ['rawSignals']);
  assert.equal(sample.rawSignals.length, 3);
  const selected = input.rawSignals.filter(item => item.position);
  selected.forEach((item, i) => sameShape(item, sample.rawSignals[i]));
  assert.equal(JSON.stringify(input), before);
  assert.equal(result.report.inputRecords, 5);
  assert.equal(result.report.excludedRecords, 2);
  assert.equal(result.report.excludedRootFields, 1);
  assert.equal(result.report.rawPositions, 3);
  for (const key of ['visits', 'activities', 'paths']) assert.equal(result.report[key], 0);
  assert.match(formatReport(result.report), /원시 위치 관측값만 포함/);
  assert.doesNotMatch(result.text, /FICTIONAL|2022-|11\.2500000|42\.5000000|123\.45|6\.78|wifiScan|activityRecord|userLocationProfile|visit|route/);
  assert.doesNotMatch(JSON.stringify(result.report), /FICTIONAL|2022-|11\.2500000/);
});
test('coordinates repeat consistently and time differences, offset syntax and precision are preserved', () => {
  const source = rawSignals().rawSignals.filter(item => item.position).map(item => item.position);
  const targets = output(run(rawSignals())).rawSignals.map(item => item.position);
  const shift = Date.parse(targets[0].timestamp) - Date.parse(source[0].timestamp);
  assert.notEqual(shift, 0);
  targets.forEach((item, i) => {
    assert.equal(Date.parse(item.timestamp) - Date.parse(source[i].timestamp), shift);
    assert.match(item.timestamp, /\.\d{3}\+00:00$/);
    assert.match(item.LatLng, /^-?\d+\.\d{7}°, -?\d+\.\d{7}°$/);
    const [lat, lng] = item.LatLng.replaceAll('°', '').split(',').map(Number);
    assert.ok(Math.abs(lat) <= 90 && Math.abs(lng) <= 180);
  });
  assert.equal(targets[0].LatLng, targets[2].LatLng);
  assert.notEqual(targets[0].LatLng, targets[1].LatLng);
  assert.equal(targets[0].source, 'UNKNOWN');
  for (const key of ['accuracyMeters', 'altitudeMeters', 'speedMetersPerSecond']) assert.equal(targets[0][key], 0);
});
test('a single position is sufficient, lowercase coordinate key and geo syntax are not renamed', () => {
  const input = single(), pos = input.rawSignals[0].position;
  delete pos.LatLng;
  pos.latLng = 'geo:11.2500000,42.5000000';
  pos.timestamp = '2022-03-01T00:00:00.123456789Z';
  const result = run(input), converted = output(result).rawSignals[0].position;
  assert.equal(result.report.rawPositions, 1);
  sameShape(pos, converted);
  assert.match(converted.latLng, /^geo:/);
  assert.match(converted.timestamp, /\.123456789Z$/);
  assert.equal(converted.LatLng, undefined);
});
test('raw record order is preserved even when timestamps are out of order', () => {
  const data = rawSignals();
  [data.rawSignals[1], data.rawSignals[4]] = [data.rawSignals[4], data.rawSignals[1]];
  const result = output(run(data));
  assert.ok(Date.parse(result.rawSignals[0].position.timestamp) > Date.parse(result.rawSignals[2].position.timestamp));
});
test('unknown position or wrapper fields, mixed signal records and arbitrary types exclude the entire record', () => {
  for (const mutate of [
    p => { p.position.SECRET_LOCATION = 'geo:33,44'; },
    p => { p.SECRET_DEVICE = 123456789; },
    p => { p.wifiScan = { devices: [{ mac: 'FICTIONAL_MAC' }] }; },
    p => { p.position.source = { SECRET_ID: 'FICTIONAL_ID' }; },
    p => { p.position.accuracyMeters = 'SECRET_VALUE'; },
    p => { p.position = null; }
  ]) {
    const data = single(); mutate(data.rawSignals[0]);
    const result = run(data);
    assert.equal(result.ok, false); assert.equal(result.text, undefined);
    assert.equal(result.report.excludedRecords, 1);
    assert.equal(result.report.reasons.NO_SAFE_RAW_POSITION, 1);
    assert.doesNotMatch(JSON.stringify(result) + formatReport(result.report), /SECRET|FICTIONAL|123456789|geo:33/);
  }
});
test('invalid coordinates, ambiguous keys, missing or malformed times are never passed through', () => {
  for (const mutate of [
    p => { p.LatLng = '91°, 0°'; }, p => { p.LatLng = '0°, 181°'; },
    p => { p.LatLng = 'SECRET'; }, p => { p.latLng = p.LatLng; },
    p => { delete p.LatLng; }, p => { delete p.timestamp; },
    p => { p.timestamp = '2022-02-30T00:00:00Z'; }, p => { p.timestamp = 123456789; }
  ]) {
    const data = single(); mutate(data.rawSignals[0].position);
    const result = run(data);
    assert.equal(result.ok, false); assert.equal(result.text, undefined);
    assert.equal(result.report.excludedRecords, 1);
  }
});
test('unsupported signals and empty inputs stop with safe diagnostics', () => {
  for (const signals of [[], [null, false, 'SECRET_VALUE'], [{ wifiScan: { mac: 'SECRET_MAC' } }, { activityRecord: { type: 'SECRET_TYPE' } }]]) {
    const result = run({ rawSignals: signals });
    assert.equal(result.ok, false); assert.equal(result.text, undefined);
    assert.ok(result.report.reasons.NO_SAFE_RAW_POSITION);
    assert.ok(result.report.structure);
    assert.doesNotMatch(formatReport(result.report), /SECRET/);
  }
  const result = run({ rawSignals: 'SECRET' });
  assert.equal(result.report.reasons.ROOT_FIELD_TYPE, 1);
});
test('late positions after many non-position signals are retained and output remains bounded', () => {
  const position = single().rawSignals[0];
  const signals = Array.from({ length: 1000 }, () => ({ wifiScan: { devices: [{ mac: 'FICTIONAL_MAC' }] } }));
  signals.push(...Array.from({ length: 30 }, () => structuredClone(position)));
  const result = run({ rawSignals: signals }); output(result);
  assert.equal(result.report.processedRecords, 30);
  assert.equal(result.report.excludedRecords, 1000);
  assert.equal(result.report.sampledOutRecords, 21);
  assert.equal(result.report.rawPositions, LIMITS.records);
  assert.ok(result.report.outputBytes <= LIMITS.outputBytes);
});
test('existing semantic mode takes precedence and is never silently bypassed', () => {
  const data = { ...semantic.modern(), ...rawSignals() };
  const result = run(data), sample = output(result);
  assert.deepEqual(Object.keys(sample), ['semanticSegments']);
  assert.equal(result.report.rawPositions, 0);
  assert.equal(result.report.excludedRootFields, 2);
  const failResult = run({ semanticSegments: [], rawSignals: single().rawSignals });
  assert.equal(failResult.ok, false);
  assert.equal(failResult.report.reasons.INSUFFICIENT_COVERAGE, 1);
  assert.equal(run({ semanticSegments: null, rawSignals: single().rawSignals }).report.reasons.ROOT_FIELD_TYPE, 1);
});
test('old semantic single-visit input still requires movement', () => {
  const result = run({ semanticSegments: [semantic.modern().semanticSegments[0]] });
  assert.equal(result.ok, false);
  assert.equal(result.report.reasons.INSUFFICIENT_COVERAGE, 1);
});
test('a 25 MiB synthetic raw export keeps only a bounded sample', () => {
  const record = single().rawSignals[0];
  record.position.source = 'FICTIONAL_SOURCE_' + 'x'.repeat(160);
  const encoded = JSON.stringify(record);
  const count = Math.ceil(25 * 1024 * 1024 / (Buffer.byteLength(encoded) + 1));
  assert.ok(count <= LIMITS.inputRecords);
  const input = '{"rawSignals":[' + Array(count).fill(encoded).join(',') + ']}';
  assert.ok(Buffer.byteLength(input) >= 25 * 1024 * 1024);
  const result = sanitizeText(input); output(result);
  assert.equal(result.report.processedRecords, count);
  assert.equal(result.report.rawPositions, LIMITS.records);
  assert.equal(result.report.sampledOutRecords, count - LIMITS.records);
  assert.ok(result.report.outputBytes <= LIMITS.outputBytes);
  assert.doesNotMatch(result.text, /FICTIONAL/);
});
test('raw input record limit still stops generation', () => {
  const result = run({ rawSignals: Array(LIMITS.inputRecords + 1).fill(null) });
  assert.equal(result.ok, false); assert.equal(result.text, undefined);
  assert.equal(result.report.reasons.INPUT_LIMIT, 1);
});
