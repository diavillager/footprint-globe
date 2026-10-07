import { inspectSourceLocations } from './locationQuality';
import { parseTimeline, PREVIEW_LIMITS } from '../../parser';
import { importFile, type ImportRequest } from './importFile';
import { parseGpx } from '../../parser/routeImport';

self.onmessage = async (event: MessageEvent<ImportRequest>) => {
  const file=event.data.file;
  const result = await importFile(file, event.data.datasetId, async(text,id)=>{
    if(/\.(gpx|xml)$/i.test(file.name) || /^\s*</.test(text.replace(/^\uFEFF/,''))) {
      let decoded:string;try {decoded=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());} catch {return {ok:false,code:'UNSUPPORTED_ENCODING'};}
      return parseGpx(decoded,id);
    }
    return parseTimeline(text,id);
  }, PREVIEW_LIMITS.bytes);
  const quality=result.ok?inspectSourceLocations(result.data.observations):null;
  if(result.ok && quality) {
    const segments=new Map<string,typeof result.data.observations[number][]>();
    for(const point of result.data.detailedObservations??[]) {const id=point.sourceSegment??'';if(!segments.has(id)) segments.set(id,[]);segments.get(id)!.push(point);}
    for(const points of segments.values()) {const detail=inspectSourceLocations(points);for(const [id,value] of detail.suspects) quality.suspects.set(id,value);for(const id of detail.conflicts) quality.conflicts.add(id);}
  }
  self.postMessage({ ...result, quality });
};
