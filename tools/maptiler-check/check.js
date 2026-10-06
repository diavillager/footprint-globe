'use strict';
const byId = id => document.getElementById(id);
const presets = { seoul: [126.978, 37.5665], tokyo: [139.6503, 35.6762], newyork: [-74.006, 40.7128], paris: [2.3522, 48.8566], london: [-0.1278, 51.5074] , dateline: [180, 0] };
const points = [
  { id: 'SYN-A', coordinates: presets.seoul },
  { id: 'SYN-B', coordinates: [126.978, 37.566509] },
  { id: 'SYN-C', coordinates: [126.978, 37.566509] },
  { id: 'SYN-D', coordinates: [126.978, 37.5674] },
];
let map, loading = false, originalPaint = new Map();
let boundaryLayers = [], ready = false, failed = false;
const status = value => { byId('status').textContent = value; };
function clearSelection() {
  byId('selection').textContent = '선택 없음';
  byId('map-selection').hidden = true;
  for (const button of byId('observations').children) button.setAttribute('aria-pressed', 'false');
}
function select(ids, focus = false) {
  if (!map || !ready) return;
  const selected = points.filter(point => ids.includes(point.id));
  if (!selected.length) return;
  const label = '선택: ' + selected.map(point => point.id).join(', ');
  byId('selection').textContent = label;
  byId('map-selection').textContent = label + (ids.length > 1 ? ' · 아래 버튼으로 하나를 선택하세요' : ' · 주황 테두리');
  byId('map-selection').hidden = false;
  for (const button of byId('observations').children) button.setAttribute('aria-pressed', String(ids.includes(button.textContent)));
  map.getSource('synthetic-selection').setData({ type: 'FeatureCollection', features: selected.map(point => ({ type: 'Feature', properties: { id: point.id }, geometry: { type: 'Point', coordinates: point.coordinates } })) });
  if (focus) {
    byId('region').value = 'seoul'; byId('zoom').value = '19';
    status('선택한 시험점으로 이동 중');
    map.jumpTo({ center: selected[0].coordinates, zoom: 19 });
  }
}
for (const point of points) {
  const button = document.createElement('button'); button.textContent = point.id;
  button.disabled = true; button.setAttribute('aria-pressed', 'false');
  button.addEventListener('click', () => select([point.id], true));
  byId('observations').append(button);
}
function loadSdk() {
  if (window.maptilersdk) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://cdn.maptiler.com/maptiler-sdk-js/v4.1.0/maptiler-sdk.css'; document.head.append(css);
    const script = document.createElement('script'); script.src = 'https://cdn.maptiler.com/maptiler-sdk-js/v4.1.0/maptiler-sdk.umd.min.js';
    script.onload = resolve; script.onerror = reject; document.head.append(script);
  });
}
function report() {
  if (!map || !ready) return;
  const rendered = map.queryRenderedFeatures(undefined, { layers: boundaryLayers.map(l => l.id) });
  const levels = [...new Set(rendered.map(f => f.properties.admin_level).filter(v => v != null))].sort((a,b) => a-b);
  const layers = [...new Set(rendered.map(f => f.sourceLayer))].sort();
  byId('report').textContent = JSON.stringify({ region: byId('region').value, zoom: Number(map.getZoom().toFixed(2)), boundaryFragments: rendered.length, sourceLayers: layers, adminLevels: levels }, null, 2);
}
function move() {
  if (!map || !ready) return;
  status('지도 이동 중');
  map.jumpTo({ center: presets[byId('region').value], zoom: Number(byId('zoom').value) });
}
byId('start').addEventListener('click', async () => {
  if (loading || map) return;
  loading = true; failed = false; byId('start').disabled = true; status('지도 준비 중');
  byId('region').value = 'seoul'; byId('zoom').value = '9'; byId('projection').value = 'globe';
  byId('boundaries').checked = false; clearSelection();
  try {
    const response = await fetch('/config', { cache: 'no-store' });
    if (!response.ok) throw new Error('KEY_MISSING');
    const config = await response.json();
    await loadSdk();
    const sdk = window.maptilersdk;
    sdk.config.apiKey = config.key;
    sdk.config.telemetry = false;
    sdk.config.caching = false;
    // Keep documented session billing; disable optional telemetry and persistent SDK cache.
    map = new sdk.Map({ container: 'map', style: 'base-v4', center: presets.seoul, zoom: 9,
      projection: 'globe', maxZoom: 20, language: sdk.Language.KOREAN,
      geolocateControl: false, terrain: false, maptilerLogo: true, attributionControl: true,
    });
    byId('stop').disabled = false;
    map.on('error', () => { failed = true; status('MAP_RESOURCE_FAILED · 키 제한·사용량·연결을 확인하세요.'); });
    map.on('load', () => {
      boundaryLayers = map.getStyle().layers.filter(l => l.type === 'line' && ['country_border', 'country_border_disputed', 'sub_border'].includes(l['source-layer']));
      originalPaint = new Map(boundaryLayers.map(l => [l.id, { color: map.getPaintProperty(l.id, 'line-color'), width: map.getPaintProperty(l.id, 'line-width'), opacity: map.getPaintProperty(l.id, 'line-opacity') }]));
      map.addSource('synthetic-observations', { type: 'geojson', data: { type: 'FeatureCollection', features: points.map(p => ({ type: 'Feature', properties: { id: p.id }, geometry: { type: 'Point', coordinates: p.coordinates } })) } });
      map.addSource('synthetic-connection', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: points.map(p => p.coordinates) } } });
      map.addLayer({ id: 'synthetic-line', type: 'line', source: 'synthetic-connection', paint: { 'line-color': '#b84700', 'line-width': 3, 'line-dasharray': [2, 2] } });
      map.addLayer({ id: 'synthetic-points', type: 'circle', source: 'synthetic-observations', paint: { 'circle-radius': 6, 'circle-color': '#006dad', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
      map.addSource('synthetic-selection', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'selected-point-ring', type: 'circle', source: 'synthetic-selection', paint: { 'circle-radius': 11, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#bd4000', 'circle-stroke-width': 3 } });
      map.on('click', 'synthetic-points', e => select([...new Set(e.features.map(f => f.properties.id))]));
      ready = true; byId('controls').disabled = false;
      for (const button of byId('observations').children) button.disabled = false;
      report();
    });
    map.on('idle', () => { report(); if (!failed) status('지도 준비 완료'); });
  } catch {
    status('MAP_START_FAILED · .env.local의 키 또는 네트워크를 확인하세요.');
    if (map) map.remove(); map = undefined;
    byId('start').disabled = false;
  } finally { loading = false; }
});
byId('stop').addEventListener('click', () => {
  if (map) map.remove(); map = undefined; ready = false;
  if (window.maptilersdk) window.maptilersdk.config.apiKey = '';
  byId('controls').disabled = true; byId('stop').disabled = true; byId('start').disabled = false;
  clearSelection();
  for (const button of byId('observations').children) button.disabled = true;
  byId('report').textContent = '지도 종료'; status('지도 종료 · 새 지도 요청 중지');
});
byId('region').addEventListener('change', move);
byId('zoom').addEventListener('change', move);
byId('projection').addEventListener('change', () => { if (map) map.setProjection({ type: byId('projection').value }); });
byId('refresh').addEventListener('click', report);
byId('boundaries').addEventListener('change', () => {
  for (const layer of boundaryLayers) {
    const old = originalPaint.get(layer.id), active = byId('boundaries').checked;
    map.setPaintProperty(layer.id, 'line-color', active ? '#8d259e' : old.color ?? null);
    map.setPaintProperty(layer.id, 'line-width', active ? 2 : old.width ?? null);
    map.setPaintProperty(layer.id, 'line-opacity', active ? 1 : old.opacity ?? null);
  }
});
window.addEventListener('pagehide', () => { if (map) map.remove(); });
