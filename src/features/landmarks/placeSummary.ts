import type { Observation, ObservationId } from '../../domain/timeline';
import type { LandmarkCandidate } from './geoapify';
import type { ObservationGroup } from './groups';

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
  edges: PlaceEdge[];
  byObservation: Map<ObservationId, PlaceNode>;
}
/** Display only. Keep episodes intact, and never bridge an unmatched/failed group. */
export function summarizePlaces(groups: readonly ObservationGroup[], candidate: (group: ObservationGroup) => LandmarkCandidate | null): PlaceSummary {
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
  const edges = new Map<string, PlaceEdge>();
  let previous: ObservationGroup | null = null;
  for (const group of groups) {
    const node = byObservation.get(group.representative.id);
    if (!node) { previous = null; continue; }
    const from = previous && byObservation.get(previous.representative.id);
    if (previous && from && from !== node) {
      const key = JSON.stringify([from.placeId,node.placeId].sort());
      let edge = edges.get(key);
      if (!edge) { edge = {key,from,to:node,transitions:[]}; edges.set(key,edge); }
      edge.transitions.push({from:previous.representative.id,to:group.representative.id});
    }
    previous = group;
  }
  return {nodes:[...nodes.values()],edges:[...edges.values()],byObservation};
}
