import { parseRawValue, rawCoordinate, rawTimestamp } from '../../parser/rawPreview';
import type { ImportCounts, ImportError } from '../../domain/timeline';

// Only these literal schema labels can leave the worker. All other names get opaque aliases.
const fields = new Set(['rawSignals','semanticSegments','timelineObjects','locations','timelineEdits','position',
  'LatLng','latLng','latitude','longitude','lat','lon','lng','latitudeE7','longitudeE7','latE7','lngE7',
  'timestamp','timestampMs','startTime','endTime','time','durationMinutesOffset','accuracyMeters','accuracy',
  'altitudeMeters','speedMetersPerSecond','source','visit','activity','timelinePath','point','placeVisit',
  'activitySegment','waypointPath','waypoints','simplifiedRawPath','points','location','duration',
  'startLocation','endLocation','topCandidate','placeLocation','wifiScan','activityRecord']);
const object = (value: unknown): value is Record<string,unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value: object, key: string) => Object.hasOwn(value,key);
type Kind = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
type Counts = Record<Kind,number>;
const counts = (): Counts => ({object:0,array:0,string:0,number:0,boolean:0,null:0});
const kind = (value: unknown): Kind => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value as Kind;
export const AUDIT_DETAIL_LIMITS = { paths: 1200, aliases: 1200, pathDepth: 16 } as const;
export interface PathSummary {
  path: string; types: Counts; total: number; unknownName: boolean;
  parserReadable: boolean; coordinateStrings: number; timeStrings: number; encodedStrings: number;
}
export interface AuditReport {
  version: 2;
  status: 'scanning' | 'complete' | 'cancelled' | 'failed';
  error?: 'INVALID_JSON' | 'INPUT_LIMIT' | 'FILE_READ_FAILED' | 'AUDIT_FAILED';
  visited: number; types: Counts; unknownFieldOccurrences: number;
  // Display limits never stop traversal. These are occurrences, not distinct records.
  unlistedNodes: number; shortenedPaths: number; unaliasedFields: number;
  coordinateStrings: number; timeStrings: number; encodedStrings: number;
  knownPositionObjects: number; outsideRawPositionObjects: number; numericCoordinateObjects: number;
  visitObjects: number; activityObjects: number; pathArrays: number;
  app: { checked: boolean; ok: boolean; code?: ImportError; counts?: ImportCounts };
  paths: PathSummary[];
}
export function emptyAudit(): AuditReport {
  return {version:2,status:'scanning',visited:0,types:counts(),unknownFieldOccurrences:0,
    unlistedNodes:0,shortenedPaths:0,unaliasedFields:0,coordinateStrings:0,timeStrings:0,encodedStrings:0,
    knownPositionObjects:0,outsideRawPositionObjects:0,numericCoordinateObjects:0,visitObjects:0,activityObjects:0,pathArrays:0,
    app:{checked:false,ok:false},paths:[]};
}
/** No source value/name survives this projection. Uses exactly the app parser, not a parallel schema. */
export function auditApp(root: unknown): AuditReport['app'] {
  const result=parseRawValue(root,'dataset:local-audit');
  return result.ok ? {checked:true,ok:true,counts:result.counts}
    : {checked:true,ok:false,code:result.code,...(result.counts ? {counts:result.counts} : {})};
}
interface Frame { value: unknown[] | Record<string,unknown>; path: string; depth: number; index: number; keys?: string[]; unknownName: boolean }
const readable = (path: string) => /^\$\.rawSignals(\[\](\.position(\.(LatLng|latLng|timestamp|accuracyMeters))?)?)?$/.test(path);

