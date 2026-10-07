import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import * as sdk from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { Observation } from '../../domain/timeline';
import type { Connection } from './analysis';
import { formatDiaryTime, type DisplayTimezone } from './observationTime';
import { mapTilerKey } from '../../map-config';
import { mapConnections, mapPoints, summaryLines } from './mapData';
import type { ObservationGroup } from '../landmarks/groups';
import type { LandmarkSession } from '../landmarks/session';
import type { PlaceSummary } from '../landmarks/placeSummary';
import { DiaryCard, diaryCandidate } from '../landmarks/TravelDiary';

type Props = {
  summary: PlaceSummary | null; groups: readonly ObservationGroup[]; originalPoints: readonly Observation[];
  points: readonly Observation[]; connections: readonly Connection[];
  selectedObservation: Observation | null; focusRevision: number; focusMode: 'detail' | 'rail';
  landmarkSession: LandmarkSession;
  timezone: DisplayTimezone; showPointPopup: boolean; candidates: readonly Observation[]; onClose: () => void;
  onMapInteract: () => void;
  onPick: (points: Observation[]) => void; onSelect: (point: Observation) => void;
};
sdk.setWorkerUrl(workerUrl);

export default function MapTilerGlobe(props: Props) {
  const landmarkRevision = useSyncExternalStore(props.landmarkSession.subscribe, props.landmarkSession.snapshot);
  const markerEntries = useMemo(() => props.summary ? props.summary.nodes.map(node => {
    const group = node.groups.find(group => group.representative.id === props.selectedObservation?.id) ?? node.groups[0]!;
    return {group, index:props.groups.indexOf(group), point:node.point, count:node.groups.length};
  }) : [], [props.summary,props.groups,props.selectedObservation]);
  const [visibleIndices, setVisibleIndices] = useState<number[]>([]);
  const diaryHosts = useMemo(() => visibleIndices.flatMap(index => {
    const entry = markerEntries[index];
    return entry ? [{ ...entry, host: document.createElement('div') }] : [];
  }), [markerEntries, visibleIndices]);
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<sdk.Map | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [popupHost] = useState(() => document.createElement('div'));
  const focusedRevision = useRef(props.focusRevision);
  const points = useMemo(() => mapPoints(props.points), [props.points]);
  const lines = useMemo(() => props.summary ? summaryLines(props.summary,props.selectedObservation?.id ?? null) : mapConnections(props.connections, false, 0), [props.connections,props.summary,props.selectedObservation]);
  useEffect(() => {
    if (!container.current || !mapTilerKey) return;
    setReady(false); setFailed(false);
    let active = true;
    let instance: sdk.Map | null = null;
    let inputCanvas: HTMLCanvasElement | null = null;
    const userMovement = (event: Event) => {
      if (event.type === 'wheel' || event instanceof KeyboardEvent && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-','='].includes(event.key)) latest.current.onMapInteract();
    };
    const resize = new ResizeObserver(() => instance?.resize());
    try {
      instance = new sdk.Map({ container: container.current, style: `https://api.maptiler.com/maps/base-v4/style.json?key=${encodeURIComponent(mapTilerKey)}`,
        center: [127.5, 38.5], zoom: 5, maxZoom: 20,
        transformRequest: url => {
          const resource = new URL(url, window.location.href);
          if (resource.origin !== 'https://api.maptiler.com' || !/^\/(maps|tiles|fonts|resources|sprites)\//.test(resource.pathname)) return { url: 'data:application/json,{}' };
          resource.searchParams.set('key', mapTilerKey);
          return { url: resource.href };
        },
      });
      map.current = instance;
      inputCanvas = instance.getCanvas();
      inputCanvas.addEventListener('wheel',userMovement,{capture:true,passive:true});
      inputCanvas.addEventListener('keydown',userMovement);
      resize.observe(container.current);
      instance.on('error', () => { if (active) setFailed(true); });
      instance.on('load', () => {
        if (!active || !instance) return;
        instance.setProjection({ type: 'globe' });
        instance.fitBounds([[124, 33], [131, 43]], { padding: { top: 130, bottom: 45, left: 45, right: 65 }, duration: 0 });
        instance.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
        instance.addControl(new sdk.NavigationControl());
        // Keep provider filters and disputed boundaries; only strengthen visibility.
        for (const layer of instance.getStyle().layers) {
          if (layer.type === 'symbol' && JSON.stringify(layer.layout?.['text-field'] ?? '').includes('name')) instance.setLayoutProperty(layer.id, 'text-field', ['coalesce', ['get', 'name:ko'], ['get', 'name'], ['get', 'name:en'], '']);
          if (layer.type === 'line' && ['country_border', 'country_border_disputed', 'sub_border'].includes(layer['source-layer'] ?? '')) {
            instance.setPaintProperty(layer.id, 'line-color', '#8656a1');
            instance.setPaintProperty(layer.id, 'line-opacity', .85);
          }
        }
        instance.addSource('observations', { type: 'geojson', data: mapPoints(latest.current.points), maxzoom: 20 });
        instance.addSource('connections', { type: 'geojson', data: mapConnections(latest.current.connections, false, 0), maxzoom: 20, tolerance: 0 });
        instance.addLayer({ id: 'trace-solid', type: 'line', source: 'connections', filter: ['!=', ['get', 'summary'], true], paint: { 'line-color': '#087e78', 'line-width': 3 } });
        instance.addLayer({ id: 'place-summary', type:'line', source:'connections', filter:['==',['get','summary'],true], paint:{'line-color':'#087e78','line-width':2,'line-dasharray':[3,3],'line-opacity':.5} });
        instance.addLayer({ id:'place-summary-selected',type:'line',source:'connections',filter:['==',['get','highlighted'],true],paint:{'line-color':'#c15c15','line-width':4,'line-dasharray':[3,2]} });
        instance.addLayer({ id: 'observations', type: 'circle', source: 'observations', paint: { 'circle-radius': 4, 'circle-color': '#087e78', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 } });
        instance.addLayer({ id: 'selected', type: 'circle', source: 'observations', filter: ['==', ['get', 'observationId'], ''], paint: { 'circle-radius': 9, 'circle-color': '#ffb74d', 'circle-opacity': .4, 'circle-stroke-color': '#ac4200', 'circle-stroke-width': 3 } });
        instance.on('movestart', event => { if (event.originalEvent) latest.current.onMapInteract(); });
        instance.on('click', event => {
          if (!instance) return;
          const ids = new Set(instance.queryRenderedFeatures([[event.point.x - 5, event.point.y - 5], [event.point.x + 5, event.point.y + 5]], { layers: ['observations'] }).map(feature => feature.properties.observationId));
          const current = latest.current;
          const found = current.summary
            ? current.summary.nodes.filter(node => ids.has(node.point.id)).flatMap(node => node.groups.map(group => group.representative))
            : current.points.filter(point => ids.has(point.id));
          if (found.length) latest.current.onPick(found);
        });
        setReady(true);
      });
    } catch { setFailed(true); }
    return () => { active = false; resize.disconnect(); inputCanvas?.removeEventListener('wheel',userMovement,true); inputCanvas?.removeEventListener('keydown',userMovement); map.current = null; instance?.remove(); };
  }, [revision]);
  useEffect(() => {
    if (!ready || !map.current) return;
    (map.current.getSource('observations') as sdk.GeoJSONSource).setData(points);
    (map.current.getSource('connections') as sdk.GeoJSONSource).setData(lines);
    map.current.setPaintProperty('place-summary','line-opacity',props.summary && props.selectedObservation ? .12 : .5);
  }, [ready, points, lines, props.summary, props.selectedObservation]);
  // Fit only when the imported dataset changes, not when its display mode changes.
  useEffect(() => {
    if (!ready || !map.current) return;
    const first = props.originalPoints[0]?.coordinate;
    if (first) {
      const bounds = new sdk.LngLatBounds([first.longitude, first.latitude], [first.longitude, first.latitude]);
      for (const point of props.originalPoints) bounds.extend([point.coordinate.longitude, point.coordinate.latitude]);
      map.current.fitBounds(bounds, { padding: { top: Math.min(320, window.innerHeight * .37), bottom: 60, left: 60, right: 60 }, maxZoom: 15, duration: 0 });
      map.current.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
    }
  }, [ready, props.originalPoints]);
  useEffect(() => {
    if (!ready || !map.current) return;
    const selected = props.selectedObservation;
    const point = selected ? props.summary?.byObservation.get(selected.id)?.point ?? selected : null;
    map.current.setFilter('selected', ['==', ['get', 'observationId'], point?.id ?? '']);
    if (point && focusedRevision.current !== props.focusRevision) {
      const center: [number, number] = [point.coordinate.longitude, point.coordinate.latitude];
      if (props.focusMode === 'rail') map.current.flyTo({ center, zoom: Math.max(16, map.current.getZoom()), duration: 1400 });
      else map.current.jumpTo({ center });
    }
    focusedRevision.current = props.focusRevision;
  }, [ready, props.selectedObservation, props.focusRevision, props.focusMode, props.summary]);
  useEffect(() => {
    if (!ready || !map.current || !props.selectedObservation || !props.showPointPopup) return;
    const instance = map.current, point = props.selectedObservation;
    const popup = new sdk.Popup({ closeButton: false, closeOnClick: false, maxWidth: '300px', offset: 10, className: 'observation-popup', focusAfterOpen: false })
      .setLngLat([point.coordinate.longitude, point.coordinate.latitude]).setDOMContent(popupHost).addTo(instance);
    let frame = 0;
    const fit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!container.current) return;
        const rect = popup.getElement().getBoundingClientRect(), area = container.current.getBoundingClientRect();
        const top = Math.max(area.top + 8, (document.querySelector('.top-controls')?.getBoundingClientRect().bottom ?? area.top) + 8);
        const dy = rect.top < top ? rect.top - top : Math.max(0, rect.bottom - area.bottom + 8);
        if (Math.abs(dy) > 1) instance.panBy([0, dy], {duration: 0});
      });
    };
    const resize = new ResizeObserver(fit); resize.observe(popupHost); fit();
    return () => { cancelAnimationFrame(frame); resize.disconnect(); popup.remove(); };
  }, [ready, props.selectedObservation, props.showPointPopup, popupHost]);
  useEffect(() => {
    if (!ready || !map.current) return;
    const instance = map.current;
    const chooseVisible = () => {
      const cells = new Map<string, number>();
      const width = instance.getContainer().clientWidth, height = instance.getContainer().clientHeight;
      markerEntries.forEach(({group,point:anchor}, index) => {
        if (!diaryCandidate(props.landmarkSession, group)) return;
        const point = instance.project([anchor.coordinate.longitude, anchor.coordinate.latitude]);
        if (point.x < 0 || point.x > width || point.y < 0 || point.y > height) return;
        const cell = `${Math.floor(point.x / 320)}:${Math.floor(point.y / 190)}`;
        const previous = cells.get(cell);
        const hasPhoto = (i: number) => {
          const candidate = diaryCandidate(props.landmarkSession, markerEntries[i]!.group);
          return candidate && props.landmarkSession.image(candidate.providerPlaceId) ? 1 : 0;
        };
        if (previous === undefined || group.representative.id === props.selectedObservation?.id || markerEntries[previous]!.group.representative.id !== props.selectedObservation?.id && hasPhoto(index) > hasPhoto(previous)) cells.set(cell, index);
      });
      const indices = [...cells.values()].sort((a, b) => a - b);
      setVisibleIndices(previous => previous.length === indices.length && previous.every((value, i) => value === indices[i]) ? previous : indices);
    };
    chooseVisible(); instance.on('moveend', chooseVisible); instance.on('resize', chooseVisible);
    return () => { instance.off('moveend', chooseVisible); instance.off('resize', chooseVisible); };
  }, [ready, markerEntries, props.landmarkSession, landmarkRevision, props.selectedObservation]);
  useEffect(() => {
    if (!ready || !map.current) return;
    const instance = map.current;
    const markers = diaryHosts.map(({ point, host }) => {
      host.className = 'diary-balloon';
      return new sdk.Marker({ element: host, anchor: 'bottom', offset: [0, -9] })
        .setLngLat([point.coordinate.longitude, point.coordinate.latitude]).addTo(instance);
    });
    const layout = () => {
      const used: DOMRect[] = [];
      const controls = document.querySelector('.top-controls')?.getBoundingClientRect();
      const ordered = [...diaryHosts].sort((a, b) => {
        const hasPhoto = (group: ObservationGroup) => {
          const candidate = diaryCandidate(latest.current.landmarkSession, group);
          return candidate && latest.current.landmarkSession.image(candidate.providerPlaceId) ? 1 : 0;
        };
        return Number(b.group.representative.id === latest.current.selectedObservation?.id) - Number(a.group.representative.id === latest.current.selectedObservation?.id) || hasPhoto(b.group) - hasPhoto(a.group);
      });
      for (const { host } of ordered) {
        const rect = host.getBoundingClientRect();
        const overlap = (other: DOMRect) => rect.left < other.right + 8 && rect.right + 8 > other.left && rect.top < other.bottom + 8 && rect.bottom + 8 > other.top;
        const hidden = (controls && overlap(controls)) || used.some(overlap);
        host.style.visibility = hidden ? 'hidden' : 'visible';
        if (!hidden) used.push(rect);
      }
    };
    instance.on('render', layout);
    const observer = new ResizeObserver(layout);
    diaryHosts.forEach(({ host }) => observer.observe(host));
    layout();
    return () => { instance.off('render', layout); observer.disconnect(); markers.forEach(marker => marker.remove()); };
  }, [ready, diaryHosts]);
  const selected = props.selectedObservation;
  const selectedIndex = selected ? props.candidates.findIndex(point => point.id === selected.id) : -1;
  return <div className="map-surface">
    {selected && props.showPointPopup && createPortal(<div role="dialog" aria-label="포인트 정보" onKeyDown={event => { if (event.key === 'Escape') props.onClose(); }}>
      <button className="popup-close" aria-label="말풍선 닫기" onClick={props.onClose}>×</button>
      <h3>관측 {props.originalPoints.indexOf(selected) + 1}</h3>
      <p>{formatDiaryTime(selected.time, props.timezone)}</p>
      <p>기록 위치<br />위도 {selected.coordinate.latitude}<br />경도 {selected.coordinate.longitude}</p>
      {props.candidates.length > 1 && <div className="popup-candidates"><p>겹친 지점 {selectedIndex + 1} / {props.candidates.length}</p><button disabled={selectedIndex <= 0} onClick={() => props.onSelect(props.candidates[selectedIndex - 1]!)}>이전 지점</button><button disabled={selectedIndex >= props.candidates.length - 1} onClick={() => props.onSelect(props.candidates[selectedIndex + 1]!)}>다음 지점</button></div>}
    </div>, popupHost)}

    {diaryHosts.map(({ group, host, index, count }) => createPortal(<DiaryCard recordCount={count} group={group} index={index} session={props.landmarkSession} timezone={props.timezone} onSelect={props.onSelect} />, host, group.groupId))}
    {!mapTilerKey ? <p role="alert" className="map-message">지도 키가 없습니다. VITE_MAPTILER_API_KEY를 설정해 주세요. JSON 등록과 목록 확인은 계속 사용할 수 있습니다.</p> : <>
      <div className={ready && !failed ? 'sr-only' : 'map-message'}><p role="status">{failed ? '[MAP_UNAVAILABLE] 일부 지도 자료를 불러오지 못했습니다. 기록 목록은 계속 사용할 수 있습니다.' : ready ? '상세 지도 준비 완료' : '상세 지도를 불러오는 중입니다…'}</p>
      {failed && <button onClick={() => setRevision(value => value + 1)}>지도 다시 시도</button>}</div>
      <div className="map-fill">
        <div ref={container} aria-label="MapTiler 상세 지구본" className="map-canvas" />
        <a href="https://www.maptiler.com/" target="_blank" rel="noreferrer" style={{ position: 'absolute', bottom: 10, left: 10 }}><img src="https://api.maptiler.com/resources/logo.svg" alt="MapTiler logo" width="100" /></a>
      </div>
    </>}
  </div>;
}
