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
    file('calorie,steps\n1,2', 'b.csv'), file('latitude,longitude,latitude\n1,2,3', 'c.csv'),
  ]);
  assert.equal(r.parseErrors, 3); assert.equal(r.excludedFiles, 3); assert.equal(r.timedCandidates, 0);
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
