'use strict';

// Self-contained factory also runs inside an offline Blob Worker.
function createSamsungInspector() {
  const limits = { files: 2000, fileBytes: 8 * 1024 * 1024, totalBytes: 64 * 1024 * 1024, nodes: 1000000, depth: 48, csvColumns: 512 };
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const pairs = [['latitude', 'longitude', 1], ['lat', 'lng', 1], ['lat', 'lon', 1], ['latitudeE7', 'longitudeE7', 1e7]];
  const timeKeys = ['timestamp', 'time', 'start_time', 'startTime', 'timestampMs'];
  const known = new Set([...pairs.flatMap(p => p.slice(0, 2)), ...timeKeys, 'LatLng', 'latLng']);
  const fresh = () => ({ selectedFiles: 0, inspectedFiles: 0, jsonFiles: 0, csvFiles: 0, excludedFiles: 0,
    readErrors: 0, parseErrors: 0, limitFiles: 0, otherFiles: 0, exerciseNames: 0, routeNames: 0,
    nodes: 0, coordinateCandidates: 0, timedCandidates: 0, invalidCoordinates: 0, timeCandidates: 0,
    unknownFields: 0, opaqueStrings: 0, partial: false });
  const number = value => typeof value === 'number' && Number.isFinite(value) ? value :
    typeof value === 'string' && /^[+-]?\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : NaN;
  // Time *candidate*, not normalized time: export-specific epoch units stay unresolved.
  const time = value => {
    if (typeof value === 'number') return Number.isFinite(value) && value >= 0;
    if (typeof value !== 'string') return false;
    return /^\d{10,19}$/.test(value) || /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/.test(value);
  };
  function inspectObject(obj, report) {
    let hasCoordinate = false, validCoordinate = false;
    for (const [latKey, lonKey, scale] of pairs) {
      if (!own(obj, latKey) && !own(obj, lonKey)) continue;
      hasCoordinate = true;
      const lat = number(obj[latKey]) / scale, lon = number(obj[lonKey]) / scale;
      if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) validCoordinate = true;
    }
    for (const key of ['LatLng', 'latLng']) {
      if (!own(obj, key)) continue;
      hasCoordinate = true;
      const match = typeof obj[key] === 'string' && /^(?:geo:)?([+-]?\d+(?:\.\d+)?)°?,\s*([+-]?\d+(?:\.\d+)?)°?$/.exec(obj[key]);
      if (match && Math.abs(Number(match[1])) <= 90 && Math.abs(Number(match[2])) <= 180) validCoordinate = true;
    }
    const hasTime = timeKeys.some(key => own(obj, key) && time(obj[key]));
    if (hasTime) report.timeCandidates++;
    if (validCoordinate) { report.coordinateCandidates++; if (hasTime) report.timedCandidates++; }
    else if (hasCoordinate) report.invalidCoordinates++;
  }
  function scan(root, report) {
    // Iterator frames avoid materializing every array item onto a second stack.
    const stack = [{ value: root, depth: 0 }];
    while (stack.length) {
      if (report.nodes >= limits.nodes) { report.partial = true; return; }
      const frame = stack[stack.length - 1];
      if (!frame.entered) {
        report.nodes++;
        frame.entered = true;
        if (!frame.value || typeof frame.value !== 'object') {
          if (typeof frame.value === 'string') report.opaqueStrings++;
          stack.pop(); continue;
        }
        if (frame.depth >= limits.depth) { report.partial = true; stack.pop(); continue; }
        frame.array = Array.isArray(frame.value);
        if (!frame.array) inspectObject(frame.value, report);
        frame.keys = frame.array ? null : Object.keys(frame.value);
        frame.length = frame.array ? frame.value.length : frame.keys.length;
        frame.index = 0;
      }
      if (frame.index >= frame.length) { stack.pop(); continue; }
      const key = frame.array ? frame.index : frame.keys[frame.index];
      frame.index++;
      if (!frame.array && !known.has(key)) report.unknownFields++;
      stack.push({ value: frame.value[key], depth: frame.depth + 1 });
    }
  }
  function scanCsv(text, report) {
    let row = [], field = '', quoted = false, afterQuote = false, header = null, rowIndex = 0;
    function finishRow() {
      row.push(field); field = ''; afterQuote = false;
      if (row.length > limits.csvColumns) throw new Error('CSV');
      if (!header) {
        // Samsung exports may prepend a version row before their header.
        if (row.some(key => known.has(key.trim()))) {
          header = row.map(key => key.trim());
          if (new Set(header).size !== header.length) throw new Error('HEADER');
        }
        else if (rowIndex >= 2) return false;
      } else {
        if (row.length !== header.length) throw new Error('CSV');
        const obj = Object.create(null);
        header.forEach((key, index) => { obj[key] = row[index]; });
        scan(obj, report);
      }
      rowIndex++; row = []; return report.nodes < limits.nodes;
    }
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; afterQuote = true; } }
        else field += ch;
      } else if (ch === '"' && !field && !afterQuote) quoted = true;
      else if (ch === ',') { row.push(field); field = ''; afterQuote = false; if (row.length >= limits.csvColumns) throw new Error('CSV'); }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        if (!finishRow()) { if (!header) throw new Error('HEADER'); report.partial = true; return; }
      } else if (afterQuote || ch === '"') throw new Error('CSV');
      else field += ch;
    }
    if (quoted) throw new Error('CSV');
    if (field || row.length || afterQuote) finishRow();
    if (!header) throw new Error('HEADER');
  }
  async function inspect(files, progress = () => {}) {
    const report = fresh(); report.selectedFiles = files.length;
    if (files.length > limits.files) { report.partial = true; report.excludedFiles = files.length; report.limitFiles = files.length; return report; }
    let bytes = 0;
    for (const file of files) {
      // Paths are used only for fixed category counts; never returned to the UI.
      const path = String(file.webkitRelativePath || file.name || '').toLowerCase();
      if (/(?:^|\/)com\.samsung\.(?:shealth|health)\.exercise(?:[./]|$)/.test(path)) report.exerciseNames++;
      if (/(?:^|[./])(?:route|location_data)(?:[./]|$)/.test(path)) report.routeNames++;
      const json = path.endsWith('.json'), csv = path.endsWith('.csv');
      if (!json && !csv) { report.otherFiles++; report.excludedFiles++; continue; }
      if (!Number.isFinite(file.size) || file.size < 0 || file.size > limits.fileBytes || bytes + file.size > limits.totalBytes || report.nodes >= limits.nodes) {
        report.partial = true; report.limitFiles++; report.excludedFiles++; continue;
      }
      bytes += file.size;
      let source;
      try { source = await file.text(); } catch { report.readErrors++; report.excludedFiles++; continue; }
      // Commit counts only after successful parsing, never from a malformed CSV prefix.
      const delta = fresh(); delta.nodes = report.nodes;
      try {
        source = source.replace(/^\uFEFF/, '');
        if (json) scan(JSON.parse(source), delta); else scanCsv(source, delta);
      } catch { report.parseErrors++; report.excludedFiles++; continue; }
      report.inspectedFiles++; report[json ? 'jsonFiles' : 'csvFiles']++;
      for (const key of ['coordinateCandidates', 'timedCandidates', 'invalidCoordinates', 'timeCandidates', 'unknownFields', 'opaqueStrings']) report[key] += delta[key];
      report.nodes = delta.nodes; report.partial ||= delta.partial;
      progress({ inspectedFiles: report.inspectedFiles, selectedFiles: report.selectedFiles });
    }
    return report;
  }
  function format(r) {
    return ['삼성 헬스 로컬 구조 진단 v1 — 원본 값·파일명·임의 필드명 없음',
      `선택 파일: ${r.selectedFiles}, 검사 파일: ${r.inspectedFiles} (JSON ${r.jsonFiles}, CSV ${r.csvFiles})`,
      `제외 파일: ${r.excludedFiles} (크기·건수·노드 한도 ${r.limitFiles}, 읽기 실패 ${r.readErrors}, 파싱·CSV 헤더 판별 실패 ${r.parseErrors}, 미지원 확장자 ${r.otherFiles})`,
      `이름으로 분류한 운동 관련 파일: ${r.exerciseNames}, 경로 관련 파일: ${r.routeNames} (내용 존재의 증거 아님)`,
      `검사 노드: ${r.nodes}, 구조 검사 한도 도달: ${r.partial ? '예' : '아니오'}`,
      `유효 범위 좌표쌍 후보: ${r.coordinateCandidates}, 같은 객체·CSV 행의 좌표+시각 후보: ${r.timedCandidates}`,
      `시각 표현 후보: ${r.timeCandidates}, 누락·잘못된 좌표 후보: ${r.invalidCoordinates}`,
      `의미를 해석하지 않은 필드: ${r.unknownFields}, 문자열 노드: ${r.opaqueStrings}`,
      r.timedCandidates ? '[CANDIDATES_FOUND] 좌표·시각 후보가 있습니다. 운동 경로 또는 앱 호환성 확정은 아닙니다.' : '[NO_KNOWN_PAIR] 검사 범위에서 같은 기록의 좌표·시각 후보를 찾지 못했습니다. 원본에 위치가 없다는 증명은 아닙니다.',
      '[UNRESOLVED] 미지의 키·좌표 배열·문자열 속 JSON·압축/인코딩 자료와 파일 간 참조는 해석하지 않습니다. 시각의 단위·달력 유효성·시간대와 경로 연속성은 검증하지 않습니다.',
      '[SCOPE] 선택 폴더 안의 자료만 검사합니다. 계정·워치·다른 백업의 기록 유무는 알 수 없습니다.',
      '공유한다면 이 진단 결과만 복사하세요. 원본 JSON·CSV·사진은 공유하지 마세요.'].join('\n');
  }
  return { limits, inspect, format };
}
if (typeof module !== 'undefined') module.exports = createSamsungInspector;
