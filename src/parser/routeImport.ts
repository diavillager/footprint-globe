import type { DatasetId, ImportCounts, Observation, ParseResult, RecordedVisit } from '../domain/timeline';
import { createGpxAudit } from '../features/audit/gpxAudit';
import { PREVIEW_LIMITS, parseRawValue, rawCoordinate, rawTimestamp } from './rawPreview';

const object=(v:unknown):v is Record<string,unknown>=>!!v && typeof v==='object' && !Array.isArray(v);
const emptyCounts=():ImportCounts=>({input:0,accepted:0,ignoredSignals:0,invalidPositions:0,ignoredRootFields:0});
export const compareObservations=(a:Observation,b:Observation)=>{
  const left=rawTimestamp(a.time.sourceText)!.ns,right=rawTimestamp(b.time.sourceText)!.ns;
  return left<right?-1:left>right?1:0;
};
export function parseGpx(text:string,datasetId:DatasetId):ParseResult {
  if(new TextEncoder().encode(text).length>PREVIEW_LIMITS.bytes) return {ok:false,code:'INPUT_LIMIT'};
  if(text.includes('\u0000')) return {ok:false,code:'UNSUPPORTED_ENCODING'};
  const points:Observation[]=[], counts=emptyCounts();
  let previous:Observation|undefined, previousNs:bigint|undefined, previousTrack:number|undefined, previousSegment=-1, overLimit=false;
  const audit=createGpxAudit(point=>{
    counts.input++;
    if(counts.input>PREVIEW_LIMITS.records) {overLimit=true;return;}
    if(!point.valid || !point.time) {counts.invalidPositions++;previous=undefined;previousNs=undefined;return;}
    const current:Observation={id:`observation:${datasetId}:gpx:${counts.input-1}`,coordinate:point.coordinate,time:point.time.instant,source:'gpx',sourceSegment:`gpx:${point.segment}`,
      predecessorId:point.kind!=='wpt' && previous && previousSegment===point.segment && previousNs!==undefined && point.time.ns>=previousNs ? previous.id:null,
      ...(point.kind==='trkpt' && previous && point.track!==undefined && point.track===previousTrack && previousSegment!==point.segment && previousNs!==undefined && point.time.ns>previousNs ? {gapPredecessorId:previous.id}:{})};
    points.push(current);previous=current;previousNs=point.time.ns;previousSegment=point.segment;previousTrack=point.track;
  });
  for(let offset=0;offset<text.length && audit.report.status==='scanning' && !overLimit;offset+=65536) audit.write(text.slice(offset,offset+65536),offset+65536>=text.length);
  if(!text.length) audit.write('',true);
  if(overLimit) return {ok:false,code:'INPUT_LIMIT'};
  if(audit.report.status!=='complete') return {ok:false,code:audit.report.error==='DTD_FORBIDDEN'?'DTD_FORBIDDEN':audit.report.error==='UNSUPPORTED_ENCODING'?'UNSUPPORTED_ENCODING':'INVALID_XML'};
  if(!audit.report.supported) return {ok:false,code:'UNSUPPORTED_FORMAT'};
  counts.accepted=points.length;
  if(!points.length) return {ok:false,code:'NO_VALID_POSITIONS',counts};
  points.sort(compareObservations);
  return {ok:true,counts,data:{datasetId,observations:points,recordedPaths:[],recordedVisits:[],format:'gpx'}};
}
export function parseTimelineRoutes(text:string,datasetId:DatasetId):ParseResult {
  if(new TextEncoder().encode(text).length>PREVIEW_LIMITS.bytes) return {ok:false,code:'INPUT_LIMIT'};
  let root:unknown;try {root=JSON.parse(text.replace(/^\uFEFF/,''));} catch {return {ok:false,code:'INVALID_JSON'};}
  return parseTimelineRouteValue(root,datasetId);
}
export function parseTimelineRouteValue(root:unknown,datasetId:DatasetId):ParseResult {
  if(!object(root) || Object.hasOwn(root,'timelineObjects') || (!Array.isArray(root.rawSignals) && !Array.isArray(root.semanticSegments))) return {ok:false,code:'UNSUPPORTED_FORMAT'};
  if((Object.hasOwn(root,'rawSignals') && !Array.isArray(root.rawSignals)) || (Object.hasOwn(root,'semanticSegments') && !Array.isArray(root.semanticSegments))) return {ok:false,code:'UNSUPPORTED_FORMAT'};
  if((Array.isArray(root.rawSignals) && root.rawSignals.length>PREVIEW_LIMITS.records) || (Array.isArray(root.semanticSegments) && root.semanticSegments.length>PREVIEW_LIMITS.records)) return {ok:false,code:'INPUT_LIMIT'};
  const raw=Array.isArray(root.rawSignals)?parseRawValue({rawSignals:root.rawSignals},datasetId):null;
  const counts=raw?.counts?{...raw.counts}:emptyCounts(), observations=raw?.ok?raw.data.observations:[];
  counts.ignoredRootFields=Object.keys(root).filter(k=>k!=='rawSignals' && k!=='semanticSegments').length;
  const detailed:Observation[]=[],visits:RecordedVisit[]=[];
  let inputPoints=Array.isArray(root.rawSignals)?root.rawSignals.length:0;
  const segments=Array.isArray(root.semanticSegments)?root.semanticSegments:[];
  for(let s=0;s<segments.length;s++) {
    const segment=segments[s];if(!object(segment)) {counts.ignoredSignals++;counts.input++;continue;}
    const start=rawTimestamp(segment.startTime),end=rawTimestamp(segment.endTime);
    if(object(segment.visit) && object(segment.visit.topCandidate) && object(segment.visit.topCandidate.placeLocation)) {
      const coordinate=rawCoordinate(segment.visit.topCandidate.placeLocation.latLng);
      if(coordinate && start && end && end.ns>=start.ns) visits.push({id:`visit:${datasetId}:${s}`,origin:'recorded',coordinate,start:start.instant,end:end.instant});
    }
    if(!Array.isArray(segment.timelinePath)) continue;
    let previous:Observation|undefined, previousNs:bigint|undefined;
    for(let i=0;i<segment.timelinePath.length;i++) {
      if(++inputPoints>PREVIEW_LIMITS.records) return {ok:false,code:'INPUT_LIMIT'};
      counts.input++;
      const p=segment.timelinePath[i];
      const coordinate=object(p)?rawCoordinate(p.point):null;
      let time=object(p)?rawTimestamp(p.time):null;
      // Only explicit offsets are supported; never interpolate a missing timestamp.
      if(object(p) && p.time===undefined && start && (typeof p.durationMinutesOffset==='number' || typeof p.durationMinutesOffset==='string') && /^\d+(?:\.\d+)?$/.test(String(p.durationMinutesOffset))) {
        const delta=Number(p.durationMinutesOffset)*60000, ms=start.instant.epochMs+delta;
        if(Number.isSafeInteger(delta) && Number.isFinite(ms) && Math.abs(ms)<=8.64e15) {
          const ns=start.ns+BigInt(delta)*1000000n;
          let seconds=ns/1000000000n,fraction=ns%1000000000n;
          if(fraction<0n){seconds--;fraction+=1000000000n;}
          time=rawTimestamp(new Date(Number(seconds)*1000).toISOString().slice(0,19)+'.'+String(fraction).padStart(9,'0')+'Z');
        }
      }
      if(!coordinate || !time || (start && time.ns<start.ns) || (end && time.ns>end.ns)) {counts.invalidPositions++;previous=undefined;previousNs=undefined;continue;}
      const point:Observation={id:`observation:${datasetId}:semantic:${s}:${i}`,coordinate,time:time.instant,source:'semantic',sourceSegment:`semantic:${s}`,
        predecessorId:previous && previousNs!==undefined && time.ns>=previousNs?previous.id:null};
      detailed.push(point);previous=point;previousNs=time.ns;counts.accepted++;
    }
  }
  if(!observations.length && !detailed.length) return {ok:false,code:'NO_VALID_POSITIONS',counts};
  detailed.sort(compareObservations);
  return {ok:true,counts,data:{datasetId,observations,detailedObservations:detailed,recordedVisits:visits,recordedPaths:[],format:'timeline'}};
}
