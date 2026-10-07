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
    <div className="landmark-rail-heading"><strong>장소 순서 <span>{stops.length}개</span></strong><span>{selected>=0 ? `${selected+1}. ${stops[selected]!.place.name}` : '번호를 눌러 장소 보기'}</span></div>
    <div className="landmark-rail-row">
      <button className="rail-arrow" aria-label="이전 번호 보기" onClick={()=>scroll.current?.scrollBy({left:-scroll.current.clientWidth*.7,behavior:'smooth'})}>‹</button>
      <div ref={scroll} className="landmark-rail-scroll" tabIndex={0} aria-label="장소 번호 가로 스크롤">
        <ol>{stops.map(({group,place},index)=><li key={group.groupId}><button data-place-id={group.representative.id} aria-label={`${index+1}. ${place.name}`} aria-pressed={selectedId===group.representative.id} title={`${index+1}. ${place.name}`} onClick={()=>onSelect(group.representative)}>{index+1}</button></li>)}</ol>
      </div>
      <button className="rail-arrow" aria-label="다음 번호 보기" onClick={()=>scroll.current?.scrollBy({left:scroll.current.clientWidth*.7,behavior:'smooth'})}>›</button>
    </div>
  </nav>;
}
