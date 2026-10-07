import { expect, it } from 'vitest';
import type { ObservationId, TimelineData } from '../../domain/timeline';
import { parseGpx } from '../../parser/routeImport';
import { representativeRoute } from './representativeRoute';
import { gapLines } from './mapData';
import { observationDay } from './importDates';
import { groupObservations } from '../landmarks/groups';
import { summarizePlaces } from '../landmarks/placeSummary';

const point = (minute: number, tag = 'trkpt') => `<${tag} lat="37" lon="${127 + minute * .001}"><time>${new Date(Date.UTC(2040,0,1) + minute * 60000).toISOString()}</time></${tag}>`;
const segment = (body: string) => `<trkseg>${body}</trkseg>`;
const track = (body: string) => `<trk>${body}</trk>`;
function parse(body: string) {
  const result = parseGpx(`<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1">${body}</gpx>`, 'dataset:gaps');
  if (!result.ok) throw new Error('SYNTHETIC_FIXTURE');
  return result.data;
}
function project(data: TimelineData, excluded: ObservationId[] = [], conflicts: ObservationId[] = []) {
  return representativeRoute(data, { suspects: new Map(), conflicts: new Set(conflicts) }, excluded, new Set(), new Map(data.observations.map(p => [p.id, observationDay(p,'UTC')])));
}
it('keeps a long GPX gap separate from solid edges without changing originals or mapping boundaries', () => {
  const data = parse(track(segment(point(0) + point(1) + point(40)))), before = JSON.stringify(data);
  const route = project(data);
  expect(route.connections).toHaveLength(1);
  expect(route.gapConnections.map(e => [e.from.id,e.to.id])).toEqual([[data.observations[1]!.id,data.observations[2]!.id]]);
  expect(route.breaks.get(data.observations[2]!.id)).toBe('long-gap');
  expect(JSON.stringify(data)).toBe(before);
  expect(gapLines(route.gapConnections,null,null).features[0]!.properties).toEqual({gap:true,highlighted:false});
});
it('connects successive GPX segments only within the same track', () => {
  expect(project(parse(track(segment(point(0)) + segment(point(1))))).gapConnections).toHaveLength(1);
  expect(project(parse(track(segment(point(0))) + track(segment(point(1))))).gapConnections).toHaveLength(0);
  expect(project(parse(point(0,'wpt') + point(40,'wpt'))).gapConnections).toHaveLength(0);
});
it('does not bridge malformed, hidden, conflicting, reversed or different-day records', () => {
  const data = parse(track(segment(point(0) + point(1) + point(40))));
  expect(project(data,[data.observations[1]!.id]).gapConnections).toHaveLength(0);
  expect(project(data,[],[data.observations[2]!.id]).gapConnections).toHaveLength(0);
  expect(project(parse(track(segment(point(0) + '<trkpt lat="37" lon="127"/>' + point(40))))).gapConnections).toHaveLength(0);
  expect(project(parse(track(segment(point(0) + point(40) + point(20))))).gapConnections).toHaveLength(0);
  expect(project(parse(track(segment(point(1439) + point(1470))))).gapConnections).toHaveLength(0);
  expect(project({...data,format:'timeline'}).gapConnections).toHaveLength(0);
});
it('uses summarized display endpoints without adding mapping groups or recorded edges', () => {
  const data = parse(track(segment(point(0) + point(40)))), route = project(data);
  const groups = groupObservations(data.datasetId,route.points);
  const summary = summarizePlaces(groups,() => null,new Set(route.breaks.keys()));
  const before = JSON.stringify(summary);
  expect(summary.edges).toHaveLength(0);
  expect(gapLines(route.gapConnections,summary,groups[0]!.representative.id).features[0]!.properties?.highlighted).toBe(true);
  expect(JSON.stringify(summary)).toBe(before);
  expect(gapLines(route.gapConnections,{...summary,waypoints:[]},null).features).toHaveLength(0);
});
