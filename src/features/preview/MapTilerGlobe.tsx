import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import * as sdk from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { PreviewGlobe } from './PreviewGlobe';
import { mapTilerKey } from '../../map-config';
import { mapConnections, mapPoints } from './mapData';

type Props = ComponentProps<typeof PreviewGlobe>;
sdk.setWorkerUrl(workerUrl);

export default function MapTilerGlobe(props: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<sdk.Map | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const points = useMemo(() => mapPoints(props.points), [props.points]);
  const lines = useMemo(() => mapConnections(props.connections, props.differentiated, props.thresholdSeconds), [props.connections, props.differentiated, props.thresholdSeconds]);
  useEffect(() => {
    if (!container.current || !mapTilerKey) return;
    setReady(false); setFailed(false);
    let active = true;
    let instance: sdk.Map | null = null;
    const resize = new ResizeObserver(() => instance?.resize());
    try {
      const first = latest.current.points[0]?.coordinate;
      instance = new sdk.Map({ container: container.current, style: `https://api.maptiler.com/maps/base-v4/style.json?key=${encodeURIComponent(mapTilerKey)}`,
        center: first ? [first.longitude, first.latitude] : [0, 0], zoom: 2, maxZoom: 20,
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
        instance.addSource('connections', { type: 'geojson', data: mapConnections(latest.current.connections, latest.current.differentiated, latest.current.thresholdSeconds), maxzoom: 20, tolerance: 0 });
        instance.addLayer({ id: 'trace-solid', type: 'line', source: 'connections', filter: ['==', ['get', 'gap'], false], paint: { 'line-color': '#087e78', 'line-width': 3 } });
        instance.addLayer({ id: 'trace-gap', type: 'line', source: 'connections', filter: ['==', ['get', 'gap'], true], paint: { 'line-color': '#de6800', 'line-width': 3, 'line-dasharray': [2, 1.5] } });
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
    return () => { active = false; resize.disconnect(); map.current = null; instance?.remove(); };
  }, [revision]);
  useEffect(() => {
    if (!ready || !map.current) return;
    (map.current.getSource('observations') as sdk.GeoJSONSource).setData(points);
    (map.current.getSource('connections') as sdk.GeoJSONSource).setData(lines);
  }, [ready, points, lines]);
  useEffect(() => {
    if (!ready || !map.current) return;
    const point = props.selectedObservation;
    map.current.setFilter('selected', ['==', ['get', 'observationId'], point?.id ?? '']);
    if (point) map.current.jumpTo({ center: [point.coordinate.longitude, point.coordinate.latitude], zoom: 19 });
  }, [ready, props.selectedObservation, props.focusRevision]);
  return <div>
    {!mapTilerKey ? <p role="alert">지도 키가 없습니다. 개략 지구본을 이용하거나 배포 환경의 VITE_MAPTILER_API_KEY를 설정해 주세요.</p> : <>
      <p role="status">{failed ? '[MAP_UNAVAILABLE] 일부 지도 자료를 불러오지 못했습니다. 기록 목록은 계속 사용할 수 있습니다.' : ready ? '상세 지도 준비 완료 · 지도의 점을 누르면 관측을 선택합니다.' : '상세 지도를 불러오는 중입니다…'}</p>
      {failed && <button onClick={() => setRevision(value => value + 1)}>지도 다시 시도</button>}
      <div style={{ position: 'relative' }}>
        <div ref={container} aria-label="MapTiler 상세 지구본" style={{ height: 560, position: 'relative', textAlign: 'left' }} />
        <a href="https://www.maptiler.com/" target="_blank" rel="noreferrer" style={{ position: 'absolute', bottom: 10, left: 10 }}><img src="https://api.maptiler.com/resources/logo.svg" alt="MapTiler logo" width="100" /></a>
      </div>
    </>}
  </div>;
}
