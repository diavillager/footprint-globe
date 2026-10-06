import { useEffect, useMemo, useRef, useState } from 'react';
import Globe from 'react-globe.gl';
import type { GlobeMethods } from 'react-globe.gl';
import { MeshPhongMaterial, PerspectiveCamera, Vector3, type Object3D } from 'three';
import type { Observation } from '../../domain/timeline';
import type { Connection } from './analysis';
import { arcVertices, buildPreviewObjects, focusAltitude, globeVector, MIN_ALTITUDE, MAX_ALTITUDE, TRACE_ALTITUDE, TRACE_RADIUS } from './geometry';
import { land } from '../../assets/land';

interface Props { points: readonly Observation[]; connections: readonly Connection[]; differentiated: boolean; thresholdSeconds: number }
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
      altitude: focusAltitude(link.km) }, 0);
  };
  const material = useMemo(() => new MeshPhongMaterial({ color: '#102d45', shininess: 6 }), []);
  const updateClipping = () => {
    const view = globe.current;
    const camera = view?.camera();
    if (view && camera instanceof PerspectiveCamera) {
      camera.near = Math.max(.0000001, (camera.position.length() - view.getGlobeRadius() * (1 + TRACE_ALTITUDE)) / 100);
      camera.updateProjectionMatrix();
      view.controls().rotateSpeed = Math.max(.00000001, (view.pointOfView().altitude - TRACE_ALTITUDE) * .3);
    }
  };
  const home = () => {
    // Wheel/pinch controls otherwise allow the camera inside the raised trace layer.
    const view = globe.current;
    if (view) {
      // Residual orbit damping can move the target offscreen at metre scale.
      view.controls().enableDamping = false;
      view.controls().zoomToCursor = false;
      view.controls().update();
      view.controls().minDistance = view.getGlobeRadius() * (1 + MIN_ALTITUDE);
      view.controls().maxDistance = view.getGlobeRadius() * (1 + MAX_ALTITUDE);
    }
    const first = points[0];
    globe.current?.pointOfView({ lat: first?.coordinate.latitude ?? 25, lng: first?.coordinate.longitude ?? 125, altitude: 1.7 }, 0);
  };
  const zoom = (factor: number) => {
    const current = globe.current?.pointOfView();
    if (current) globe.current?.pointOfView({ ...current, altitude: Math.max(MIN_ALTITUDE, Math.min(MAX_ALTITUDE, TRACE_ALTITUDE + (current.altitude - TRACE_ALTITUDE) * factor)) }, 250);
  };
  useEffect(() => {
    const observer = new ResizeObserver(entries => setWidth(Math.max(280, entries[0]?.contentRect.width ?? 700)));
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    try {
      const anchor = selected?.from ?? points[0];
      const origin = anchor ? globeVector(anchor.coordinate).multiplyScalar(TRACE_RADIUS) : new Vector3();
      const result = buildPreviewObjects(selected ? [selected.from, selected.to] : points, selected ? [selected] : connections, differentiated, thresholdSeconds, origin);
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
        {selected.km === 0 ? ' 양 끝 좌표가 같아 그릴 선의 길이가 없습니다.' : selected.km <= .1 ? ' 두 지점은 100m 이내입니다. 두 점 사이 거리에 맞춰 확대했습니다. 좌표를 벌리거나 경로를 추가하지 않습니다.' : ' 확대·회전하며 주황색 연결을 확인하세요.'}</p>}
    </div>}
    <Globe ref={globe} width={width} height={560} backgroundColor="#0a1420"
      globeMaterial={material} showGraticules showAtmosphere atmosphereColor="#3c718a"
      polygonsData={land} polygonCapColor={() => '#294b57'} polygonSideColor={() => '#294b57'} polygonAltitude={.003} polygonCapCurvatureResolution={2}
      polygonsTransitionDuration={0} customLayerData={objects} customThreeObject={d => (d as { mesh: Object3D }).mesh}
      customLayerLabel={() => ''} enablePointerInteraction={false} animateIn={false} onGlobeReady={home} onZoom={updateClipping} />
    <div className="globe-tools"><button onClick={home}>처음 위치로</button><button onClick={() => zoom(.55)}>확대</button><button onClick={() => zoom(1.8)}>축소</button><span>드래그로 회전 · 휠로 확대</span></div>
    {failed && <p role="alert">[DISPLAY_LIMIT] 표시 복잡도 한도를 넘었습니다. 점을 생략해 그리지 않았습니다. 아래 집계는 확인할 수 있습니다.</p>}
  </div>;
}
