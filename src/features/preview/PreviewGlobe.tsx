import { useEffect, useMemo, useRef, useState } from 'react';
import Globe from 'react-globe.gl';
import type { GlobeMethods } from 'react-globe.gl';
import { MeshPhongMaterial, type Object3D } from 'three';
import type { Observation } from '../../domain/timeline';
import type { Connection } from './analysis';
import { arcVertices, buildPreviewObjects } from './geometry';
import { land } from '../../assets/land';

interface Props { points: readonly Observation[]; connections: readonly Connection[]; differentiated: boolean; thresholdSeconds: number }
const MIN_ALTITUDE = .015;
const MAX_ALTITUDE = 4;
export function PreviewGlobe({ points, connections, differentiated, thresholdSeconds }: Props) {
  const globe = useRef<GlobeMethods | undefined>(undefined);
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(700);
  const [objects, setObjects] = useState<{ mesh: Object3D }[]>([]);
  const [failed, setFailed] = useState(false);
  const [inspectIndex, setInspectIndex] = useState(-1);
  const gaps = useMemo(() => connections.filter(c => c.seconds > thresholdSeconds), [connections, thresholdSeconds]);
  const selected = differentiated && inspectIndex >= 0 ? gaps[inspectIndex] : undefined;
  useEffect(() => { setInspectIndex(-1); }, [points, differentiated, thresholdSeconds]);
  const inspectNext = () => {
    const next = (inspectIndex + 1) % gaps.length, link = gaps[next];
    if (!link) return;
    setInspectIndex(next);
    const arc = arcVertices(link.from.coordinate, link.to.coordinate);
    const middle = arc[Math.floor((arc.length - 1) / 2)]!.clone().add(arc[Math.ceil((arc.length - 1) / 2)]!).normalize();
    globe.current?.pointOfView({ lat: Math.asin(middle.y) * 180 / Math.PI, lng: Math.atan2(middle.x, middle.z) * 180 / Math.PI,
      altitude: Math.max(MIN_ALTITUDE, Math.min(MAX_ALTITUDE, link.km / 6371.0088 * 2)) }, 0);
  };
  const material = useMemo(() => new MeshPhongMaterial({ color: '#102d45', shininess: 6 }), []);
  const home = () => {
    // Wheel/pinch controls otherwise allow the camera inside the raised trace layer.
    const view = globe.current;
    if (view) {
      view.controls().minDistance = view.getGlobeRadius() * (1 + MIN_ALTITUDE);
      view.controls().maxDistance = view.getGlobeRadius() * (1 + MAX_ALTITUDE);
    }
    const first = points[0];
    globe.current?.pointOfView({ lat: first?.coordinate.latitude ?? 25, lng: first?.coordinate.longitude ?? 125, altitude: 1.7 }, 0);
  };
  const zoom = (factor: number) => {
    const current = globe.current?.pointOfView();
    if (current) globe.current?.pointOfView({ ...current, altitude: Math.max(MIN_ALTITUDE, Math.min(MAX_ALTITUDE, current.altitude * factor)) }, 250);
  };
  useEffect(() => {
    const observer = new ResizeObserver(entries => setWidth(Math.max(280, entries[0]?.contentRect.width ?? 700)));
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    try {
      const result = buildPreviewObjects(selected ? [selected.from, selected.to] : points, selected ? [selected] : connections, differentiated, thresholdSeconds);
      setObjects([{ mesh: result.group }]); setFailed(false);
      return result.dispose;
    } catch { setObjects([]); setFailed(true); }
  }, [points, connections, differentiated, thresholdSeconds, selected]);
  useEffect(() => { home(); }, [points]);
  useEffect(() => () => { material.dispose(); }, [material]);
  return <div className="globe-wrap" ref={container}>
    {differentiated && <div>
      <p>점선 대상 거리: 같은 좌표 {gaps.filter(c => c.km === 0).length}개 · 0m 초과–100m 이하 {gaps.filter(c => c.km > 0 && c.km <= .1).length}개 · 100m 초과–1km 이하 {gaps.filter(c => c.km > .1 && c.km <= 1).length}개 · 1km 초과 {gaps.filter(c => c.km > 1).length}개</p>
      <button onClick={inspectNext} disabled={!gaps.length}>다음 점선 대상 확인</button>
      <button onClick={() => { setInspectIndex(-1); home(); }} disabled={!selected}>전체 연결로 돌아가기</button>
      {selected && <p aria-live="polite">점선 대상 {inspectIndex + 1} / {gaps.length}만 표시 중입니다. 다른 선과 점을 잠시 숨기고 대상 중앙으로 이동했습니다.
        {selected.km === 0 ? ' 양 끝 좌표가 같아 그릴 선의 길이가 없습니다.' : selected.km <= .1 ? ' 두 지점은 100m 이내입니다. 현재 최대 확대에서도 점선 간격을 구분하기 어려울 수 있습니다.' : ' 확대·회전하며 주황색 연결을 확인하세요.'}</p>}
    </div>}
    <Globe ref={globe} width={width} height={560} backgroundColor="#0a1420"
      globeMaterial={material} showGraticules showAtmosphere atmosphereColor="#3c718a"
      polygonsData={land} polygonCapColor={() => '#294b57'} polygonSideColor={() => '#294b57'} polygonAltitude={.003} polygonCapCurvatureResolution={2}
      polygonsTransitionDuration={0} customLayerData={objects} customThreeObject={d => (d as { mesh: Object3D }).mesh}
      customLayerLabel={() => ''} enablePointerInteraction={false} animateIn={false} onGlobeReady={home} />
    <div className="globe-tools"><button onClick={home}>처음 위치로</button><button onClick={() => zoom(.55)}>확대</button><button onClick={() => zoom(1.8)}>축소</button><span>드래그로 회전 · 휠로 확대</span></div>
    {failed && <p role="alert">[DISPLAY_LIMIT] 표시 복잡도 한도를 넘었습니다. 점을 생략해 그리지 않았습니다. 아래 집계는 확인할 수 있습니다.</p>}
  </div>;
}
