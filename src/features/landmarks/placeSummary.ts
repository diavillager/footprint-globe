import { separationKm } from '../preview/analysis';
import type { Coordinate, Observation, ObservationId } from '../../domain/timeline';
import type { LandmarkCandidate } from './geoapify';
import type { ObservationGroup } from './groups';

// A fixed anchor bounds the display cluster; proximity is never chained transitively.
export const DISPLAY_RADIUS_METERS = 50;
const earthRadiusMeters = 6371008.8;
function displayCell(coordinate: Coordinate) {
  const lat=coordinate.latitude*Math.PI/180, lon=coordinate.longitude*Math.PI/180;
  const scale=earthRadiusMeters/DISPLAY_RADIUS_METERS;
  return [Math.floor(scale*Math.cos(lat)*Math.cos(lon)), Math.floor(scale*Math.cos(lat)*Math.sin(lon)), Math.floor(scale*Math.sin(lat))] as const;
}
export interface PlaceNode {
  placeId: string;
  point: Observation;
  groups: ObservationGroup[];
}
export interface PlaceEdge {
  key: string;
  from: PlaceNode;
  to: PlaceNode;
  transitions: {from: ObservationId; to: ObservationId}[];
}
export interface PlaceSummary {
  nodes: PlaceNode[];
  waypoints: PlaceNode[];
  edges: PlaceEdge[];
  byObservation: Map<ObservationId, PlaceNode>;
}
/** Display only. Keep record identity while merging mapped places and nearby unmatched waypoints. */
export function summarizePlaces(groups: readonly ObservationGroup[], candidate: (group: ObservationGroup) => LandmarkCandidate | null, breakBefore: ReadonlySet<ObservationId> = new Set()): PlaceSummary {
  const nodes = new Map<string, PlaceNode>(), distances = new Map<string, number>();
  const byObservation = new Map<ObservationId, PlaceNode>();
  for (const group of groups) {
    const place = candidate(group);
    if (!place) continue;
    const id = place.providerPlaceId;
    let node = nodes.get(id);
    if (!node) { node = {placeId:id, point:group.representative, groups:[]}; nodes.set(id,node); distances.set(id,place.distanceMeters); }
    else if (place.distanceMeters < distances.get(id)!) { node.point = group.representative; distances.set(id,place.distanceMeters); }
    node.groups.push(group); byObservation.set(group.representative.id,node);
  }
  const waypoints: PlaceNode[] = [], buckets = new Map<string,PlaceNode[]>();
  const routeNodes = new Map(byObservation);
  for (const group of groups) {
    const point = group.representative;
    if (routeNodes.has(point.id)) continue;
    const [x,y,z]=displayCell(point.coordinate);
    let closest: PlaceNode | undefined, distance=DISPLAY_RADIUS_METERS;
    for(let dx=-1;dx<=1;dx++) for(let dy=-1;dy<=1;dy++) for(let dz=-1;dz<=1;dz++) {
      for(const node of buckets.get(`${x+dx},${y+dy},${z+dz}`) ?? []) {
        const meters=separationKm(point.coordinate,node.point.coordinate)*1000;
        if(meters<=DISPLAY_RADIUS_METERS && (!closest || meters<distance)) {closest=node;distance=meters;}
      }
    }
    if (!closest) {
      closest={placeId:JSON.stringify(['unmapped',group.groupId]),point,groups:[]};
      waypoints.push(closest);
      const key=`${x},${y},${z}`, bucket=buckets.get(key) ?? [];
      bucket.push(closest);buckets.set(key,bucket);
    }
    closest.groups.push(group);routeNodes.set(point.id,closest);
  }
  const edges = new Map<string, PlaceEdge>();
  const route = groups.map(group => ({group,node:routeNodes.get(group.representative.id)!}));
  for (let index = 1; index < route.length; index++) {
    const previous = route[index-1]!, {group,node} = route[index]!, from = previous.node;
    if (from !== node && !breakBefore.has(group.sourceObservationIds[0]!)) {
      const key = JSON.stringify([from.placeId,node.placeId].sort());
      let edge = edges.get(key);
      if (!edge) { edge = {key,from,to:node,transitions:[]}; edges.set(key,edge); }
      edge.transitions.push({from:previous.group.representative.id,to:group.representative.id});
    }
  }
  return {nodes:[...nodes.values()],waypoints,edges:[...edges.values()],byObservation};
}
