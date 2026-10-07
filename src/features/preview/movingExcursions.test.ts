import { expect,it } from 'vitest';
import type { Observation } from '../../domain/timeline';
import { inspectLocations,inspectSourceLocations } from './locationQuality';
import { representativeRoute } from './representativeRoute';
import { LandmarkSession } from '../landmarks/session';
import { inspectMovingExcursions,segmentDistanceMeters } from './movingExcursions';

const point=(id:number,seconds:number,x:number,y=0):Observation=>({id:`observation:${id}`,coordinate:{latitude:y/111195,longitude:x/111195},time:{epochMs:Date.UTC(2040,0,1)+seconds*1000,sourceText:new Date(Date.UTC(2040,0,1)+seconds*1000).toISOString()}});
export const movingFixture=()=>[point(0,0,-200),point(1,30,-100),point(2,60,0),point(3,90,100,2000),point(4,120,200),point(5,150,300),point(6,180,400)];
it('detects a moving single excursion below the previous 300 km/h gate without mutating observations',()=>{
  const points=movingFixture(),before=JSON.stringify(points),report=inspectLocations(points);
  expect([...report.suspects.keys()]).toEqual([points[3]!.id]);
  expect(report.suspects.get(points[3]!.id)).toMatchObject({reason:'moving-excursion',count:1,beforeId:points[2]!.id,afterId:points[4]!.id});
  expect(report.suspects.get(points[3]!.id)!.entryKmh).toBeLessThan(300);
  expect(report.movingScreening?.detected).toBe(1);expect(JSON.stringify(points)).toBe(before);
});
it('detects a short consecutive burst but retains sustained remote observations',()=>{
  const points=movingFixture();points.splice(3,1,point(7,80,50,2000),point(8,90,80,2010));
  expect([...inspectLocations(points).suspects.keys()]).toEqual(['observation:7','observation:8']);
  const stay=[...movingFixture().slice(0,3),point(7,80,50,2000),point(8,150,80,2010),point(4,170,200),point(5,200,300),point(6,230,400)];
  expect(inspectLocations(stay).suspects.size).toBe(0);
});
it('preserves ordinary walking, continuous fast trains/flights, turns and incomplete context',()=>{
  for(const step of [20,2500,8000]) expect(inspectLocations(Array.from({length:40},(_,i)=>point(i,i*30,i*step))).suspects.size).toBe(0);
  const corner=movingFixture();corner[5]=point(5,150,200,-100);corner[6]=point(6,180,200,-200);
  expect(inspectLocations(corner).suspects.size).toBe(0);
  expect(inspectLocations(movingFixture().slice(1)).suspects.size).toBe(0);
  expect(inspectLocations(movingFixture().slice(0,-1)).suspects.size).toBe(0);
  const slow=movingFixture().map((p,i)=>i>=3?point(i,[0,30,60,300,540,570,600][i]!,[0,0,0,100,200,300,400][i]!,i===3?2000:0):p);
  expect(inspectLocations(slow).suspects.size).toBe(0);
});
it('requires distance, detour and speed together and treats accuracy only as weakening evidence',()=>{
  const small=movingFixture();small[3]=point(3,90,100,900);
  expect(inspectLocations(small).suspects.size).toBe(0);
  expect(inspectLocations(movingFixture().map(p=>({...p,accuracyMeters:2000}))).suspects.size).toBe(0);
  const onward=[...movingFixture().slice(0,4),point(4,120,200,2100),point(5,150,300,2200),point(6,180,400,2300)];
  expect(inspectLocations(onward).suspects.size).toBe(0);
  const modest=movingFixture();modest[3]=point(3,90,500,1200);modest[4]=point(4,120,1000);modest[5]=point(5,150,1100);modest[6]=point(6,180,1200);
  expect(inspectLocations(modest).suspects.size).toBe(0);
  const fastContext=movingFixture();fastContext[0]=point(0,0,-1600);fastContext[1]=point(1,30,-800);fastContext[5]=point(5,150,1000);fastContext[6]=point(6,180,1800);
  expect(inspectLocations(fastContext).suspects.size).toBe(0);
});
it('filters before place planning and restores the original point without altering the diagnosis',()=>{
  const observations=movingFixture(),quality=inspectLocations(observations),data={datasetId:'dataset:moving' as const,observations,recordedVisits:[],recordedPaths:[]};
  const route=representativeRoute(data,quality,[observations[3]!.id],new Set());
  const session=new LandmarkSession('synthetic');session.prepareRegions(data.datasetId,route.points,new Set(route.breaks.keys()));
  expect(session.pointCount).toBe(6);expect(session.attempts).toBe(0);
  expect(session.groups.flatMap(g=>g.sourceObservationIds)).not.toContain(observations[3]!.id);
  const restored=representativeRoute(data,quality,[],new Set());expect(restored.points).toEqual(observations);expect(restored.connections).toHaveLength(6);expect(quality.suspects.size).toBe(1);
  session.dispose();
});
it('never uses missing GPS spans, separate GPX segments, same-time conflicts or existing suspects as context',()=>{
  const separated=movingFixture().map((p,i,all)=>({...p,source:'gpx' as const,predecessorId:i>0&&i!==3?all[i-1]!.id:null}));
  expect(inspectSourceLocations(separated).suspects.size).toBe(0);
  const conflict=movingFixture();conflict[3]=point(3,60,100,2000);
  expect(inspectLocations(conflict).suspects.size).toBe(0);
  const gap=movingFixture().map((p,i)=>i>=3?{...p,time:{epochMs:p.time.epochMs+3600000,sourceText:new Date(p.time.epochMs+3600000).toISOString()}}:p);
  expect(inspectLocations(gap).suspects.size).toBe(0);
});
it('reports unfinished work instead of treating the remaining candidates as passed or rejected',()=>{
  const report=inspectMovingExcursions(movingFixture(),new Set(),new Map(),0);
  expect(report.suspects.size).toBe(0);expect(report.screening.skipped).toBe(report.screening.candidates);expect(report.screening.skipped).toBeGreaterThan(0);
});
it('measures against a finite path and crosses the date line locally',()=>{
  expect(segmentDistanceMeters({latitude:0,longitude:-179.9},{latitude:0,longitude:179.8},{latitude:0,longitude:-179.8})).toBeCloseTo(0);
  expect(segmentDistanceMeters({latitude:0,longitude:2},{latitude:0,longitude:0},{latitude:0,longitude:1})).toBeGreaterThan(110000);
});
