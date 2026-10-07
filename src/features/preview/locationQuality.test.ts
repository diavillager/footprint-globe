import { expect, it } from 'vitest';
import type { Observation } from '../../domain/timeline';
import { parseRawPreview } from '../../parser/rawPreview';
import { inspectLocations, projectLocations } from './locationQuality';
import { groupByLandmark } from '../landmarks/groups';
import { summarizePlaces } from '../landmarks/placeSummary';
import type { LandmarkCandidate } from '../landmarks/geoapify';
import { LandmarkSession } from '../landmarks/session';

const point = (id: number, seconds: number, longitude = 0, accuracyMeters?: number): Observation => ({
  id:`observation:${id}`, coordinate:{latitude:0,longitude}, time:{epochMs:seconds*1000,sourceText:new Date(seconds*1000).toISOString()},
  ...(accuracyMeters === undefined ? {} : {accuracyMeters}),
});
const single = () => [point(0,0),point(1,60),point(2,70,.02),point(3,80),point(4,140)];
const burst = () => [point(0,0),point(1,60),point(2,70,.02),point(3,90,.0201),point(4,100),point(5,160)];
const ids = (points: readonly Observation[]) => points.map(point => point.id);
const candidate = (id: string): LandmarkCandidate => ({provider:'geoapify', providerPlaceId:id, name:'합성 장소',coordinate:{latitude:0,longitude:0},categories:[],distanceMeters:0,attribution:'synthetic'});

