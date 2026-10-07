import { SaxesParser, type SaxesTagNS } from 'saxes';
import { rawTimestamp } from '../../parser/rawPreview';
import { AUDIT_DETAIL_LIMITS } from './structureAudit';
import type { Coordinate } from '../../domain/timeline';

const namespaces = ['http://www.topografix.com/GPX/1/0', 'http://www.topografix.com/GPX/1/1'];
const labels = new Set(['gpx','metadata','name','desc','author','email','link','text','type','copyright','year','license','time','keywords','bounds',
  'wpt','rte','rtept','trk','trkseg','trkpt','extensions','cmt','src','number','ele','magvar','geoidheight','sym','fix','sat','hdop','vdop','pdop','ageofdgpsdata','dgpsid','speed','course',
  'lat','lon','minlat','minlon','maxlat','maxlon','version','creator','href','id','domain','url','urlname']);
const qualityNames = ['ele','fix','sat','hdop','vdop','pdop','speed'] as const;
type Quality = typeof qualityNames[number];
type PointKind = 'trkpt' | 'rtept' | 'wpt';
type State = 'scanning' | 'complete' | 'cancelled' | 'failed';
export type GpxError = 'INVALID_XML' | 'DTD_FORBIDDEN' | 'UNSUPPORTED_ENCODING' | 'INPUT_LIMIT' | 'FILE_READ_FAILED' | 'AUDIT_FAILED';
interface PointCounts { total:number; coordinatesValid:number; coordinatesMissing:number; coordinatesInvalid:number; timeValid:number; timeMissing:number; timeInvalid:number; timeZoneMissing:number; timeRepeated:number; comparable:number }
const pointCounts = ():PointCounts => ({total:0,coordinatesValid:0,coordinatesMissing:0,coordinatesInvalid:0,timeValid:0,timeMissing:0,timeInvalid:0,timeZoneMissing:0,timeRepeated:0,comparable:0});
interface QualityCounts { present:number; valid:number; invalid:number }
interface PathCount { path:string; count:number }
export interface GpxReport {
  format:'gpx'; version:1; status:State; error?:GpxError;
  gpxVersion:'1.0'|'1.1'|'unrecognized'; supported:boolean;
  visited:number; elements:number; attributes:number; comments:number; instructions:number; textCharacters:number;
  tracks:number; segments:number; routes:number; emptySegments:number;
  points:Record<PointKind,PointCounts>; quality:Record<Quality,QualityCounts>;
  duplicateTimes:number; reversedTimes:number; positiveIntervals:number; gapsOver30Minutes:number;
  intervals:number[]; unknownNames:number; namespaceDeclarations:number; extensionElements:number;
  unlistedNodes:number; shortenedPaths:number; unaliasedNames:number; paths:PathCount[];
}
export function emptyGpxAudit():GpxReport {
  return {format:'gpx',version:1,status:'scanning',gpxVersion:'unrecognized',supported:false,visited:0,elements:0,attributes:0,comments:0,instructions:0,textCharacters:0,
    tracks:0,segments:0,routes:0,emptySegments:0,points:{trkpt:pointCounts(),rtept:pointCounts(),wpt:pointCounts()},
    quality:Object.fromEntries(qualityNames.map(name=>[name,{present:0,valid:0,invalid:0}])) as Record<Quality,QualityCounts>,
    duplicateTimes:0,reversedTimes:0,positiveIntervals:0,gapsOver30Minutes:0,intervals:[0,0,0,0,0,0],unknownNames:0,namespaceDeclarations:0,extensionElements:0,
    unlistedNodes:0,shortenedPaths:0,unaliasedNames:0,paths:[]};
}
const decimal = (value:string) => /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim()) && Number.isFinite(Number(value));
const attr = (tag:SaxesTagNS, name:string) => Object.values(tag.attributes).find(a=>a.uri==='' && a.local===name)?.value;
interface Point { kind:PointKind; coordinates:boolean; coordinate:Coordinate; fields:Map<string,{count:number;text:string}> }
interface Frame { local:string; uri:string; path:string; standard:boolean; context:string; extension:boolean; children:number; text:string; textOverflow:boolean; point?:Point; previous?:bigint; segment:number; track:number|undefined }
export interface GpxPointEvent { kind:PointKind; segment:number; track:number|undefined; coordinate:Coordinate; time:ReturnType<typeof rawTimestamp>; valid:boolean }

