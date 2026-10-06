'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const create = require('../tools/samsung-diagnostics/inspector.js');
const api = create();
const file = (text, name = 'PRIVATE_FILENAME.json', extra = {}) => ({ name, size: Buffer.byteLength(text), text: async () => text, ...extra });
const json = data => file(JSON.stringify(data));
test('nested coordinates, zero, E7, string format and same-record time candidates', async () => {
  const r = await api.inspect([json({ records: [
    { latitude: 0, longitude: 0, start_time: 2208988800000 },
    { latitudeE7: -450000000, longitudeE7: 1800000000, timestamp: '2040-01-01T00:00:00Z' },
    { latLng: 'geo:12.3,45.6', time: '2208988800' },
    { latitude: 91, longitude: 0, time: 0 },
    { lat: 1, lng: 2 }, { timestamp: '2040-01-01 12:00:00' },
  ] })]);
  assert.equal(r.coordinateCandidates, 4); assert.equal(r.timedCandidates, 3);
  assert.equal(r.invalidCoordinates, 1); assert.equal(r.timeCandidates, 5);
});
test('summaries, opaque encoded data and unknown schemas never imply absent GPS', async () => {
  const r = await api.inspect([json({ step_count: 100, calories: 50, extra: '{"latitude":1,"longitude":2,"time":0}',
    unrecognizedPosition: [1, 2, 3] })]);
  assert.equal(r.timedCandidates, 0); assert.ok(r.unknownFields > 0); assert.equal(r.opaqueStrings, 1);
  assert.match(api.format(r), /NO_KNOWN_PAIR/); assert.match(api.format(r), /UNRESOLVED/);
});
test('quoted CSV, version preamble, BOM, CRLF and multiline fields', async () => {
  const r = await api.inspect([file('\uFEFFversion,1\r\nlatitude,longitude,start_time,note\r\n"0","0","2208988800000","line\r\nPRIVATE_VALUE"\r\n', 'PRIVATE.csv')]);
  assert.equal(r.csvFiles, 1); assert.equal(r.timedCandidates, 1);
  assert.doesNotMatch(api.format(r), /PRIVATE|2208988800000|latitude|note/);
});
test('malformed or unknown CSV rolls back candidate counts and reports exclusion', async () => {
  const r = await api.inspect([
    file('latitude,longitude,time\n1,2,0\n"unterminated', 'a.csv'),
    file('PRIVATE_HEADER,steps\n1,2', 'b.csv'), file('latitude,longitude,latitude\n1,2,3', 'c.csv'),
  ]);
  assert.equal(r.parseErrors, 3); assert.equal(r.excludedFiles, 3); assert.equal(r.timedCandidates, 0);
  assert.equal(r.csvSyntaxErrors, 1); assert.equal(r.csvUnknownHeaders, 1); assert.equal(r.csvDuplicateHeaders, 1);
  assert.equal(r.coordinateCandidates, 0); assert.equal(r.csvHeaders, 2);
});

test('summary and reference headers are recognized without inventing observation times', async () => {
  const r = await api.inspect([file('version,1\ncom.samsung.health.create_time,com.samsung.shealth.activity.day_summary.step_count,extra_data\n2208988800000,123,PRIVATE_REFERENCE\n', 'PRIVATE.csv')]);
  assert.equal(r.csvFiles, 1); assert.equal(r.csvRows, 1); assert.equal(r.csvSummaryHeaders, 1);
  assert.equal(r.csvReferenceHeaders, 1); assert.equal(r.csvTimeHeaders, 0); assert.equal(r.timeCandidates, 0);
  assert.equal(r.csvCoordinateHeaders, 0); assert.equal(r.timedCandidates, 0);
  assert.doesNotMatch(api.format(r), /PRIVATE|2208988800000|step_count/);
});

test('namespaced coordinate headers normalize conservatively, including collisions', async () => {
  const r = await api.inspect([file('com.samsung.health.exercise.latitude,com.samsung.health.exercise.longitude,com.samsung.health.start_time\n0,0,2208988800000', 'a.csv')]);
  assert.equal(r.timedCandidates, 1); assert.equal(r.csvCoordinateHeaders, 1); assert.equal(r.csvTimeHeaders, 1);
  const duplicate = await api.inspect([file('latitude,com.samsung.health.latitude\n0,0', 'a.csv')]);
  assert.equal(duplicate.csvDuplicateHeaders, 1);
});

test('CSV width, encoding and syntax failures remain distinct and discard partial values', async () => {
  const r = await api.inspect([
    file('latitude,longitude,start_time\n0,0,2208988800000\n0,0', 'a.csv'),
    file('\u0000latitude,longitude', 'b.csv'), file('\ufffdPRIVATE', 'c.csv'),
    file('PRIVATE,UNKNOWN\n1,2\n3,4\n"unterminated', 'd.csv'),
  ]);
  assert.equal(r.csvWidthErrors, 1); assert.equal(r.csvEncodingErrors, 2); assert.equal(r.csvSyntaxErrors, 1);
  assert.equal(r.csvHeaders, 1); assert.equal(r.csvRows, 0); assert.equal(r.timedCandidates, 0);
  assert.doesNotMatch(JSON.stringify(r) + api.format(r), /PRIVATE|2208988800000/);
});

