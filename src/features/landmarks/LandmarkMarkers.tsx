import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Marker, type Map as GlobeMap } from 'maplibre-gl';
import type { Observation } from '../../domain/timeline';
import { formatDiaryTime, type DisplayTimezone } from '../preview/observationTime';
import type { ObservationGroup } from './groups';
import type { LandmarkSession } from './session';
import { DiaryCard, diaryCandidate } from './TravelDiary';
import { clusterScreenPlaces, markerScale, type ScreenCluster } from './markerLayout';

export function LandmarkMarkers({ map, groups, session, selected, timezone, onSelect }: {
  map: GlobeMap; groups: readonly ObservationGroup[]; session: LandmarkSession;
  selected: Observation | null; timezone: DisplayTimezone; onSelect: (point: Observation) => void;
}) {
  const revision = useSyncExternalStore(session.subscribe, session.snapshot);
  const [layout, setLayout] = useState<{ clusters: ScreenCluster[]; zoom: number; width: number; height: number; top: number }>({clusters:[],zoom:0,width:0,height:0,top:0});
  const [hovered, setHovered] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    const update = () => {
      const width = map.getContainer().clientWidth, height = map.getContainer().clientHeight;
      const top = document.querySelector('.top-controls')?.getBoundingClientRect().bottom ?? 0;
      const points = groups.flatMap((group,index) => {
        if (!diaryCandidate(session, group)) return [];
        const p = map.project([group.representative.coordinate.longitude, group.representative.coordinate.latitude]);
        return p.x >= 0 && p.x <= width && p.y >= 0 && p.y <= height ? [{index,x:p.x,y:p.y,selected:group.representative.id === selected?.id}] : [];
      });
      const next = {clusters:clusterScreenPlaces(points,map.getZoom()),zoom:map.getZoom(),width,height,top};
      setLayout(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    update(); map.on('moveend',update); map.on('resize',update);
    const moving = () => { setHovered(null); setExpanded(null); setDismissed(false); };
    map.on('movestart',moving);
    return () => { map.off('moveend',update); map.off('resize',update); map.off('movestart',moving); };
  },[map,groups,session,revision,selected]);
  const hosts = useMemo(() => layout.clusters.map(cluster => ({cluster,host:document.createElement('div')})),[layout]);
  useEffect(() => {
    const chosen = layout.clusters.find(cluster => cluster.selected);
    const markers = hosts.map(({cluster,host}) => {
      const group = groups[cluster.indices[0]!]!;
      host.className = 'landmark-marker';
      const offset: [number,number] = chosen && !cluster.selected && Math.hypot(chosen.x-cluster.x,chosen.y-cluster.y)<48 ? [48,0] : [0,0];
      return new Marker({element:host,anchor:'center',offset}).setLngLat([group.representative.coordinate.longitude,group.representative.coordinate.latitude]).addTo(map);
    });
    return () => markers.forEach(marker => marker.remove());
  },[map,hosts,groups,layout]);
  const selectedIndex = groups.findIndex(group => group.representative.id === selected?.id);
  const singles = layout.clusters.filter(cluster => cluster.indices.length === 1);
  const automatic = markerScale(layout.zoom) === 'photos' ? (singles.find(cluster => {
    const candidate = diaryCandidate(session,groups[cluster.indices[0]!]!); return candidate && session.image(candidate.providerPlaceId);
  }) ?? singles[0])?.indices[0] ?? null : null;
  const preview = dismissed ? null : hovered ?? (selectedIndex >= 0 ? selectedIndex : automatic);
  const expand = (cluster: ScreenCluster, key: string) => {
    if (layout.zoom >= 19.9) { setExpanded(expanded === key ? null : key); setHovered(null); return; }
    const first = groups[cluster.indices[0]!]!.representative.coordinate;
    let west = first.longitude, east = first.longitude, south = first.latitude, north = first.latitude;
    for (const index of cluster.indices) {
      const c = groups[index]!.representative.coordinate;
      const longitude = first.longitude + ((c.longitude-first.longitude+540)%360)-180;
      west = Math.min(west,longitude); east = Math.max(east,longitude); south = Math.min(south,c.latitude); north = Math.max(north,c.latitude);
    }
    // Bound the zoom step so a dense cluster can be explored progressively.
    map.fitBounds([[west,south],[east,north]],{maxZoom:Math.min(20,layout.zoom+4),padding:{top:Math.min(layout.top+50,layout.height*.45),bottom:65,left:65,right:65},duration:350});
  };
  return <>{hosts.map(({cluster,host}) => {
    const index = cluster.indices[0]!, group = groups[index]!, candidate = diaryCandidate(session,group)!;
    const key = cluster.indices.join(','), multiple = cluster.indices.length > 1;
    const card = !multiple && preview === index;
    const width = Math.min(layout.width < 700 ? 280 : 310,layout.width-20);
    const shift = Math.max(10+width/2-cluster.x,Math.min(0,layout.width-10-width/2-cluster.x));
    const aboveSpace = cluster.y - layout.top - 30, belowSpace = layout.height - cluster.y - 30;
    const below = aboveSpace < 210 && belowSpace > aboveSpace;
    const previewStyle = {width,marginLeft:shift,maxHeight:Math.max(70,below?belowSpace:aboveSpace)};
    host.style.zIndex = card || expanded === key ? '5' : cluster.selected ? '4' : '1';
    return createPortal(<div className="landmark-marker-content" data-map-zoom={layout.zoom} data-scale={markerScale(layout.zoom)} onClick={event=>event.stopPropagation()}
      onMouseEnter={()=>{if(!multiple){setHovered(index);setDismissed(false);}}} onMouseLeave={()=>setHovered(null)}
      onFocus={()=>{if(!multiple){setHovered(index);setDismissed(false);}}} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setHovered(null);}}
      onKeyDown={event=>{if(event.key==='Escape'){setHovered(null);setExpanded(null);setDismissed(true);}}}>
      <button className={multiple || markerScale(layout.zoom)==='overview' && !cluster.selected ? 'landmark-cluster' : `landmark-pin${cluster.selected?' is-selected':''}`}
        data-count={cluster.indices.length} data-index={multiple ? undefined : index}
        aria-label={multiple ? `기록 지점 ${cluster.indices.length}개 ${layout.zoom>=19.9?'목록 보기':'확대'}` : `${index+1}. ${candidate.name} 상세 보기`}
        title={multiple ? `장소가 연결된 기록 지점 ${cluster.indices.length}개 · 클릭해서 펼치기` : candidate.name}
        onClick={()=>multiple?expand(cluster,key):onSelect(group.representative)}>
        <span>{multiple ? cluster.indices.length : markerScale(layout.zoom)==='overview' && !cluster.selected ? '1' : index+1}</span>
        {!multiple && cluster.label && <strong>{candidate.name}</strong>}
      </button>
      {card && <div className={`landmark-preview diary-balloon${below?' is-below':''}`} style={previewStyle}>
        <DiaryCard group={group} index={index} session={session} timezone={timezone} onSelect={onSelect}/>
      </div>}
      {multiple && expanded===key && <div className={`landmark-preview cluster-records${below?' is-below':''}`} style={previewStyle} role="region" aria-label="겹친 기록 지점 목록">
        <strong>겹친 기록 지점 {cluster.indices.length}개</strong><button className="cluster-close" onClick={()=>setExpanded(null)} aria-label="지점 목록 닫기">×</button>
        <ul>{cluster.indices.map(i=><li key={groups[i]!.groupId}><button onClick={()=>{setExpanded(null);onSelect(groups[i]!.representative);}}><strong>{i+1}. {diaryCandidate(session,groups[i]!)!.name}</strong><small>{formatDiaryTime(groups[i]!.representative.time,timezone)}</small></button></li>)}</ul>
      </div>}
    </div>,host,key);
  })}</>;
}
