import { useEffect, useMemo, useRef, useState } from 'react';
import Globe from 'react-globe.gl';
import type { GlobeMethods } from 'react-globe.gl';
import { MeshPhongMaterial, type Object3D } from 'three';
import type { Observation } from '../../domain/timeline';
import type { Connection } from './analysis';
import { buildPreviewObjects } from './geometry';
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
      const result = buildPreviewObjects(points, connections, differentiated, thresholdSeconds);
      setObjects([{ mesh: result.group }]); setFailed(false);
      return result.dispose;
    } catch { setObjects([]); setFailed(true); }
  }, [points, connections, differentiated, thresholdSeconds]);
  useEffect(() => { home(); }, [points]);
  useEffect(() => () => { material.dispose(); }, [material]);
  return <div className="globe-wrap" ref={container}>
    <Globe ref={globe} width={width} height={560} backgroundColor="#0a1420"
      globeMaterial={material} showGraticules showAtmosphere atmosphereColor="#3c718a"
      polygonsData={land} polygonCapColor={() => '#294b57'} polygonSideColor={() => '#294b57'} polygonAltitude={.003} polygonCapCurvatureResolution={2}
      polygonsTransitionDuration={0} customLayerData={objects} customThreeObject={d => (d as { mesh: Object3D }).mesh}
      customLayerLabel={() => ''} enablePointerInteraction={false} animateIn={false} onGlobeReady={home} />
    <div className="globe-tools"><button onClick={home}>처음 위치로</button><button onClick={() => zoom(.55)}>확대</button><button onClick={() => zoom(1.8)}>축소</button><span>드래그로 회전 · 휠로 확대</span></div>
    {failed && <p role="alert">[DISPLAY_LIMIT] 표시 복잡도 한도를 넘었습니다. 점을 생략해 그리지 않았습니다. 아래 집계는 확인할 수 있습니다.</p>}
  </div>;
}
