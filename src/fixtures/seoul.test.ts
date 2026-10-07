import text from '../../docs/demo/fully-synthetic.seoul-2026-10.json?raw';
import { expect, it } from 'vitest';
import { buildSeoulDemo, seoulDays, seoulPlaces } from './seoul';
import { parseTimeline } from '../parser';
import { inspectLocations } from '../features/preview/locationQuality';
import { groupByLandmark } from '../features/landmarks/groups';
import { mappedStops } from '../features/landmarks/LandmarkRail';
import { separationKm } from '../features/preview/analysis';
import type { LandmarkCandidate } from '../features/landmarks/geoapify';

it('공개 서울 JSON이 생성 소스와 같고 7일의 소규모 기록을 모두 읽는다', async () => {
  const {timeline}=buildSeoulDemo();
  expect(JSON.parse(text)).toEqual(timeline);
  expect(timeline.rawSignals.length).toBeLessThan(150);
  expect(text.length).toBeLessThan(25000);
  const parsed=await parseTimeline(text,'dataset:seoul-demo');
  if(!parsed.ok) throw new Error('SEOUL_DEMO_PARSE_FAILED');
  expect(parsed.counts?.accepted).toBe(timeline.rawSignals.length);
  const points=parsed.data.observations;
  expect([...new Set(timeline.rawSignals.map(s=>s.position.timestamp.slice(0,10)))]).toEqual(seoulDays.map((_,i)=>`2026-10-0${i+1}`));
  for(const signal of timeline.rawSignals) expect(signal.position.timestamp.endsWith('+09:00')).toBe(true);
  for(let i=0;i<points.length;i++) {
    const p=points[i]!;
    // All legs stay inside the compact northern downtown envelope; no Han/Cheonggye crossing.
    expect(p.coordinate.latitude).toBeGreaterThan(37.573);
    expect(p.coordinate.latitude).toBeLessThan(37.584);
    expect(p.coordinate.longitude).toBeGreaterThan(126.975);
    expect(p.coordinate.longitude).toBeLessThan(126.997);
    if(i) {
      const previous=points[i-1]!;
      const elapsed=p.time.epochMs-previous.time.epochMs;
      expect(elapsed).toBeGreaterThan(0);
      if(p.time.sourceText.slice(0,10)===previous.time.sourceText.slice(0,10)) {
        expect(elapsed).toBeLessThanOrEqual(30*60000);
        expect(separationKm(p.coordinate,previous.coordinate)/(elapsed/3600000)).toBeLessThan(7);
      }
    }
  }
  const quality=inspectLocations(points);
  expect(quality.suspects.size).toBe(0);
  expect(quality.conflicts.size).toBe(0);
});

it('가상 장소 응답으로 체류 지점 묶기와 재방문 번호 통합을 시연하며 원본을 보존한다', async () => {
  const {timeline,visits}=buildSeoulDemo();
  const parsed=await parseTimeline(JSON.stringify(timeline),'dataset:seoul-demo');
  if(!parsed.ok) throw new Error('SEOUL_DEMO_PARSE_FAILED');
  const points=parsed.data.observations;
  const matches=new Map();
  for(const visit of visits) for(const point of points.slice(visit.first,visit.first+visit.count)) {
    const place=seoulPlaces[visit.place];
    const candidate:LandmarkCandidate={provider:'wikimedia',providerPlaceId:`synthetic:${visit.place}`,name:place.name,
      coordinate:{latitude:place.coordinate[0],longitude:place.coordinate[1]},categories:[],distanceMeters:0,attribution:'synthetic test'};
    matches.set(point.id,[candidate]);
  }
  const groups=groupByLandmark(parsed.data.datasetId,points,matches);
  const stops=mappedStops(groups,g=>matches.get(g.representative.id)?.[0]??null);
  expect(stops).toHaveLength(8);
  expect(stops.flatMap(s=>s.groups)).toHaveLength(21);
  expect(groups.flatMap(g=>g.sourceObservationIds)).toEqual(points.map(p=>p.id));
  expect(stops.every(s=>s.groups.every(g=>g.observationCount===4))).toBe(true);
});