/** Audit callers omit onPoint. The app importer may consume validated values locally, never in reports. */
export function createGpxAudit(onPoint?:(point:GpxPointEvent)=>void) {
  const report=emptyGpxAudit(), parser=new SaxesParser({xmlns:true,position:false});
  const stack:Frame[]=[], paths=new Map<string,PathCount>(), aliases=new Map<string,string>();
  let rootSeen=false, rootNamespace='', segment=0;
  const fail=(error:GpxError):never=>{report.status='failed';report.error=error;throw new Error('GPX_AUDIT_STOP');};
  const alias=(uri:string,local:string,standard:boolean) => {
    if(standard && labels.has(local)) return local;
    report.unknownNames++;
    const key=JSON.stringify([uri,local]);
    if(aliases.has(key)) return aliases.get(key)!;
    if(aliases.size>=AUDIT_DETAIL_LIMITS.aliases) {report.unaliasedNames++;return '기타필드';}
    const name=`필드${aliases.size+1}`;aliases.set(key,name);return name;
  };
  const countPath=(path:string) => {
    report.visited++;
    const entry=paths.get(path);
    if(entry) entry.count++;
    else if(paths.size<AUDIT_DETAIL_LIMITS.paths) {const value={path,count:1};paths.set(path,value);report.paths.push(value);}
    else report.unlistedNodes++;
  };
  parser.on('error',()=>fail('INVALID_XML'));
  parser.on('doctype',()=>fail('DTD_FORBIDDEN'));
  parser.on('xmldecl',decl=>{if(decl.encoding && !/^utf-8$/i.test(decl.encoding)) fail('UNSUPPORTED_ENCODING');});
  parser.on('comment',()=>{report.comments++;});
  parser.on('processinginstruction',()=>{report.instructions++;});
  parser.on('opentag',tag=>{
    if(!rootSeen) {
      rootSeen=true;rootNamespace=tag.uri;
      const version=attr(tag,'version');
      report.supported=tag.local==='gpx' && ((version==='1.0' && tag.uri===namespaces[0]) || (version==='1.1' && tag.uri===namespaces[1]));
      if(report.supported) report.gpxVersion=version as '1.0'|'1.1';
    }
    const parent=stack.at(-1), standard=namespaces.includes(tag.uri);
    const label=alias(tag.uri,tag.local,standard);
    let path=(parent?.path ?? '$')+'/'+label;
    if(stack.length>=AUDIT_DETAIL_LIMITS.pathDepth) {path=parent!.path;report.shortenedPaths++;}
    countPath(path);report.elements++;
    const correctNamespace=report.supported && tag.uri===rootNamespace;
    let context='';
    if(correctNamespace) {
      if(!parent) context='gpx';
      else if(parent.context==='gpx' && ['trk','rte','wpt'].includes(tag.local)) context=tag.local;
      else if(parent.context==='trk' && tag.local==='trkseg') context='trkseg';
      else if(parent.context==='trkseg' && tag.local==='trkpt') context='trkpt';
      else if(parent.context==='rte' && tag.local==='rtept') context='rtept';
    }
    const extension=Boolean(parent?.extension || (correctNamespace && tag.local==='extensions'));
    if(extension) report.extensionElements++;
    const frame:Frame={local:tag.local,uri:tag.uri,path,standard:correctNamespace,context,extension,children:0,text:'',textOverflow:false,
      segment:['trkseg','rte','wpt'].includes(context)?++segment:(parent?.segment??0),track:context==='trk'?report.tracks+1:parent?.track};
    if(parent) parent.children++;
    if(context==='trk') report.tracks++;
    if(context==='rte') report.routes++;
    if(context==='trkseg') report.segments++;
    if(['trkpt','rtept','wpt'].includes(context)) {
      const kind=context as PointKind, stats=report.points[kind];stats.total++;
      const lat=attr(tag,'lat'),lon=attr(tag,'lon');
      const valid=lat!==undefined && lon!==undefined && decimal(lat) && decimal(lon) && Math.abs(Number(lat))<=90 && Number(lon)>=-180 && Number(lon)<180;
      if(lat===undefined || lon===undefined) stats.coordinatesMissing++;
      else if(valid) stats.coordinatesValid++;else stats.coordinatesInvalid++;
      frame.point={kind,coordinates:valid,coordinate:{latitude:Number(lat),longitude:Number(lon)},fields:new Map()};
    }
    for(const attribute of Object.values(tag.attributes)) {
      report.attributes++;
      const ns=attribute.uri==='http://www.w3.org/2000/xmlns/';
      if(ns) report.namespaceDeclarations++;
      const name=ns?'namespace':alias(attribute.uri,attribute.local,standard && attribute.uri==='');
      countPath(path+'/@'+name);
    }
    stack.push(frame);
  });
  const text=(value:string)=>{
    report.textCharacters+=value.length;
    const frame=stack.at(-1);
    // Capture only bounded direct scalar fields; names/metadata/extensions never need values.
    if(frame?.standard && stack.at(-2)?.point && (frame.local==='time' || qualityNames.includes(frame.local as Quality))) {
      frame.textOverflow ||= frame.text.length+value.length>256;
      frame.text=(frame.text+value).slice(0,256);
    }
  };
  parser.on('text',text);parser.on('cdata',text);
  parser.on('closetag',()=>{
    const frame=stack.pop()!,parent=stack.at(-1);
    if(parent?.point && frame.standard && (frame.local==='time' || qualityNames.includes(frame.local as Quality))) {
      const previous=parent.point.fields.get(frame.local);
      parent.point.fields.set(frame.local,{count:(previous?.count ?? 0)+1,text:frame.children || frame.textOverflow?'INVALID':frame.text.trim()});
    }
    if(frame.context==='trkseg' && frame.children===0) report.emptySegments++;
    if(!frame.point) return;
    const point=frame.point, stats=report.points[point.kind], field=point.fields.get('time');
    let time:ReturnType<typeof rawTimestamp>=null;
    if(!field) stats.timeMissing++;
    else if(field.count!==1) stats.timeRepeated++;
    else {
      time=rawTimestamp(field.text);
      if(time) stats.timeValid++;
      else if(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?$/.test(field.text) && rawTimestamp(field.text+'Z')) stats.timeZoneMissing++;
      else stats.timeInvalid++;
    }
    for(const name of qualityNames) {
      if(name==='speed' && report.gpxVersion!=='1.0') continue;
      const field=point.fields.get(name);if(!field) continue;
      const stats=report.quality[name];stats.present++;
      const value=field.text;
      const valid=field.count===1 && (name==='fix' ? ['none','2d','3d','dgps','pps'].includes(value)
        : name==='sat' ? /^\+?\d+$/.test(value) && Number.isSafeInteger(Number(value))
        : decimal(value) && (name==='ele' || Number(value)>=0));
      if(valid) stats.valid++;else stats.invalid++;
    }
    if(point.coordinates && time) stats.comparable++;
    onPoint?.({kind:point.kind,segment:frame.segment,track:frame.track,coordinate:point.coordinate,time,valid:point.coordinates && !!time});
    if(point.kind==='wpt' || !parent) return;
    if(!point.coordinates || !time) {delete parent.previous;return;}
    if(parent.previous!==undefined) {
      const diff=time.ns-parent.previous;
      if(diff===0n) report.duplicateTimes++;
      else if(diff<0n) report.reversedTimes++;
      else {
        report.positiveIntervals++;
        const boundaries=[1n,5n,30n,60n,300n];
        const bucket=boundaries.findIndex(seconds=>diff<=seconds*1000000000n);
        report.intervals[bucket<0?5:bucket]!++;
        if(diff>1800n*1000000000n) report.gapsOver30Minutes++;
      }
    }
    parent.previous=time.ns;
  });
  const write=(chunk:string,final=false) => {
    if(report.status!=='scanning') return report;
    try {parser.write(chunk);if(final) {parser.close();report.status='complete';}}
    catch {report.status='failed';report.error ??='INVALID_XML';}
    return report;
  };
  return {report,write};
}

