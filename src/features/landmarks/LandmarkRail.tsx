import { useEffect, useLayoutEffect, useRef } from 'react';
import type { Observation, ObservationId } from '../../domain/timeline';
import type { ObservationGroup } from './groups';
import type { LandmarkCandidate } from './geoapify';

export function mappedStops(groups: readonly ObservationGroup[], candidate: (group: ObservationGroup) => LandmarkCandidate | null) {
  return groups.flatMap(group => { const place = candidate(group); return place ? [{group,place}] : []; });
}
export type LandmarkStop = ReturnType<typeof mappedStops>[number];

export function LandmarkRail({ stops, selectedId, onSelect }: {
  stops: readonly LandmarkStop[]; selectedId: ObservationId | null; onSelect: (point: Observation) => void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const drag = useRef<{id: number; x: number; left: number; moved: boolean} | null>(null);
  const suppressClick = useRef(false);
  const selected = stops.findIndex(stop => stop.group.representative.id === selectedId);
  useLayoutEffect(() => { if (scroll.current) scroll.current.scrollLeft = 0; }, []);
  useEffect(() => {
    const node = scroll.current;if (!node) return;
    const wheel = (event: WheelEvent) => {
      // The ruler consumes wheel input, including at its edges, without zooming the map.
      if (event.ctrlKey) return;
      event.preventDefault();event.stopPropagation();
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      node.scrollLeft += delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? node.clientWidth : 1);
    };
    node.addEventListener('wheel',wheel,{passive:false});return () => node.removeEventListener('wheel',wheel);
  },[]);
  useEffect(() => {
    if (selected < 0 || !scroll.current) return;
    const node=scroll.current, button=node.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
    if (!button) return;
    const box=button.getBoundingClientRect(), viewport=node.getBoundingClientRect();
    if(box.left<viewport.left+8)node.scrollLeft-=viewport.left+8-box.left;
    else if(box.right>viewport.right-8)node.scrollLeft+=box.right-viewport.right+8;
  },[selected]);
  if (!stops.length) return null;
  return <nav className="landmark-rail" aria-label="장소 순서">
    <div ref={scroll} className="landmark-rail-scroll" tabIndex={0} aria-label="장소 번호 가로 스크롤"
      onPointerDown={event => {
        if (!event.isPrimary || event.button !== 0) return;
        suppressClick.current = false;
        drag.current = {id:event.pointerId, x:event.clientX, left:event.currentTarget.scrollLeft, moved:false};
      }}
      onPointerMove={event => {
        const state = drag.current;
        if (!state || state.id !== event.pointerId) return;
        const dx = event.clientX - state.x;
        if (!state.moved && Math.abs(dx) < 5) return;
        state.moved = true; suppressClick.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.dataset.dragging = 'true';
        event.currentTarget.scrollLeft = state.left - dx;
      }}
      onPointerUp={event => {
        if (drag.current?.id !== event.pointerId) return;
        drag.current = null; delete event.currentTarget.dataset.dragging;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={event => { drag.current = null; delete event.currentTarget.dataset.dragging; }}
      onLostPointerCapture={event => { if (event.target === event.currentTarget) { drag.current = null; delete event.currentTarget.dataset.dragging; } }}
      onClickCapture={event => { if (suppressClick.current && event.detail !== 0) { event.preventDefault(); event.stopPropagation(); } }}>
      <ol>{stops.map(({group,place},index)=><li key={group.groupId}><button data-place-id={group.representative.id} aria-label={`${index+1}. ${place.name}`} aria-pressed={selectedId===group.representative.id} title={`${index+1}. ${place.name}`} onClick={()=>onSelect(group.representative)}>{index+1}</button></li>)}</ol>
    </div>
  </nav>;
}
