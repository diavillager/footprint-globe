'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { sanitizeText, formatReport, LIMITS } = require('../tools/timeline-sample/sanitizer.js');
const fixtures = require('./synthetic-fixtures.cjs');
const run = obj => sanitizeText(JSON.stringify(obj));
const parsed = result => { assert.equal(result.ok, true, formatReport(result.report)); return JSON.parse(result.text); };
function sameShape(a, b) {
  assert.equal(typeof a, typeof b);
  if (!a || typeof a !== 'object') return;
  assert.equal(Array.isArray(a), Array.isArray(b));
  assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort());
  for (const key of Object.keys(a)) sameShape(a[key], b[key]);
}
for (const [name, fixture] of Object.entries(fixtures)) {
  test(`${name}: safe small output with identical keys, nesting and JSON types`, () => {
    const original = fixture(), before = JSON.stringify(original);
    const result = run(original), output = parsed(result);
    sameShape(original, output);
    assert.equal(JSON.stringify(original), before);
    assert.ok(result.text.length < LIMITS.outputBytes);
    assert.doesNotMatch(result.text, /FICTIONAL_|2022-|11\.250000|42\.500000|112500000|425000000/);
    assert.doesNotMatch(JSON.stringify(result.report), /FICTIONAL_|2022-|11\.250000/);
    assert.ok(result.report.visits > 0);
    assert.ok(result.report.paths > 0);
  });
}
test('repeated coordinates, place identifiers and route endpoints stay linked', () => {
  const data = parsed(run(fixtures.modern())).semanticSegments;
  const a = data[0].visit.topCandidate, b = data[3].visit.topCandidate;
  assert.equal(a.placeLocation.latLng, data[1].activity.start.latLng);
  assert.equal(a.placeLocation.latLng, data[2].timelinePath[0].point);
  assert.equal(b.placeLocation.latLng, data[1].activity.end.latLng);
  assert.equal(b.placeLocation.latLng, data[2].timelinePath.at(-1).point);
  assert.equal(a.placeId, data[4].visit.topCandidate.placeId);
  assert.notEqual(a.placeId, b.placeId);
});
test('timestamps preserve every instant difference, interval and precision', () => {
  const input = fixtures.modern(), output = parsed(run(input));
  const gather = o => Object.entries(o).flatMap(([k, v]) => typeof v === 'object' ? gather(v) : /^(startTime|endTime|time)$/.test(k) ? [v] : []);
  const a = gather(input), b = gather(output);
  const shift = Date.parse(b[0]) - Date.parse(a[0]);
  assert.notEqual(shift, 0);
  a.forEach((value, i) => {
    assert.equal(Date.parse(b[i]) - Date.parse(value), shift);
    assert.match(b[i], /\.\d{3}\+00:00$/);
  });
  assert.equal(output.semanticSegments[0].startTimeTimezoneUtcOffsetMinutes, 0);
});
test('nanosecond precision and Z suffix survive', () => {
  const data = fixtures.modern();
  data.semanticSegments[0].startTime = '2022-03-01T00:00:00.123456789Z';
  const output = parsed(run(data));
  assert.equal(output.semanticSegments[0].startTime, '2040-01-01T00:00:00.123456789Z');
});
test('numeric and string epoch milliseconds remain synchronized with ISO', () => {
  const data = fixtures.legacy();
  data.timelineObjects[0].placeVisit.duration.endTimestampMs = Number(data.timelineObjects[0].placeVisit.duration.endTimestampMs);
  const d = parsed(run(data)).timelineObjects[0].placeVisit.duration;
  assert.equal(typeof d.startTimestampMs, 'string');
  assert.equal(typeof d.endTimestampMs, 'number');
  assert.equal(Number(d.startTimestampMs), Date.parse(d.startTimestamp));
  assert.equal(d.endTimestampMs, Date.parse(d.endTimestamp));
});
test('legacy coordinate pairs link across all route representations', () => {
  const records = parsed(run(fixtures.legacy())).timelineObjects;
  const visit = records[0].placeVisit, route = records[1].activitySegment;
  assert.equal(visit.location.latitudeE7, visit.centerLatE7);
  assert.equal(visit.location.latitudeE7, route.startLocation.latitudeE7);
  assert.equal(visit.location.longitudeE7, route.waypointPath.waypoints[0].lngE7);
  assert.equal(visit.location.longitudeE7, route.simplifiedRawPath.points[0].lngE7);
});
test('geo strings and relative offsets keep their format and type', () => {
  const a = fixtures.deviceArray(), b = parsed(run(a));
  assert.match(b[0].visit.topCandidate.placeLocation, /^geo:-?\d+\.\d{6},-?\d+\.\d{6}$/);
  a[2].timelinePath.forEach((p, i) => assert.equal(p.durationMinutesOffset, b[2].timelinePath[i].durationMinutesOffset));
});
test('unknown nested fields exclude whole records without reflecting keys or values', () => {
  const data = fixtures.modern();
  data.semanticSegments[0].visit.topCandidate['SECRET_FIELD_CANARY'] = 'SECRET_VALUE_CANARY';
  const result = run(data);
  parsed(result);
  assert.equal(result.report.excludedRecords, 1);
  assert.doesNotMatch(JSON.stringify(result), /SECRET_|FICTIONAL_/);
  assert.ok(result.report.reasons.UNKNOWN_FIELD);
});
test('unknown top-level metadata stops output, even with otherwise valid records', () => {
  const data = fixtures.modern(); data.SECRET_TOP_KEY = 'SECRET_TOP_VALUE';
  const result = run(data);
  assert.equal(result.ok, false); assert.equal(result.text, undefined);
  assert.doesNotMatch(JSON.stringify(result), /SECRET_/);
});
test('unknown fields in path points are never ignored during downsampling', () => {
  const data = fixtures.modern();
  const point = data.semanticSegments[2].timelinePath[0];
  data.semanticSegments[2].timelinePath = Array.from({ length: 80 }, () => ({ ...point }));
  data.semanticSegments[2].timelinePath[1].secret = 'SECRET_UNSAMPLED_VALUE';
  const result = run(data); parsed(result);
  assert.equal(result.report.excludedRecords, 1);
  assert.equal(result.report.paths, 0);
  assert.doesNotMatch(JSON.stringify(result), /SECRET_/);
});
test('bounded sampling keeps representatives and path endpoints', () => {
  const data = fixtures.modern();
  const first = data.semanticSegments[0];
  const route = data.semanticSegments[2];
  route.timelinePath = Array.from({ length: 100 }, (_, i) => ({ point: `${10 + i / 100}°, 45.000°`, durationMinutesOffset: i }));
  data.semanticSegments = [...Array.from({ length: 60 }, () => structuredClone(first)), route, data.semanticSegments[1]];
  const result = run(data), output = parsed(result).semanticSegments;
  assert.equal(output.length, LIMITS.records);
  const p = output.find(r => r.timelinePath).timelinePath;
  assert.equal(p.length, LIMITS.pathPoints);
  assert.equal(p[0].durationMinutesOffset, 0); assert.equal(p.at(-1).durationMinutesOffset, 99);
  assert.equal(result.report.omittedArrayItems, 76);
  assert.equal(result.report.sampledOutRecords, 53);
  assert.ok(result.report.activities && result.report.paths);
});
test('large synthetic export retains late route representatives and bounded output', () => {
  const data = fixtures.modern();
  const visit = JSON.stringify(data.semanticSegments[0]);
  const tail = data.semanticSegments.slice(1, 3).map(record => JSON.stringify(record));
  const records = 65000;
  const input = '{"semanticSegments":[' + Array(records).fill(visit).concat(tail).join(',') + ']}';
  assert.ok(Buffer.byteLength(input) > 24 * 1024 * 1024);
  assert.ok(Buffer.byteLength(input) < LIMITS.inputBytes);
  const result = sanitizeText(input);
  const output = parsed(result).semanticSegments;
  assert.equal(result.report.processedRecords, records + 2);
  assert.equal(result.report.sampledOutRecords, records + 2 - LIMITS.records);
  assert.equal(result.report.excludedRecords, 0);
  assert.equal(output.length, LIMITS.records);
  assert.equal(result.report.activities, 1);
  assert.equal(result.report.paths, 1);
  assert.ok(result.report.outputBytes < LIMITS.outputBytes);
});
for (const [name, value] of [['latitude range', '91°, 0°'], ['longitude range', '0°, 181°'], ['embedded text', 'geo:1,2 SECRET'], ['HTML', '<img src=SECRET>'], ['wrong type', null]]) {
  test(`invalid coordinate: ${name} excluded`, () => {
    const data = fixtures.modern(); data.semanticSegments[0].visit.topCandidate.placeLocation = value;
    const result = run(data); parsed(result);
    assert.equal(result.report.excludedRecords, 1);
    assert.doesNotMatch(JSON.stringify(result), /SECRET/);
  });
}
for (const bad of ['2022-02-30T00:00:00Z', '2022-01-01T24:00:00Z', '2022-01-01T01:00:00+15:00', '2022-01-01', 'SECRET_TIME']) {
  test(`invalid synthetic date rejected: ${bad}`, () => {
    const data = fixtures.modern(); data.semanticSegments[0].startTime = bad;
    const result = run(data); parsed(result);
    assert.equal(result.report.excludedRecords, 1);
  });
}
test('zero coordinates and dateline endpoints stay valid without preserving geography', () => {
  const data = fixtures.modern();
  data.semanticSegments[0].visit.topCandidate.placeLocation.latLng = '0°, 0°';
  data.semanticSegments[1].activity.start.latLng = '89°, 180°';
  data.semanticSegments[1].activity.end.latLng = '-90°, -180°';
  const output = parsed(run(data));
  for (const coordinate of [output.semanticSegments[0].visit.topCandidate.placeLocation.latLng, output.semanticSegments[1].activity.start.latLng, output.semanticSegments[1].activity.end.latLng]) {
    const [lat, lng] = coordinate.replaceAll('°', '').split(',').map(Number);
    assert.ok(Math.abs(lat) <= 90 && Math.abs(lng) <= 180);
  }
});
test('fallback if original earliest time is already the synthetic epoch', () => {
  const data = fixtures.modern();
  const shifted = JSON.parse(JSON.stringify(data).replaceAll('2022-03-01', '2040-01-01').replaceAll('+09:00', 'Z'));
  shifted.semanticSegments[0].startTime = '2040-01-01T00:00:00.123Z';
  const text = JSON.stringify(shifted);
  const result = sanitizeText(text); parsed(result);
  assert.equal(JSON.parse(result.text).semanticSegments[0].startTime, '2041-01-01T00:00:00.123Z');
});
test('negative timezone and mixed precision preserve time intervals across days', () => {
  const data = fixtures.modern();
  data.semanticSegments[0].startTime = '2022-02-28T15:00:00-09:00';
  data.semanticSegments[0].endTime = '2022-02-28T16:00:00.1-09:00';
  const result = parsed(run(data));
  const a = data.semanticSegments[0], b = result.semanticSegments[0];
  assert.equal(Date.parse(a.endTime) - Date.parse(a.startTime), Date.parse(b.endTime) - Date.parse(b.startTime));
  assert.match(b.startTime, /T\d{2}:\d{2}:\d{2}-00:00$/);
  assert.match(b.endTime, /\.1-00:00$/);
});
test('an invented coordinate equal to an original pair is remapped without breaking links', () => {
  const data = fixtures.modern();
  data.semanticSegments[0].visit.topCandidate.placeLocation.latLng = '-55°, -145°';
  data.semanticSegments[1].activity.start.latLng = '-55°, -145°';
  const output = parsed(run(data)).semanticSegments;
  assert.notEqual(output[0].visit.topCandidate.placeLocation.latLng, '-55°, -145°');
  assert.equal(output[0].visit.topCandidate.placeLocation.latLng, output[1].activity.start.latLng);
});
test('an identifier already resembling a generated identifier is still replaced', () => {
  const data = fixtures.modern();
  data.semanticSegments[0].visit.topCandidate.placeId = 'synthetic-id-0001';
  const output = parsed(run(data));
  assert.notEqual(output.semanticSegments[0].visit.topCandidate.placeId, 'synthetic-id-0001');
});
test('unrecognized identifying numbers, boolean flags and arrays exclude the whole record', () => {
  for (const value of [123456789, true, ['SECRET_DEVICE'], { email: 'SECRET_EMAIL' }]) {
    const data = fixtures.modern();
    data.semanticSegments[0].deviceTag = value;
    const result = run(data); parsed(result);
    assert.equal(result.report.excludedRecords, 1);
    assert.doesNotMatch(JSON.stringify(result), /123456789|SECRET_DEVICE|SECRET_EMAIL|deviceTag/);
  }
});
test('inverted duration and inconsistent ISO/epoch pairs are excluded', () => {
  const data = fixtures.legacy();
  data.timelineObjects[0].placeVisit.duration.endTimestampMs = '0';
  const result = run(data); parsed(result);
  assert.equal(result.report.excludedRecords, 1);
  assert.ok(result.report.reasons.INVALID_TIME);
  const other = fixtures.modern();
  other.semanticSegments[0].endTime = '2000-01-01T00:00:00Z';
  assert.equal(run(other).report.excludedRecords, 1);
});
test('no output without safe visits and movements', () => {
  for (const value of [{ semanticSegments: [] }, { semanticSegments: [fixtures.modern().semanticSegments[0]] }, { locations: [] }, null, { timelineObjects: [{}] }]) {
    const result = run(value); assert.equal(result.ok, false); assert.equal(result.text, undefined);
  }
});
test('malformed JSON, prototype-like keys and oversized input never echo data', () => {
  for (const text of ['{"SECRET_VALUE":', '{"__proto__":{"SECRET":1}}', ' '.repeat(LIMITS.inputBytes + 1)]) {
    const result = sanitizeText(text);
    assert.equal(result.ok, false); assert.equal(result.text, undefined);
    assert.doesNotMatch(JSON.stringify(result), /SECRET|__proto__/);
  }
});
test('HTML forbids network connections and has only local executable assets', () => {
  const html = fs.readFileSync(path.join(__dirname, '../tools/timeline-sample/index.html'), 'utf8');
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /default-src 'none'/);
  assert.doesNotMatch(html, /https?:\/\//);
  for (const file of ['ui.js', 'sanitizer.js']) {
    const js = fs.readFileSync(path.join(__dirname, '../tools/timeline-sample', file), 'utf8');
    assert.doesNotMatch(js, /\b(fetch|XMLHttpRequest|WebSocket|sendBeacon|localStorage|indexedDB)\b|console\./);
  }
});
test('UI selects a synthetic file, reports only metadata and downloads safe output', async () => {
  const handlers = {}, elements = {};
  for (const id of ['source', 'save', 'status']) elements[id] = { addEventListener(event, fn) { handlers[`${id}:${event}`] = fn; }, disabled: true, value: 'SYNTHETIC_FILENAME_CANARY' };
  let savedBlob, downloadName, clicked = false;
  const api = require('../tools/timeline-sample/sanitizer.js');
  const sandbox = { TimelineSample: api, Blob, URL: { createObjectURL(blob) { savedBlob = blob; return 'blob:synthetic'; }, revokeObjectURL() {} },
    setTimeout(fn) { fn(); }, document: { getElementById(id) { return elements[id]; }, createElement() { return { set download(name) { downloadName = name; }, click() { clicked = true; } }; } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../tools/timeline-sample/ui.js'), 'utf8'), sandbox);
  elements.source.files = [{ size: 2000, async text() { return JSON.stringify(fixtures.modern()); } }];
  await handlers['source:change']();
  assert.equal(elements.source.value, ''); assert.equal(elements.save.disabled, false);
  assert.doesNotMatch(elements.status.textContent, /CANARY|FICTIONAL|2022/);
  handlers['save:click']();
  assert.equal(clicked, true); assert.equal(downloadName, 'timeline.synthetic.sample.json');
  assert.doesNotMatch(await savedBlob.text(), /FICTIONAL|CANARY/);
  elements.source.files = [{ size: 1, async text() { throw new Error('SECRET_ERROR'); } }];
  await handlers['source:change']();
  assert.equal(elements.save.disabled, true);
  assert.doesNotMatch(elements.status.textContent, /SECRET_ERROR/);
  assert.match(elements.status.textContent, /FILE_READ_FAILED/);
  let oversizedRead = false;
  elements.source.files = [{ size: LIMITS.inputBytes + 1024, async text() { oversizedRead = true; return 'SECRET_OVERSIZED'; } }];
  await handlers['source:change']();
  assert.equal(oversizedRead, false);
  assert.equal(elements.save.disabled, true);
  assert.match(elements.status.textContent, /FILE_TOO_LARGE/);
  assert.match(elements.status.textContent, /64\.0 MiB/);
  assert.doesNotMatch(elements.status.textContent, /SECRET/);
  sandbox.TimelineSample = undefined;
  await handlers['source:change']();
  assert.match(elements.status.textContent, /TOOL_NOT_LOADED/);
  assert.equal(oversizedRead, false);
  sandbox.TimelineSample = { LIMITS, sanitizeText() { throw new Error('SECRET_PROCESSING'); } };
  elements.source.files = [{ size: 1, async text() { return '{}'; } }];
  await handlers['source:change']();
  assert.match(elements.status.textContent, /PROCESSING_FAILED/);
  assert.doesNotMatch(elements.status.textContent, /SECRET/);
});