export function formatGpxReport(r:GpxReport):string {
  const n=(v:number)=>v.toLocaleString('ko-KR');
  const states={scanning:'진행 중',complete:'완료',cancelled:'취소 — 미완료',failed:'오류 — 미완료'};
  return [
    'GPX 구조·비교 준비 진단 v1',
    '원본 값·파일명·임의 요소/속성명·namespace URI는 포함하지 않습니다.',
    `전체 XML 탐색: ${states[r.status]}${r.error?` [${r.error}]`:''}`,
    `GPX 식별: ${r.supported?`표준 namespace·버전 ${r.gpxVersion}`:'미지원 또는 미확인 — 아래 기록 0건을 실제 기록 없음으로 해석하지 마세요.'}`,
    '지도 앱의 GPX 지원 여부와 별개인 진단입니다. XSD 전체 검증이나 위치 정확성 검증이 아닙니다.',
    `검사 요소 ${n(r.elements)}개 · 속성 ${n(r.attributes)}개 · 주석 ${n(r.comments)}개 · 처리 지시 ${n(r.instructions)}개`,
    r.status==='complete'?'미탐색 XML 요소·속성: 0개. 확장 필드의 의미는 미확정입니다.':'미탐색 XML 요소·속성: 건수 미확정. 완료 전 집계입니다.',
    `트랙 ${n(r.tracks)}개 · 트랙 구간 ${n(r.segments)}개 · 자식 요소 없는 구간 ${n(r.emptySegments)}개 · 루트 ${n(r.routes)}개`,
    '',
    ...(['trkpt','rtept','wpt'] as const).flatMap(kind=>{
      const p=r.points[kind],label={trkpt:'트랙 포인트',rtept:'루트 포인트',wpt:'웨이포인트'}[kind];
      return [`${label}: ${n(p.total)}개 · 좌표·시각 모두 유효 ${n(p.comparable)}개`,
        `  좌표: 유효 ${n(p.coordinatesValid)} · 누락 ${n(p.coordinatesMissing)} · 불량 ${n(p.coordinatesInvalid)}`,
        `  시각: 유효 ${n(p.timeValid)} · 누락 ${n(p.timeMissing)} · 불량/미지원 표현 ${n(p.timeInvalid)} · 시간대 없음 ${n(p.timeZoneMissing)} · time 요소 중복 ${n(p.timeRepeated)}`];
    }),
    '', '시간 비교 (원본 순서, 같은 트랙 구간/루트 내 인접한 좌표·시각 유효 점만)',
    `동일 시각 ${n(r.duplicateTimes)}쌍 · 역순 ${n(r.reversedTimes)}쌍 · 양의 간격 ${n(r.positiveIntervals)}쌍 · 그중 30분 초과 ${n(r.gapsOver30Minutes)}쌍`,
    ['1초 이하','1초 초과~5초','5초 초과~30초','30초 초과~60초','60초 초과~5분','5분 초과'].map((s,i)=>`${s}: ${n(r.intervals[i]!)}쌍`).join(' · '),
    '누락·불량 점이나 구간 경계를 건너 시간 비교를 하지 않습니다. 연결·제외 기준은 변경하지 않습니다.',
    '', '선택적 필드 (기록 유형 전체 합계; 실제 수치와 원문은 비공개)',
    ...qualityNames.map(name=>name==='speed' && r.gpxVersion!=='1.0'
      ? 'speed: GPX 1.0에서만 의미를 검사합니다. 다른 버전은 아래 구조 목록을 참고하세요.'
      : `${name}: 존재 ${n(r.quality[name].present)}개 · 유효 ${n(r.quality[name].valid)} · 불량/중복 ${n(r.quality[name].invalid)}`),
    'HDOP/VDOP/PDOP는 미터 오차가 아닙니다. 확장 필드는 정확도·속도로 추정하지 않습니다. speed 의미 검사는 GPX 1.0에 한정합니다.',
    '',`확장 영역 요소 ${n(r.extensionElements)}개 · 미확정 이름 출현 ${n(r.unknownNames)}회 · namespace 선언 ${n(r.namespaceDeclarations)}회`,
    `구조 목록 상세 제한: 미등재 ${n(r.unlistedNodes)}개 · 경로 생략 ${n(r.shortenedPaths)}회 · 별칭 한도 초과 ${n(r.unaliasedNames)}회`,
    '필드1 등은 파일 내 별칭입니다. 대응표·URI·텍스트·속성값은 공유하지 않습니다. 문자열 속 XML/JSON은 다시 파싱하지 않습니다.',
    '원본 시각 범위는 이 보고서에 없습니다. Timeline과의 시간 겹침·거리 비교는 아직 수행하지 않았습니다.',
    '', '반복 구조별 목록 (같은 요소 경로의 모든 출현을 합산; @는 속성)',
    ...r.paths.map(p=>`${p.path} | ${n(p.count)}개`),
  ].join('\n');
}