it('preserves original observations, finds single/burst excursions, and never bridges hidden points', () => {
  for (const points of [single(),burst()]) {
    const original=structuredClone(points), report=inspectLocations(points);
    expect([...report.suspects.keys()]).toEqual(ids(points.slice(2,-2)));
    const view=projectLocations(points,report,true,new Set());
    expect(ids(view.points)).toEqual(ids([points[0]!,points[1]!,...points.slice(-2)]));
    expect(view.connections).toHaveLength(2);
    expect(view.breaks.get(points.at(-2)!.id)).toBe('hidden');
    expect(points).toEqual(original);
    expect(view.points[0]).toBe(points[0]);
  }
});
it('requires both speeds, return, duration and stable context instead of one high-speed edge', () => {
  const cases = [
    [point(0,0),point(1,60),point(2,70,.02),point(3,200),point(4,260)], // slow return
    [point(0,0),point(1,60),point(2,70,.02),point(3,80,.04),point(4,140,.04)], // onward
    [point(0,0),point(1,60),point(2,70,.02),point(3,400,.02),point(4,410),point(5,470)], // sustained stay
    [point(0,0,.01),...single().slice(1)], // moving before
    [...single().slice(0,-1),point(4,140,.01)], // moving after
    [point(0,0),point(1,60),point(2,70,.02)], // no return evidence
    [point(0,0),point(1,60),point(2,70,.002),point(3,80),point(4,140)], // small excursion
    [point(0,0),point(1,0),point(2,10,.02),point(3,20),point(4,80)], // duplicate is not persistence
  ];
  for (const points of cases) expect(inspectLocations(points).suspects.size).toBe(0);
});
it('keeps walking, real train/flight, sustained remote stays and later revisits', () => {
  for (const points of [
    Array.from({length:100},(_,i)=>point(i,i*60,i*.0001)),
    [point(0,0),point(1,60),point(2,1260,1),point(3,2460,2),point(4,2520,2)],
    [point(0,0),point(1,60),point(2,7200,18),point(3,7260,18)],
    [point(0,0),point(1,60),point(2,70,.02),point(3,86400,.02),point(4,86410),point(5,86470)],
  ]) {
    const report=inspectLocations(points);
    expect(report.suspects.size).toBe(0);
    expect(projectLocations(points,report,true,new Set()).points).toEqual(points);
  }
});
it('breaks gaps over 30 minutes, retains boundary links, and never uses a distant context across a gap', () => {
  const points=[point(0,0),point(1,1800),point(2,3601),point(3,3611,.02),point(4,3621),point(5,3681)];
  const report=inspectLocations(points), view=projectLocations(points,report,true,new Set());
  expect(report.suspects.size).toBe(0);
  expect(view.breaks.get(points[2]!.id)).toBe('long-gap');
  expect(view.connections[0]!.to).toBe(points[1]);
});
it('keeps both conflicting same-time coordinates and severs incoming/outgoing connections', () => {
  const points=[point(0,0),point(1,60),point(2,60,.02),point(3,70),point(4,130)];
  const report=inspectLocations(points), view=projectLocations(points,report,true,new Set());
  expect(report.suspects.size).toBe(0);
  expect([...report.conflicts]).toEqual(ids(points.slice(1,3)));
  expect(view.points).toEqual(points);
  expect(view.connections).toHaveLength(1);
});
it('finds nonadjacent conflicts within one timestamp batch without confusing distinct nanoseconds', () => {
  const points=[point(0,0),point(1,0,.006),point(2,0,.012)];
  expect(inspectLocations(points).conflicts.size).toBe(3);
  const parsed=parseRawPreview(JSON.stringify({rawSignals:[
    {position:{LatLng:'0°, 0°',timestamp:'2040-01-01T00:00:00.000000001Z'}},
    {position:{LatLng:'0°, 1°',timestamp:'2040-01-01T00:00:00.000000002Z'}},
  ]}),'dataset:nanoseconds');
  if (!parsed.ok) throw new Error('synthetic fixture');
  expect(inspectLocations(parsed.data.observations).conflicts.size).toBe(0);
  const dense=Array.from({length:100000},(_,i)=>point(i,0,(i%100)*.000001));
  expect(inspectLocations(dense).conflicts.size).toBe(0);
});
it('honors maximum burst and round-trip durations', () => {
  const atLimit=[point(0,0),point(1,60),point(2,70,.02),point(3,370,.02),point(4,380),point(5,440)];
  expect(inspectLocations(atLimit).suspects.size).toBe(2);
  expect(inspectLocations(atLimit.map(p=>p.id==='observation:3'?point(3,370.001,.02):p)).suspects.size).toBe(0);
  const trip=[point(0,0),point(1,60),point(2,250,.5),point(3,300,.5),point(4,660),point(5,720)];
  expect(inspectLocations(trip).suspects.size).toBe(2);
  expect(inspectLocations(trip.map(p=>p.id==='observation:4'?point(4,660.001):p)).suspects.size).toBe(0);
});
it('restores individual IDs without changing diagnosis; partial restoration does not bridge the remaining hidden point', () => {
  const points=burst(),report=inspectLocations(points), restored=new Set([points[2]!.id]);
  const partial=projectLocations(points,report,true,restored);
  expect(partial.excluded.size).toBe(1);
  expect(partial.points).toContain(points[2]);
  expect(partial.breaks.get(points[4]!.id)).toBe('hidden');
  expect(projectLocations(points,report,false,new Set()).points).toEqual(points);
  expect(projectLocations(points,report,true,new Set(report.suspects.keys())).connections).toHaveLength(points.length-1);
  expect(report.suspects.size).toBe(2);
});
it('accuracy is optional, finite, nonnegative and never invented or converted from strings', () => {
  for (const value of [undefined,null,-1,'20',0,12.5]) {
    const parsed=parseRawPreview(JSON.stringify({rawSignals:[{position:{LatLng:'0°, 0°',timestamp:'2040-01-01T00:00:00Z',accuracyMeters:value}}]}),'dataset:quality');
    expect(parsed.ok).toBe(true); if (!parsed.ok) continue;
    const observation=parsed.data.observations[0]!;
    if (typeof value==='number' && value>=0) expect(observation.accuracyMeters).toBe(value);
    else expect(Object.hasOwn(observation,'accuracyMeters')).toBe(false);
  }
  const points=single().map(point=>({...point,accuracyMeters:5000}));
  expect(inspectLocations(points).suspects.size).toBe(0);
  expect(inspectLocations(single().map(point=>({...point,accuracyMeters:5}))).suspects.values().next().value?.accuracyUsed).toBe(true);
});
it('filters before planning requests, splits same-place visits at breaks, and cannot resurrect broken summary edges', () => {
  const points=single(), view=projectLocations(points,inspectLocations(points),true,new Set()), breaks=new Set(view.breaks.keys());
  const session=new LandmarkSession('synthetic'); session.prepareRegions('dataset:quality',view.points,breaks);
  expect(session.pointCount).toBe(4); expect(session.consent).toBe(false); expect(session.attempts).toBe(0);
  const matches=new Map(view.points.map(point=>[point.id,[candidate('same')]]));
  const groups=groupByLandmark('dataset:quality',view.points,matches,breaks);
  expect(groups).toHaveLength(2);
  expect(groups.flatMap(group=>group.sourceObservationIds)).not.toContain(points[2]!.id);
  const summary=summarizePlaces(groups,group=>candidate(group.groupId),breaks);
  expect(summary.nodes).toHaveLength(2); expect(summary.edges).toHaveLength(0);
  session.dispose();
});
it('handles 100,000 stationary observations without recursive scans or fabricated suspects', () => {
  const points=Array.from({length:100000},(_,i)=>point(i,i));
  expect(inspectLocations(points).suspects.size).toBe(0);
});