/** Iterative, resumable, complete traversal: no node/depth cap or array sampling. */
export function createAudit(root: unknown) {
  const report=emptyAudit(), paths=new Map<string,PathSummary>(), aliases=new Map<string,string>();
  const stack: Frame[]=[];
  let first=true;
  const alias=(name:string) => {
    if (fields.has(name)) return name;
    report.unknownFieldOccurrences++;
    if (aliases.has(name)) return aliases.get(name)!;
    if (aliases.size>=AUDIT_DETAIL_LIMITS.aliases) {report.unaliasedFields++;return '기타필드';}
    const label=`필드${aliases.size+1}`;aliases.set(name,label);return label;
  };
  const visit=(value:unknown,path:string,depth:number,unknownName:boolean) => {
    const type=kind(value); report.visited++; report.types[type]++;
    let entry=paths.get(path);
    if (!entry && paths.size<AUDIT_DETAIL_LIMITS.paths) {
      entry={path,types:counts(),total:0,unknownName,parserReadable:readable(path),coordinateStrings:0,timeStrings:0,encodedStrings:0};
      paths.set(path,entry);report.paths.push(entry);
    }
    if(entry) {entry.total++;entry.types[type]++;entry.unknownName ||= unknownName;}
    else report.unlistedNodes++;
    if (typeof value==='string') {
      // Long/embedded strings remain opaque; no recursive parsing of arbitrary payloads.
      if (value.length<=100 && rawCoordinate(value)) {report.coordinateStrings++;if(entry) entry.coordinateStrings++;}
      if (value.length<=100 && rawTimestamp(value)) {report.timeStrings++;if(entry) entry.timeStrings++;}
      if (/^[\s]*[\[{]/.test(value.slice(0,128))) {report.encodedStrings++;if(entry) entry.encodedStrings++;}
    }
    if (object(value)) {
      if ((own(value,'LatLng') || own(value,'latLng')) && own(value,'timestamp')) {
        report.knownPositionObjects++;
        if(path!=='$.rawSignals[].position') report.outsideRawPositionObjects++;
      }
      if ([['latitude','longitude'],['lat','lon'],['lat','lng'],['latitudeE7','longitudeE7'],['latE7','lngE7']]
        .some(pair=>pair.every(key=>own(value,key)))) report.numericCoordinateObjects++;
      if (object(value.visit) || object(value.placeVisit)) report.visitObjects++;
      if (object(value.activity) || object(value.activitySegment)) report.activityObjects++;
      if (Array.isArray(value.timelinePath)) report.pathArrays++;
      if (object(value.waypointPath) && Array.isArray(value.waypointPath.waypoints)) report.pathArrays++;
      if (object(value.simplifiedRawPath) && Array.isArray(value.simplifiedRawPath.points)) report.pathArrays++;
      stack.push({value,path,depth,index:0,keys:Object.keys(value),unknownName});
    } else if (Array.isArray(value)) stack.push({value,path,depth,index:0,unknownName});
  };
  const step=(limit=10000) => {
    if (!Number.isSafeInteger(limit) || limit<1) throw new RangeError('INVALID_BATCH_SIZE');
    if (report.status!=='scanning') return report;
    const end=report.visited+limit;
    if(first) {first=false;visit(root,'$',0,false);}
    while(stack.length && report.visited<end) {
      const frame=stack.at(-1)!, array=Array.isArray(frame.value);
      const size=array ? (frame.value as unknown[]).length : frame.keys!.length;
      if(frame.index>=size) {stack.pop();continue;}
      let value:unknown,path:string,unknownName=frame.unknownName;
      if(array) {value=(frame.value as unknown[])[frame.index++];path=frame.path+'[]';}
      else {
        const name=frame.keys![frame.index++]!;value=(frame.value as Record<string,unknown>)[name];
        unknownName ||= !fields.has(name);path=frame.path+'.'+alias(name);
      }
      if(frame.depth>=AUDIT_DETAIL_LIMITS.pathDepth) {path=frame.path;report.shortenedPaths++;}
      visit(value,path,frame.depth+1,unknownName);
    }
    if(!stack.length) report.status='complete';
    return report;
  };
  return {report,step};
}

/** Text is built exclusively from fixed labels, opaque aliases and aggregate numbers. */
export function formatAuditReport(report: AuditReport): string {
  const state={scanning:'진행 중',complete:'완료',cancelled:'취소 — 미완료',failed:'오류 — 미완료'}[report.status];
  const app=report.app, n=(value:number)=>value.toLocaleString('ko-KR');
  const paths=[...report.paths].sort((a,b)=>(Number(b.coordinateStrings>0||b.timeStrings>0)-Number(a.coordinateStrings>0||a.timeStrings>0)) || Number(b.unknownName)-Number(a.unknownName));
  return [
    'Timeline 구조·앱 사용 범위 진단 v2',
    '원본 값·원본 파일명·임의 필드명은 이 보고서에 포함하지 않습니다.',
    `전체 JSON 항목 탐색: ${state}${report.error ? ` [${report.error}]` : ''}`,
    `검사 항목 ${n(report.visited)}개 · 객체 ${n(report.types.object)} · 배열 ${n(report.types.array)} · 문자열 ${n(report.types.string)} · 숫자 ${n(report.types.number)} · 불리언 ${n(report.types.boolean)} · null ${n(report.types.null)}`,
    report.status==='complete' ? '미탐색 JSON 항목: 0개. 문자열 내부를 다시 JSON으로 해석하지는 않습니다.' : '미탐색 JSON 항목: 건수 미확정. 검사된 범위만 집계했습니다.',
    `구조 목록 상세 제한: 미등재 항목 ${n(report.unlistedNodes)}개 · 경로 생략 ${n(report.shortenedPaths)}회 · 이름 대체 한도 초과 ${n(report.unaliasedFields)}회`,
    '탐색 완료는 모든 형식의 의미를 이해했거나 앱이 전부 사용한다는 뜻이 아닙니다.',
    '표준 JSON 파싱 후의 구조를 검사합니다. 같은 객체 안의 중복 키는 마지막 값만 남으며, 중복 키 원문 검사는 하지 않습니다.',
    '', '현재 앱 파서 검사 (오류 의심 필터 적용 전)',
    !app.checked ? '파서 검사: 미실행/미완료' : app.ok ? '파서 검사: 지원 입력 · 관측 채택 완료' : `파서 검사: 채택 중단 [${app.code}]`,
    ...(app.counts ? [`선택한 rawSignals ${n(app.counts.input)}개 = 채택 ${n(app.counts.accepted)}개 + 위치 외 신호 ${n(app.counts.ignoredSignals)}개 + 좌표·시각/구조 불량 ${n(app.counts.invalidPositions)}개`,
      `앱에서 제외한 최상위 필드 ${n(app.counts.ignoredRootFields)}개`] : ['앱 채택/제외 건수: 확인할 수 없음 (0건으로 해석하지 마세요).']),
    '', '파일 전체에서 발견한 구조 후보 (서로 중첩될 수 있으며 유효 기록 수가 아닙니다)',
    `알려진 위치 관측형 객체 ${n(report.knownPositionObjects)}개 · 그중 앱 입력 경로 밖 ${n(report.outsideRawPositionObjects)}개`,
    `좌표 필드쌍 형태 객체 ${n(report.numericCoordinateObjects)}개 · 방문형 객체 ${n(report.visitObjects)}개 · 이동형 객체 ${n(report.activityObjects)}개 · 상세 경로 배열 ${n(report.pathArrays)}개`,
    `좌표 형식 문자열 ${n(report.coordinateStrings)}개 · 시각 형식 문자열 ${n(report.timeStrings)}개`,
    '', '의미 미확정 영역',
    `허용 목록 밖 필드 출현 ${n(report.unknownFieldOccurrences)}회 · JSON처럼 시작하는 미해석 문자열 ${n(report.encodedStrings)}개`,
    '필드1·필드2 등은 이 파일 안에서만 유효한 대체 이름입니다. 실제 이름과 대응표는 공유하지 않습니다.',
    '숫자·문자열의 실제 의미는 자료형만으로 확정할 수 없습니다. 이 검사는 GPX/KML 비교나 위치 오류 판정이 아닙니다.',
    '', '반복 구조별 목록 ([]는 배열 전체의 같은 경로를 묶은 표시)',
    '파서 경로=앱이 읽을 수 있는 필드 위치. 실제 값의 채택 여부는 위 파서 검사 결과를 따릅니다.',
    ...paths.map(p=>`${p.path} | ${Object.entries(p.types).filter(([,count])=>count).map(([type,count])=>`${type}:${n(count)}`).join(', ')} | ${p.parserReadable?'파서 경로':'앱 직접 입력 아님'}${p.unknownName?' · 미확정 필드 포함':''}${p.coordinateStrings?` · 좌표형 문자열 ${n(p.coordinateStrings)}`:''}${p.timeStrings?` · 시각형 문자열 ${n(p.timeStrings)}`:''}`),
  ].join('\n');
}
