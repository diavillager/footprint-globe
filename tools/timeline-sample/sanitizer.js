/* Offline, allowlist-only Timeline sample generator. No IO and no logging. */
'use strict';
(function (root) {
  const LIMITS = Object.freeze({ inputBytes: 64 * 1024 * 1024, records: 9, pathPoints: 24, outputBytes: 64 * 1024, inputRecords: 100000, arrayItems: 20000 });
  const TAG = Symbol('internal-template');
  const NS = 1000000000n;
  const FAKE_EPOCH_SECONDS = BigInt(Date.UTC(2040, 0, 1) / 1000);
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const isObject = o => o !== null && typeof o === 'object' && !Array.isArray(o);
  const fail = code => { throw new Error(code); };
  const token = (kind, data) => ({ [TAG]: kind, ...data });
  const S = kind => ({ kind });
  const O = (fields, required = []) => ({ kind: 'object', fields, required });
  const A = item => ({ kind: 'array', item });
  const text = S('text'), id = S('id'), number = S('number'), probability = S('probability');
  const iso = S('iso'), millis = S('millis'), coordinate = S('coordinate'), relative = S('relative');
  const neutral = value => ({ kind: 'enum', value });
  const coordFields = { latitudeE7: S('pair'), longitudeE7: S('pair') };
  const pointFields = { latE7: S('pair'), lngE7: S('pair') };
  const location = O({ ...coordFields, name: text, address: text, placeId: id, accuracy: number, locationConfidence: number }, ['latitudeE7', 'longitudeE7']);
  const deviceLocation = { kind: 'locationUnion', object: O({ latLng: coordinate }, ['latLng']) };
  const candidate = O({ placeId: id, semanticType: neutral('UNKNOWN'), placeLocation: deviceLocation, name: text, address: text, probability }, ['placeLocation']);
  const visit = O({ hierarchyLevel: number, probability, topCandidate: candidate }, ['topCandidate']);
  const activityCandidate = O({ type: neutral('UNKNOWN_ACTIVITY_TYPE'), probability });
  const activity = O({ start: deviceLocation, end: deviceLocation, distanceMeters: number, topCandidate: activityCandidate }, ['start', 'end']);
  const timelinePoint = O({ point: coordinate, time: iso, durationMinutesOffset: relative }, ['point']);
  const deviceRecord = O({
    startTime: iso, endTime: iso,
    startTimeTimezoneUtcOffsetMinutes: S('zone'), endTimeTimezoneUtcOffsetMinutes: S('zone'),
    visit, activity, timelinePath: A(timelinePoint)
  }, ['startTime', 'endTime']);
  const duration = O({ startTimestamp: iso, endTimestamp: iso, startTimestampMs: millis, endTimestampMs: millis });
  const legacyVisit = O({ location, duration, placeConfidence: neutral('LOW_CONFIDENCE'), visitConfidence: number,
    centerLatE7: S('pair'), centerLngE7: S('pair'), placeVisitType: neutral('UNKNOWN'),
    editConfirmationStatus: neutral('NOT_CONFIRMED'), childVisits: A(O({ location, duration }, ['location', 'duration']))
  }, ['location', 'duration']);
  const waypoint = O({ ...pointFields }, ['latE7', 'lngE7']);
  const rawPoint = O({ ...pointFields, timestamp: iso, timestampMs: millis, accuracyMeters: number }, ['latE7', 'lngE7']);
  const legacyActivity = O({
    startLocation: location, endLocation: location, duration, distance: number,
    activityType: neutral('UNKNOWN_ACTIVITY_TYPE'), confidence: neutral('LOW'),
    activities: A(O({ activityType: neutral('UNKNOWN_ACTIVITY_TYPE'), probability }, ['activityType'])),
    waypointPath: O({ waypoints: A(waypoint), source: neutral('UNKNOWN'), distanceMeters: number, travelMode: neutral('UNKNOWN') }, ['waypoints']),
    simplifiedRawPath: O({ points: A(rawPoint), source: neutral('UNKNOWN') }, ['points'])
  }, ['startLocation', 'endLocation', 'duration']);
  const legacyRecord = O({ placeVisit: legacyVisit, activitySegment: legacyActivity });
  const rawPosition = O({ LatLng: coordinate, latLng: coordinate, timestamp: iso,
    accuracyMeters: number, altitudeMeters: number, speedMetersPerSecond: number, source: neutral('UNKNOWN')
  }, ['timestamp']);
  const rawSignal = O({ position: rawPosition }, ['position']);

  // Structural diagnosis is not a parser and never authorizes sample generation.
  // Only these fixed field names, JSON types and aggregate counts can leave it.
  const DIAGNOSTIC_FIELDS = Object.freeze(['semanticSegments', 'timelineObjects', 'locations', 'rawSignals', 'timelineEdits',
    'visit', 'activity', 'timelinePath', 'placeVisit', 'activitySegment', 'latitudeE7', 'longitudeE7', 'timestampMs', 'startTime', 'endTime',
    'position', 'LatLng', 'latLng', 'timestamp', 'wifiScan', 'activityRecord']);
  const valueType = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  const emptyTypes = () => ({ object: 0, array: 0, string: 0, number: 0, boolean: 0, null: 0 });
  function diagnoseStructure(data) {
    const info = { version: 1, topLevelTypes: emptyTypes(), knownFields: Object.create(null), scannedNodes: 0,
      scanLimited: false, recordShapes: { semantic: 0, legacy: 0, rawCoordinate: 0 }, hints: [] };
    const rootKeys = isObject(data) ? Object.keys(data) : [];
    for (const key of rootKeys) info.topLevelTypes[valueType(data[key])]++;
    function* children(node) {
      if (Array.isArray(node)) { for (const child of node) yield child; }
      else { for (const key of Object.keys(node)) yield node[key]; }
    }
    const stack = [{ iterator: [data][Symbol.iterator](), depth: 0 }];
    while (stack.length && info.scannedNodes < 12000) {
      const frame = stack[stack.length - 1], next = frame.iterator.next();
      if (next.done) { stack.pop(); continue; }
      info.scannedNodes++;
      const node = next.value;
      if (node === null || typeof node !== 'object') continue;
      if (isObject(node)) {
        for (const key of DIAGNOSTIC_FIELDS) {
          if (!own(node, key)) continue;
          if (!own(info.knownFields, key)) info.knownFields[key] = { root: 0, nested: 0, types: emptyTypes() };
          const field = info.knownFields[key];
          field[frame.depth === 0 ? 'root' : 'nested']++;
          field.types[valueType(node[key])]++;
        }
        if (own(node, 'startTime') && own(node, 'endTime') && ['visit', 'activity', 'timelinePath'].some(key => own(node, key))) info.recordShapes.semantic++;
        if (own(node, 'placeVisit') || own(node, 'activitySegment')) info.recordShapes.legacy++;
        if (own(node, 'latitudeE7') && own(node, 'longitudeE7')) info.recordShapes.rawCoordinate++;
      }
      if (frame.depth >= 10) { info.scanLimited = true; continue; }
      stack.push({ iterator: children(node), depth: frame.depth + 1 });
    }
    if (stack.length) info.scanLimited = true;
    if (['semanticSegments', 'timelineObjects'].some(key => info.knownFields[key]?.nested)) info.hints.push('NESTED_RECORD_FIELD');
    if (info.knownFields.locations || info.recordShapes.rawCoordinate) info.hints.push('RAW_COORDINATE_STRUCTURE');
    if (info.knownFields.timelineEdits) info.hints.push('TIMELINE_EDITS_STRUCTURE');
    if (info.knownFields.rawSignals) info.hints.push('RAW_SIGNALS_STRUCTURE');
    if (!info.hints.length) info.hints.push('NO_RECOGNIZED_CONTAINER');
    return info;
  }
  const DIAGNOSTIC_HINTS = Object.freeze({
    NESTED_RECORD_FIELD: '알려진 기록 필드가 중첩되어 있습니다. 현재 변환기는 이 바깥 구조를 지원하지 않습니다.',
    RAW_COORDINATE_STRUCTURE: '원시 좌표 형태의 필드가 발견됐습니다. 이를 방문 기록으로 추론하지 않습니다.',
    TIMELINE_EDITS_STRUCTURE: '편집 기록 형태의 필드가 발견됐습니다. 현재 변환기의 지원 대상은 아닙니다.',
    RAW_SIGNALS_STRUCTURE: '원시 신호 필드가 발견됐습니다. 허용한 위치 관측 구조만 샘플로 만들 수 있습니다.',
    NO_RECOGNIZED_CONTAINER: '검사 범위에서 알려진 기록 컨테이너를 확인하지 못했습니다. 원본 값을 추측해 복사하지 않습니다.'
  });

  function parseISO(value) {
    if (typeof value !== 'string') fail('INVALID_TIME');
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (!match) fail('INVALID_TIME');
    const [, y, mo, d, h, mi, s, fraction = '', zone] = match;
    if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31 || +h > 23 || +mi > 59 || +s > 59) fail('INVALID_TIME');
    const base = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}.000Z`);
    if (!Number.isFinite(base.getTime()) || base.toISOString().slice(0, 19) !== value.slice(0, 19)) fail('INVALID_TIME');
    let offset = 0;
    if (zone !== 'Z') {
      const zh = +zone.slice(1, 3), zm = +zone.slice(4, 6);
      if (zh > 14 || zm > 59 || (zh === 14 && zm !== 0)) fail('INVALID_TIME');
      offset = (zh * 60 + zm) * 60 * (zone[0] === '-' ? -1 : 1);
    }
    return token('time', { ns: (BigInt(base.getTime() / 1000) - BigInt(offset)) * NS + BigInt(fraction.padEnd(9, '0')), style: 'iso', fraction: fraction.length, zone });
  }

  function parseMillis(value) {
    if (!(typeof value === 'number' && Number.isSafeInteger(value)) && !(typeof value === 'string' && /^-?(0|[1-9]\d*)$/.test(value))) fail('INVALID_TIME');
    const ms = Number(value);
    if (!Number.isSafeInteger(ms) || !Number.isFinite(new Date(ms).getTime())) fail('INVALID_TIME');
    return token('time', { ns: BigInt(value) * 1000000n, style: 'millis', string: typeof value === 'string' });
  }

  function validCoord(lat, lng) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) fail('INVALID_COORDINATE');
    return `${Object.is(lat, -0) ? 0 : lat},${Object.is(lng, -0) ? 0 : lng}`;
  }

  function parseCoordinate(value) {
    if (typeof value !== 'string') fail('INVALID_COORDINATE');
    // Restrict separators to ordinary spaces; nothing arbitrary can be copied into output.
    const m = /^(geo:)?([+-]?\d{1,3}(?:\.\d{1,9})?)(°?),( *)([+-]?\d{1,3}(?:\.\d{1,9})?)(°?)$/.exec(value);
    if (!m || m[3] !== m[6] || (m[1] && m[3])) fail('INVALID_COORDINATE');
    const key = validCoord(Number(m[2]), Number(m[5]));
    const precision = s => (s.split('.')[1] || '').length;
    return token('coordText', { key, prefix: m[1] || '', degrees: m[3], spaces: m[4], latDigits: precision(m[2]), lngDigits: precision(m[5]), latPlus: m[2][0] === '+', lngPlus: m[5][0] === '+' });
  }

  function indices(length, max) {
    if (length <= max) return Array.from({ length }, (_, i) => i);
    return Array.from({ length: max }, (_, i) => Math.round(i * (length - 1) / (max - 1)));
  }

  function walk(value, schema, counts, depth = 0) {
    if (depth > 20) fail('STRUCTURE_LIMIT');
    switch (schema.kind) {
      case 'object': {
        if (!isObject(value)) fail('INVALID_STRUCTURE');
        if (Object.keys(value).some(k => !own(schema.fields, k))) fail('UNKNOWN_FIELD');
        if (schema.required.some(k => !own(value, k))) fail('MISSING_FIELD');
        const result = Object.create(null);
        const pairs = [['latitudeE7', 'longitudeE7'], ['latE7', 'lngE7'], ['centerLatE7', 'centerLngE7']];
        for (const [latKey, lngKey] of pairs) {
          if (own(value, latKey) || own(value, lngKey)) {
            if (!Number.isInteger(value[latKey]) || !Number.isInteger(value[lngKey])) fail('INVALID_COORDINATE');
            const key = validCoord(value[latKey] / 1e7, value[lngKey] / 1e7);
            result[latKey] = token('coordNumber', { key, axis: 0 });
            result[lngKey] = token('coordNumber', { key, axis: 1 });
          }
        }
        for (const key of Object.keys(value)) {
          if (schema.fields[key].kind === 'pair') continue;
          result[key] = walk(value[key], schema.fields[key], counts, depth + 1);
        }
        return result;
      }
      case 'array': {
        if (!Array.isArray(value) || value.length > LIMITS.arrayItems) fail('STRUCTURE_LIMIT');
        // Validate every retained record's array element, even those later downsampled.
        const checked = value.map(v => walk(v, schema.item, counts, depth + 1));
        const selected = indices(checked.length, LIMITS.pathPoints);
        counts.omittedArrayItems += checked.length - selected.length;
        return selected.map(i => checked[i]);
      }
      case 'locationUnion': return typeof value === 'string' ? parseCoordinate(value) : walk(value, schema.object, counts, depth + 1);
      case 'coordinate': return parseCoordinate(value);
      case 'iso': return parseISO(value);
      case 'millis': return parseMillis(value);
      case 'text': case 'id':
        if (typeof value !== 'string' || value.length > 4096) fail('INVALID_VALUE');
        return token('string', { category: schema.kind, key: value });
      case 'enum':
        if (typeof value !== 'string' || value.length > 256) fail('INVALID_VALUE');
        return schema.value;
      case 'number': case 'probability':
        if (typeof value !== 'number' || !Number.isFinite(value)) fail('INVALID_VALUE');
        return schema.kind === 'probability' ? 0.5 : 0;
      case 'zone':
        if (!Number.isInteger(value) || Math.abs(value) > 840) fail('INVALID_TIME');
        return 0;
      case 'relative':
        // Relative elapsed time is deliberately preserved, just like visit durations.
        if (!((typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value))) || Number(value) < 0 || Number(value) > 5256000) fail('INVALID_TIME');
        return value;
      default: fail('INVALID_STRUCTURE');
    }
  }

  function visitTokens(value, callback) {
    if (!value || typeof value !== 'object') return;
    if (value[TAG]) { callback(value); return; }
    for (const item of Object.values(value)) visitTokens(item, callback);
  }

  function timeRange(obj, legacy) {
    const start = legacy ? obj.startTimestamp || obj.startTimestampMs : obj.startTime;
    const end = legacy ? obj.endTimestamp || obj.endTimestampMs : obj.endTime;
    if (!start || !end || start.ns > end.ns) fail('INVALID_TIME');
    if (legacy && ((obj.startTimestamp && obj.startTimestampMs && obj.startTimestamp.ns !== obj.startTimestampMs.ns) || (obj.endTimestamp && obj.endTimestampMs && obj.endTimestamp.ns !== obj.endTimestampMs.ns))) fail('INVALID_TIME');
  }

  function classify(record, legacy) {
    const kinds = [];
    if (legacy) {
      if (record.placeVisit) { timeRange(record.placeVisit.duration, true); kinds.push('visit'); }
      if (record.activitySegment) { timeRange(record.activitySegment.duration, true); kinds.push('activity'); }
      if (record.activitySegment?.waypointPath?.waypoints.length >= 2 || record.activitySegment?.simplifiedRawPath?.points.length >= 2) kinds.push('path');
      for (const child of record.placeVisit?.childVisits || []) timeRange(child.duration, true);
    } else {
      timeRange(record, false);
      if (record.visit) kinds.push('visit');
      if (record.activity) kinds.push('activity');
      if (record.timelinePath) {
        if (record.timelinePath.length < 2) fail('INCOMPLETE_PATH');
        for (const point of record.timelinePath) if (!point.time && !own(point, 'durationMinutesOffset')) fail('MISSING_FIELD');
        kinds.push('path');
      }
    }
    if (!kinds.length) fail('UNSUPPORTED_RECORD');
    return kinds;
  }

  function render(records) {
    let min = null;
    visitTokens(records, t => { if (t[TAG] === 'time' && (min === null || t.ns < min)) min = t.ns; });
    if (min === null) fail('INVALID_TIME');
    // Whole-second translation preserves the precision of every timestamp and all intervals.
    const floorSeconds = min >= 0n ? min / NS : (min - NS + 1n) / NS;
    let shift = FAKE_EPOCH_SECONDS - floorSeconds;
    // Even inputs already near the invented epoch must change calendar dates.
    if (shift > -172800n && shift < 172800n) shift += 86400n * 366n;
    const coords = new Map(), strings = new Map();
    const lookupCoord = key => {
      if (!coords.has(key)) {
        const index = coords.size;
        if (index >= 10000) fail('STRUCTURE_LIMIT');
        // Entirely invented grid, unrelated to original geography. Integer degrees
        // can be expressed losslessly even in strings with zero decimal places.
        let fake = [-55 + index % 101, -145 + Math.floor(index / 101)];
        // Never leave a coordinate equal to its original by coincidence.
        if (`${fake[0]},${fake[1]}` === key) fake = [fake[0], fake[1] + 180];
        coords.set(key, fake);
      }
      return coords.get(key);
    };
    const decimal = (n, digits, plus) => `${n >= 0 && plus ? '+' : ''}${n.toFixed(digits)}`;
    const convert = value => {
      if (!value || typeof value !== 'object') return value;
      switch (value[TAG]) {
        case 'time': {
          const ns = value.ns + shift * NS;
          if (value.style === 'millis') {
            const ms = ns / 1000000n;
            if (!Number.isSafeInteger(Number(ms))) fail('INVALID_TIME');
            return value.string ? ms.toString() : Number(ms);
          }
          const seconds = ns / NS, fraction = ns % NS;
          const date = new Date(Number(seconds) * 1000);
          if (!Number.isFinite(date.getTime())) fail('INVALID_TIME');
          const stamp = date.toISOString();
          if (stamp.length !== 24) fail('INVALID_TIME');
          const suffix = value.zone === 'Z' ? 'Z' : `${value.zone[0]}00:00`;
          return stamp.slice(0, 19) + (value.fraction ? '.' + fraction.toString().padStart(9, '0').slice(0, value.fraction) : '') + suffix;
        }
        case 'coordText': {
          const [lat, lng] = lookupCoord(value.key);
          return value.prefix + decimal(lat, value.latDigits, value.latPlus) + value.degrees + ',' + value.spaces + decimal(lng, value.lngDigits, value.lngPlus) + value.degrees;
        }
        case 'coordNumber': return lookupCoord(value.key)[value.axis] * 1e7;
        case 'string': {
          const key = `${value.category}:${value.key}`;
          if (!strings.has(key)) {
            let replacement = `synthetic-${value.category}-${String(strings.size + 1).padStart(4, '0')}`;
            if (replacement === value.key) replacement += '-fictional';
            strings.set(key, replacement);
          }
          return strings.get(key);
        }
        default: {
          if (Array.isArray(value)) return value.map(convert);
          const output = Object.create(null);
          for (const key of Object.keys(value)) output[key] = convert(value[key]);
          return output;
        }
      }
    };
    const output = convert(records);
    return { output, coordinatePairs: coords.size };
  }

  const REASONS = Object.freeze({
    INVALID_JSON: 'JSON 구문이 올바르지 않습니다.', INPUT_LIMIT: '입력 크기 또는 기록 수 제한을 초과했습니다.',
    UNSUPPORTED_ROOT: '최상위에서 지원하는 기록 배열을 찾지 못했습니다. 임의의 중첩 구조는 추측해서 처리하지 않습니다.',
    AMBIGUOUS_ROOT: '서로 다른 기록 형식이 함께 있어 처리 대상을 안전하게 결정할 수 없습니다.',
    ROOT_FIELD_TYPE: '지원하는 기록 필드가 있지만 배열 자료형이 아닙니다.',
    EXCLUDED_ROOT_FIELD: '지원하는 기록 배열 외의 최상위 필드는 안전하게 치환할 수 없어 통째로 제외했습니다. 이름과 값은 표시하지 않습니다.',
    UNKNOWN_FIELD: '허용 목록에 없는 필드가 있어 해당 기록을 제외했습니다.',
    INVALID_STRUCTURE: '필드의 중첩 구조나 자료형이 지원 범위와 다릅니다.',
    MISSING_FIELD: '안전한 변환에 필요한 필드가 없습니다.', INVALID_TIME: '시간 형식 또는 시간 관계를 안전하게 처리할 수 없습니다.',
    INVALID_COORDINATE: '좌표 형식 또는 범위를 안전하게 처리할 수 없습니다.', INVALID_VALUE: '필드 자료형이나 값의 범위가 지원 범위와 다릅니다.',
    STRUCTURE_LIMIT: '중첩 구조 또는 배열 크기 제한을 초과했습니다.', INCOMPLETE_PATH: '이동 경로의 지점이 충분하지 않습니다.',
    UNSUPPORTED_RECORD: '지원하는 방문 또는 이동 기록이 아닙니다.',
    UNSUPPORTED_RAW_SIGNAL: '위치 관측값이 아닌 원시 신호는 샘플 대상에서 제외했습니다.',
    NO_SAFE_RAW_POSITION: '안전하게 변환할 수 있는 원시 위치 관측값이 없습니다. 방문지나 경로를 추론하지 않습니다.',
    INSUFFICIENT_COVERAGE: '방문 기록과 이동 기록을 모두 안전하게 포함할 수 없습니다.', OUTPUT_LIMIT: '샘플 출력 크기 제한을 초과했습니다.',
    INTERNAL_FAILURE: '안전한 변환을 완료하지 못했습니다.'
  });
  function sanitizeText(input) {
    const report = { format: '미판별', rootType: '미판별', knownRootFields: { semanticSegments: '없음', timelineObjects: '없음', rawSignals: '없음' }, excludedRootFields: 0, inputRecords: 0, processedRecords: 0, excludedRecords: 0, sampledOutRecords: 0, outputRecords: 0, visits: 0, activities: 0, paths: 0, rawPositions: 0, omittedArrayItems: 0, coordinatePairs: 0, outputBytes: 0, reasons: Object.create(null), warnings: ['시간 간격·체류 기간·필드 구조는 남습니다.', '가상 좌표는 원본 경로의 모양·거리·방향을 보존하지 않습니다.', '시간대·장소·식별자·보조 속성은 가상 값으로 바뀝니다.'] };
    const reason = code => { const safe = own(REASONS, code) ? code : 'INTERNAL_FAILURE'; report.reasons[safe] = (report.reasons[safe] || 0) + 1; };
    try {
      if (typeof input !== 'string' || new TextEncoder().encode(input).length > LIMITS.inputBytes) fail('INPUT_LIMIT');
      let data;
      try { data = JSON.parse(input.replace(/^\uFEFF/, '')); } catch { fail('INVALID_JSON'); }
      const rootFailure = code => { report.structure = diagnoseStructure(data); fail(code); };
      let records, rootKey, legacy = false, rawMode = false;
      report.rootType = Array.isArray(data) ? '배열' : isObject(data) ? '객체' : '기타';
      if (Array.isArray(data)) { records = data; report.format = '기기 Timeline 배열'; }
      else if (isObject(data)) {
        // Only fixed, allowlisted names reach diagnostics. Never reflect unknown
        // keys (which can themselves contain personal data), or traverse their values.
        const present = ['semanticSegments', 'timelineObjects'].filter(key => own(data, key));
        if (own(data, 'rawSignals')) report.knownRootFields.rawSignals = Array.isArray(data.rawSignals) ? '배열' : '배열 아님';
        for (const key of present) report.knownRootFields[key] = Array.isArray(data[key]) ? '배열' : '배열 아님';
        if (present.length > 1) rootFailure('AMBIGUOUS_ROOT');
        if (!present.length && own(data, 'rawSignals')) { present.push('rawSignals'); rawMode = true; }
        if (!present.length) rootFailure('UNSUPPORTED_ROOT');
        rootKey = present[0];
        if (!Array.isArray(data[rootKey])) rootFailure('ROOT_FIELD_TYPE');
        records = data[rootKey]; legacy = rootKey === 'timelineObjects'; report.format = rootKey;
        report.excludedRootFields = Object.keys(data).length - 1;
        if (report.excludedRootFields) report.reasons.EXCLUDED_ROOT_FIELD = report.excludedRootFields;
      } else rootFailure('UNSUPPORTED_ROOT');
      report.inputRecords = records.length;
      if (rawMode) report.warnings.push('원시 위치 관측값만 포함하는 샘플입니다. 방문 정보와 확정 이동 경로는 포함하지 않으며 새로 추론하지 않습니다.');
      if (records.length > LIMITS.inputRecords) fail('INPUT_LIMIT');
      const valid = [];
      const represented = new Set();
      for (let i = 0; i < records.length; i++) {
        try {
          const counts = { omittedArrayItems: 0 };
          if (rawMode && (!isObject(records[i]) || !own(records[i], 'position'))) fail('UNSUPPORTED_RAW_SIGNAL');
          const template = walk(records[i], rawMode ? rawSignal : legacy ? legacyRecord : deviceRecord, counts);
          if (rawMode && ['LatLng', 'latLng'].filter(key => own(template.position, key)).length !== 1) fail('INVALID_COORDINATE');
          const kinds = rawMode ? ['rawPosition'] : classify(template, legacy);
          report.processedRecords++;
          // Retain only the first records and first representative of each kind.
          // Still validate every input record, without keeping every template alive.
          if (report.processedRecords <= LIMITS.records || kinds.some(kind => !represented.has(kind))) {
            valid.push({ template, kinds, counts, index: i });
          }
          kinds.forEach(kind => represented.add(kind));
        } catch (error) { report.excludedRecords++; reason(error.message); }
      }
      // Include representatives of all available supported record kinds first.
      const chosen = new Set();
      for (const kind of rawMode ? ['rawPosition'] : ['visit', 'activity', 'path']) {
        const candidate = valid.find(v => v.kinds.includes(kind));
        if (candidate) chosen.add(candidate);
      }
      for (const record of valid) { if (chosen.size >= LIMITS.records) break; chosen.add(record); }
      const selected = [...chosen].sort((a, b) => a.index - b.index);
      const kinds = selected.flatMap(v => v.kinds);
      if (rawMode) {
        if (!kinds.includes('rawPosition')) { report.structure = diagnoseStructure(data); fail('NO_SAFE_RAW_POSITION'); }
      } else if (!kinds.includes('visit') || !(kinds.includes('activity') || kinds.includes('path'))) fail('INSUFFICIENT_COVERAGE');
      report.sampledOutRecords = report.processedRecords - selected.length;
      report.outputRecords = selected.length;
      report.visits = kinds.filter(k => k === 'visit').length;
      report.activities = kinds.filter(k => k === 'activity').length;
      report.paths = kinds.filter(k => k === 'path').length;
      report.rawPositions = kinds.filter(k => k === 'rawPosition').length;
      report.omittedArrayItems = selected.reduce((sum, r) => sum + r.counts.omittedArrayItems, 0);
      if (!rawMode && !report.paths) report.warnings.push('상세 경로 좌표 배열이 없어 이동 시작·종료점만 포함합니다.');
      const { output, coordinatePairs } = render(selected.map(v => v.template));
      report.coordinatePairs = coordinatePairs;
      const text = JSON.stringify(rootKey ? { [rootKey]: output } : output, null, 2) + '\n';
      report.outputBytes = new TextEncoder().encode(text).length;
      if (report.outputBytes > LIMITS.outputBytes) fail('OUTPUT_LIMIT');
      return { ok: true, text, report };
    } catch (error) {
      reason(error.message);
      return { ok: false, report };
    }
  }
  function formatReport(report) {
    return [
      `형식: ${report.format}`, `입력 기록: ${report.inputRecords}`, `검증 통과: ${report.processedRecords}`,
      `최상위 자료형: ${report.rootType}`, `알려진 기록 필드: semanticSegments=${report.knownRootFields.semanticSegments}, timelineObjects=${report.knownRootFields.timelineObjects}, rawSignals=${report.knownRootFields.rawSignals}`,
      `제외한 최상위 필드: ${report.excludedRootFields}`,
      `안전상 제외: ${report.excludedRecords}`, `크기 제한으로 미선택: ${report.sampledOutRecords}`,
      `샘플 기록: ${report.outputRecords} (방문 ${report.visits}, 이동 ${report.activities}, 상세 경로 ${report.paths})`,
      `원시 위치 관측값: ${report.rawPositions}`,
      `배열 축소 항목: ${report.omittedArrayItems}`, `가상 좌표 쌍: ${report.coordinatePairs}`, `출력 크기: ${report.outputBytes} bytes`,
      ...Object.entries(report.reasons).map(([code, count]) => `[${code}] ${REASONS[code]} (${count}건)`),
      ...report.warnings.map(w => `안내: ${w}`),
      ...(report.structure ? formatStructure(report.structure) : [])
    ].join('\n');
  }
  function formatStructure(info) {
    const types = counts => Object.entries(counts).filter(([, count]) => count).map(([type, count]) => `${type}=${count}`).join(', ') || '없음';
    return [
      '', '구조 진단 v1 — 원본 값·임의 필드명은 포함하지 않습니다.',
      `최상위 필드 자료형 집계: ${types(info.topLevelTypes)}`,
      `검사 노드: ${info.scannedNodes}, 일부만 검사: ${info.scanLimited ? '예 (건수는 검사 범위 기준)' : '아니오'}`,
      ...DIAGNOSTIC_FIELDS.filter(key => own(info.knownFields, key)).map(key => {
        const field = info.knownFields[key];
        return `고정 진단 필드 ${key}: 최상위=${field.root}, 중첩=${field.nested}, ${types(field.types)}`;
      }),
      `기록 형태 후보: 기기=${info.recordShapes.semantic}, 구형=${info.recordShapes.legacy}, E7 좌표쌍=${info.recordShapes.rawCoordinate}`,
      ...info.hints.map(code => `[${code}] ${DIAGNOSTIC_HINTS[code]}`),
      '필드 존재와 자료형만 검사한 결과이며 파일 형식이나 호환성 확정은 아닙니다. 이 구조 진단 부분만 공유해 주세요.'
    ];
  }
  const api = Object.freeze({ LIMITS, sanitizeText, formatReport });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TimelineSample = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
