import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as sdk from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { Observation } from '../../domain/timeline';
import type { Connection } from './analysis';
import { formatObservationTime, type DisplayTimezone } from './observationTime';
import { mapTilerKey } from '../../map-config';
import { mapConnections, mapPoints } from './mapData';

type Props = {
  points: readonly Observation[]; connections: readonly Connection[];
  selectedObservation: Observation | null; focusRevision: number;
  timezone: DisplayTimezone; candidates: readonly Observation[] | null;
  onPick: (points: Observation[]) => void; onSelect: (point: Observation) => void; onClose: () => void;
};
sdk.setWorkerUrl(workerUrl);

export default function MapTilerGlobe(props: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<sdk.Map | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [popupHost] = useState(() => document.createElement('div'));
  const popup = useRef<sdk.Popup | null>(null);
  const focusedRevision = useRef(props.focusRevision);
  const points = useMemo(() => mapPoints(props.points), [props.points]);
  const lines = useMemo(() => mapConnections(props.connections, false, 0), [props.connections]);
  useEffect(() => {
    if (!container.current || !mapTilerKey) return;
    setReady(false); setFailed(false);
    let active = true;
    let instance: sdk.Map | null = null;
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
        instance.addLayer({ id: 'trace-solid', type: 'line', source: 'connections', filter: ['==', ['get', 'gap'], false], paint: { 'line-color': '#087e78', 'line-width': 3 } });
        instance.addLayer({ id: 'observations', type: 'circle', source: 'observations', paint: { 'circle-radius': 4, 'circle-color': '#087e78', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 } });
        instance.addLayer({ id: 'selected', type: 'circle', source: 'observations', filter: ['==', ['get', 'observationId'], ''], paint: { 'circle-radius': 9, 'circle-color': '#ffb74d', 'circle-opacity': .4, 'circle-stroke-color': '#ac4200', 'circle-stroke-width': 3 } });
        instance.on('click', event => {
          if (!instance) return;
          const ids = new Set(instance.queryRenderedFeatures([[event.point.x - 5, event.point.y - 5], [event.point.x + 5, event.point.y + 5]], { layers: ['observations'] }).map(feature => feature.properties.observationId));
          const found = latest.current.points.filter(point => ids.has(point.id));
          if (found.length) latest.current.onPick(found);
        });
        setReady(true);
      });
    } catch { setFailed(true); }
    return () => { active = false; resize.disconnect(); popup.current?.remove(); map.current = null; instance?.remove(); };
  }, [revision]);
  useEffect(() => {
    if (!ready || !map.current) return;
    (map.current.getSource('observations') as sdk.GeoJSONSource).setData(points);
    (map.current.getSource('connections') as sdk.GeoJSONSource).setData(lines);
    const first = props.points[0]?.coordinate;
    if (first) map.current.jumpTo({ center: [first.longitude, first.latitude] });
  }, [ready, points, lines]);
  useEffect(() => {
    if (!ready || !map.current) return;
    const point = props.selectedObservation;
    map.current.setFilter('selected', ['==', ['get', 'observationId'], point?.id ?? '']);
    if (point && focusedRevision.current !== props.focusRevision) map.current.jumpTo({ center: [point.coordinate.longitude, point.coordinate.latitude] });
    focusedRevision.current = props.focusRevision;
  }, [ready, props.selectedObservation, props.focusRevision]);
  useEffect(() => {
    if (!ready || !map.current || !props.selectedObservation) return;
    const point = props.selectedObservation;
    const balloon = new sdk.Popup({ closeButton: false, closeOnClick: false, maxWidth: '300px', offset: 8, className: 'observation-popup', focusAfterOpen: false })
      .setLngLat([point.coordinate.longitude, point.coordinate.latitude]).setDOMContent(popupHost).addTo(map.current);
    popup.current = balloon;
    return () => { balloon.remove(); if (popup.current === balloon) popup.current = null; };
  }, [ready, props.selectedObservation, popupHost]);
  const selected = props.selectedObservation;
  const candidates = props.candidates ?? [];
  const candidateIndex = selected ? candidates.findIndex(point => point.id === selected.id) : -1;
  return <div className="map-surface">
    {selected && createPortal(<div role="dialog" aria-label="관측포인트 상세 정보">
      <button className="popup-close" aria-label="상세 정보 닫기" onClick={props.onClose}>×</button>
      <h3>관측 {props.points.indexOf(selected) + 1}</h3>
      <p>{formatObservationTime(selected.time, props.timezone)}</p>
      <p>위도 {selected.coordinate.latitude}<br />경도 {selected.coordinate.longitude}</p>
      {candidates.length > 1 && <div className="popup-candidates"><p>겹친 관측 {candidateIndex + 1} / {candidates.length}</p><button disabled={candidateIndex <= 0} onClick={() => props.onSelect(candidates[candidateIndex - 1]!)}>이전 관측</button><button disabled={candidateIndex >= candidates.length - 1} onClick={() => props.onSelect(candidates[candidateIndex + 1]!)}>다음 관측</button></div>}
    </div>, popupHost)}
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