test('header search is limited to three logical rows and header presence is not data', async () => {
  const r = await api.inspect([
    file('latitude,longitude,start_time', 'a.csv'),
    file('PRIVATE\nPRIVATE\nPRIVATE\nlatitude,longitude,start_time\n0,0,2208988800000', 'b.csv'),
  ]);
  assert.equal(r.csvFiles, 1); assert.equal(r.csvUnknownHeaders, 1); assert.equal(r.csvHeaders, 1);
  assert.equal(r.csvRows, 0); assert.equal(r.timedCandidates, 0);
});

test('CSV row and column limits are reported separately from syntax', async () => {
  const r = await api.inspect([
    file('create_time\n' + '0\n'.repeat(api.limits.csvRows), 'a.csv'),
    file(Array(api.limits.csvColumns + 1).fill('PRIVATE').join(','), 'b.csv'),
  ]);
  assert.equal(r.csvLimitErrors, 2); assert.equal(r.csvSyntaxErrors, 0);
  assert.equal(r.partial, true); assert.equal(r.csvRows, 0);
});
test('CSV failure detail separates blank rows, empty tails and quote states without repair', async () => {
  const cases = [
    ['latitude,longitude\n\n', 'csvBlankRow', 'csvWidthErrors'],
    ['latitude,longitude\n""\n', 'csvEmptyRow', 'csvWidthErrors'],
    ['latitude,longitude,\n0,0', 'csvMissingEmptyHeaderTail', 'csvWidthErrors'],
    ['latitude,longitude\n0', 'csvShortRow', 'csvWidthErrors'],
    ['latitude,longitude\n0,0,PRIVATE', 'csvLongRow', 'csvWidthErrors'],
    ['latitude,longitude\n"PRIVATE', 'csvUnclosedQuote', 'csvSyntaxErrors'],
    ['latitude,longitude\nPRIVATE"TEXT,0', 'csvQuoteInUnquoted', 'csvSyntaxErrors'],
    ['latitude,longitude\n"PRIVATE" ,0', 'csvSpaceAfterQuote', 'csvSyntaxErrors'],
    ['latitude,longitude\n"PRIVATE"TEXT,0', 'csvTextAfterQuote', 'csvSyntaxErrors'],
  ];
  for (const [source, detail, category] of cases) {
    const r = await api.inspect([file(source, 'PRIVATE.csv')]);
    assert.equal(r[detail], 1, detail); assert.equal(r[category], 1, detail);
    assert.equal(cases.reduce((sum, [, key]) => sum + r[key], 0), 1, detail);
    assert.equal(r.inspectedFiles, 0); assert.equal(r.coordinateCandidates, 0);
    assert.doesNotMatch(JSON.stringify(r) + api.format(r), /PRIVATE|latitude|longitude/);
  }
});

test('CSV detail counts only first failure per file and handles CRLF and valid quoted content', async () => {
  const failed = await api.inspect([file('latitude,longitude\r\n0,0\r\n\r\n"PRIVATE', 'a.csv')]);
  assert.equal(failed.csvBlankRow, 1); assert.equal(failed.csvUnclosedQuote, 0);
  assert.equal(failed.csvRows, 0); assert.equal(failed.coordinateCandidates, 0);
  const valid = await api.inspect([file('latitude,longitude,note,\r\n0,0,"PRIVATE,\r\n""TEXT""",\r\n', 'a.csv')]);
  assert.equal(valid.csvFiles, 1); assert.equal(valid.csvRows, 1); assert.equal(valid.coordinateCandidates, 1);
  assert.equal(valid.csvWidthErrors, 0); assert.equal(valid.csvSyntaxErrors, 0);
});

test('surplus empty CSV strings preserve header-aligned values and count files rows cells', async () => {
  const source = 'latitude,longitude,start_time,note\r\n0,0,2208988800000,"PRIVATE,VALUE",,""\r\n1,2,2208988800000,,\r\n';
  const r = await api.inspect([file(source, 'PRIVATE.csv')]);
  assert.equal(r.csvFiles, 1); assert.equal(r.csvRows, 2); assert.equal(r.timedCandidates, 2);
  assert.equal(r.csvTailFiles, 1); assert.equal(r.csvTailRows, 2); assert.equal(r.csvTailCells, 3);
  assert.equal(r.csvWidthErrors, 0); assert.doesNotMatch(api.format(r), /PRIVATE|2208988800000/);
});

