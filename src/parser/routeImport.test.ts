import { expect,it } from 'vitest';
import { parseGpx,parseTimelineRoutes } from './routeImport';
import { rawTimestamp } from './rawPreview';
const stamp=(minute:number)=>new Date(Date.UTC(2040,0,1)+minute*60000).toISOString();
const parse=(value:unknown)=>parseTimelineRoutes(JSON.stringify(value),'dataset:test');
it('preserves raw and detail observations as separate sources in mixed files',()=>{
  const result=parse({rawSignals:[{position:{LatLng:'0°, 0°',timestamp:stamp(0),accuracyMeters:3}}],semanticSegments:[{startTime:stamp(0),endTime:stamp(5),timelinePath:[{point:'geo:0,0',time:stamp(1)},{point:'geo:0,0.001',time:stamp(2)}],visit:{topCandidate:{placeLocation:{latLng:'geo:0,0'}}}}]});
  expect(result.ok).toBe(true);if(!result.ok)return;
  expect(result.counts).toMatchObject({input:3,accepted:3});expect(result.data.observations).toHaveLength(1);expect(result.data.detailedObservations).toHaveLength(2);expect(result.data.recordedVisits).toHaveLength(1);
  expect(result.data.detailedObservations![1]!.predecessorId).toBe(result.data.detailedObservations![0]!.id);
  expect(result.data.observations[0]!.accuracyMeters).toBe(3);
});
it('does not fill missing times or bridge invalid points and reversed source order',()=>{
  const result=parse({semanticSegments:[{timelinePath:[{point:'0,0',time:stamp(0)},{point:'0,1'},{point:'0,0',time:stamp(3)},{point:'0,0',time:stamp(2)}]}]});
  expect(result.ok).toBe(true);if(!result.ok)return;
  expect(result.counts.invalidPositions).toBe(1);
  expect(result.data.detailedObservations!.every(p=>p.predecessorId===null)).toBe(true);
});
it('preserves nanosecond precision for explicit relative offsets and rejects outside-segment times',()=>{
  const result=parse({semanticSegments:[{startTime:'2040-01-01T00:00:00.123456789Z',endTime:stamp(2),timelinePath:[{point:'0,0',durationMinutesOffset:'1'},{point:'0,0',time:stamp(3)}]}]});
  expect(result.ok).toBe(true);if(!result.ok)return;
  expect(result.data.detailedObservations![0]!.time.sourceText).toBe('2040-01-01T00:01:00.123456789Z');expect(result.counts.invalidPositions).toBe(1);
  expect(rawTimestamp(result.data.detailedObservations![0]!.time.sourceText)!.ns-rawTimestamp('2040-01-01T00:00:00.123456789Z')!.ns).toBe(60000000000n);
});
it('imports GPX while preserving invalid-point and segment barriers',()=>{
  const result=parseGpx('<gpx xmlns="http://www.topografix.com/GPX/1/0" version="1.0"><trk><trkseg><trkpt lat="0" lon="0"><time>'+stamp(0)+'</time></trkpt><trkpt lat="0" lon="0"/><trkpt lat="0" lon="0"><time>'+stamp(2)+'</time></trkpt></trkseg><trkseg><trkpt lat="0" lon="0"><time>'+stamp(3)+'</time></trkpt></trkseg></trk></gpx>','dataset:gpx');
  expect(result.ok).toBe(true);if(!result.ok)return;
  expect(result.counts).toMatchObject({input:4,accepted:3,invalidPositions:1});expect(result.data.observations.every(p=>p.predecessorId===null)).toBe(true);
  expect(result.data.observations.every(p=>p.accuracyMeters===undefined)).toBe(true);
});
it('rejects malformed GPX and DTD without echoing XML or keeping partial data',()=>{
  for(const text of ['<PRIVATE>', '<!DOCTYPE gpx SYSTEM "https://PRIVATE.invalid"><gpx/>']) {const result=parseGpx(text,'dataset:test');expect(result.ok).toBe(false);expect(JSON.stringify(result)).not.toContain('PRIVATE');}
});
it('enforces the combined input point limit without silently truncating paths',()=>{
  const result=parse({rawSignals:[{position:{LatLng:'0,0',timestamp:stamp(0)}}],semanticSegments:[{timelinePath:Array(100000).fill({point:'0,0',time:stamp(0)})}]});
  expect(result).toEqual({ok:false,code:'INPUT_LIMIT'});
});