test('nonempty surplus, whitespace surplus and missing cells are not repaired; late errors roll back values', async () => {
  for (const suffix of ['0,0,PRIVATE', '0,0, ', '0', 'PRIVATE"TEXT,0']) {
    const r = await api.inspect([file('latitude,longitude\n0,0,\n' + suffix, 'PRIVATE.csv')]);
    assert.equal(r.excludedFiles, 1); assert.equal(r.coordinateCandidates, 0); assert.equal(r.csvRows, 0);
    assert.equal(r.csvTailFiles, 1); assert.equal(r.csvTailRows, 1); assert.equal(r.csvTailCells, 1);
    assert.doesNotMatch(api.format(r), /PRIVATE/);
  }
});

test('empty tails cannot bypass column limits or turn missing coordinates into zero', async () => {
  const r = await api.inspect([file('latitude,longitude\n,,,', 'a.csv')]);
  assert.equal(r.coordinateCandidates, 0); assert.equal(r.invalidCoordinates, 1); assert.equal(r.csvTailCells, 2);
  const bounded = await api.inspect([file('latitude,longitude\n0,0' + ','.repeat(api.limits.csvColumns), 'a.csv')]);
  assert.equal(bounded.csvLimitErrors, 1); assert.equal(bounded.csvTailRows, 0);
});

test('read errors and arbitrary identifiers never appear in output or progress', async () => {
  const progress = [];
  const r = await api.inspect([file('{PRIVATE_RAW'), file('', 'PRIVATE.csv', { text: async () => { throw new Error('PRIVATE_EXCEPTION'); } }),
    json({ PRIVATE_KEY: 'PRIVATE_VALUE', position: { latitude: 'bad PRIVATE', longitude: 2 } })], item => progress.push(item));
  assert.equal(r.readErrors, 1); assert.equal(r.parseErrors, 1);
  assert.doesNotMatch(JSON.stringify(r) + api.format(r) + JSON.stringify(progress), /PRIVATE/);
});
test('limits skip files before reading, cap file count and depth', async () => {
  let reads = 0;
  const big = file('', 'a.json', { size: api.limits.fileBytes + 1, text: async () => { reads++; return '{}'; } });
  const r = await api.inspect([big]); assert.equal(reads, 0); assert.equal(r.limitFiles, 1);
  const many = await api.inspect(Array(api.limits.files + 1).fill(big)); assert.equal(reads, 0); assert.equal(many.inspectedFiles, 0);
  let deep = { latitude: 1, longitude: 2, time: 0 };
  for (let i = 0; i < 60; i++) deep = { child: deep };
  const d = await api.inspect([json(deep)]); assert.equal(d.partial, true); assert.equal(d.timedCandidates, 0);
});
test('cumulative byte and node budgets are bounded across files', async () => {
  const files = Array.from({ length: 9 }, () => file('{}', 'a.json', { size: api.limits.fileBytes }));
  const r = await api.inspect(files); assert.equal(r.inspectedFiles, 8); assert.equal(r.limitFiles, 1);
  const bigArray = file('[' + Array(1000001).fill('0').join(',') + ']');
  const n = await api.inspect([bigArray, json({ latitude: 1, longitude: 2, time: 0 })]);
  assert.equal(n.nodes, api.limits.nodes); assert.equal(n.partial, true); assert.equal(n.limitFiles, 1);
});
test('categories only provide fixed counts, unsupported files are not read', async () => {
  let reads = 0;
  const r = await api.inspect([file('{}', 'PRIVATE.json', { webkitRelativePath: 'PRIVATE/jsons/com.samsung.shealth.exercise/f/PRIVATE.location_data.json' }),
    file('', 'PRIVATE.gpx', { text: async () => { reads++; return 'PRIVATE'; } })]);
  assert.equal(r.exerciseNames, 1); assert.equal(r.routeNames, 1); assert.equal(r.otherFiles, 1); assert.equal(reads, 0);
  assert.doesNotMatch(api.format(r), /PRIVATE/);
});
test('candidate timestamps are explicitly not calendar or epoch validation', async () => {
  const r = await api.inspect([json({ latitude: 1, longitude: 2, timestamp: '2040-99-99T99:99:99Z' })]);
  assert.equal(r.timedCandidates, 1); assert.match(api.format(r), /달력 유효성/);
});
test('offline CSP and source avoid network, persistent storage and data logging', () => {
  const dir = path.join(__dirname, '../tools/samsung-diagnostics');
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.match(html, /connect-src 'none'/); assert.match(html, /worker-src blob:/);
  const scripts = ['inspector.js', 'ui.js'].map(name => fs.readFileSync(path.join(dir, name), 'utf8')).join('\n');
  assert.doesNotMatch(scripts, /fetch\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|indexedDB|console\./);
  assert.match(scripts, /terminate\(\)/); assert.match(scripts, /revokeObjectURL/);
});
