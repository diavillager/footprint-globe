import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PREVIEW_LIMITS } from '../../parser';
import type { ParseResult, ImportError, Observation, ObservationId } from '../../domain/timeline';
import type { ImportRequest } from './importFile';
import { connectAll, distribution } from './analysis';
import { ObservationList } from './ObservationList';
import type { DisplayTimezone } from './observationTime';
const emptyPoints: readonly Observation[] = [];
const MapTilerGlobe = lazy(() => import('./MapTilerGlobe'));

const errors: Record<ImportError, string> = {
  INVALID_JSON: 'JSON 형식이 올바르지 않습니다.', UNSUPPORTED_FORMAT: '이 미리보기는 rawSignals 위치 기록만 지원합니다.',
  INPUT_LIMIT: '미리보기 한도(64 MiB, 원시 신호 100,000개)를 초과했습니다.',
  NO_VALID_POSITIONS: '표시할 수 있는 좌표·시각이 없습니다.', FILE_READ_FAILED: '로컬 파일을 처리하지 못했습니다.',
};
class GlobeBoundary extends Component<{ children: ReactNode; resetKey: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidUpdate(previous: Readonly<{ children: ReactNode; resetKey: string }>) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }
  render() { return this.state.failed ? <p className="map-message" role="alert">[DISPLAY_UNAVAILABLE] 지도를 표시하지 못했습니다. 표시 한도를 초과했거나 WebGL을 사용할 수 없습니다. 기록을 지우거나 다른 파일을 등록해 다시 시도하세요. 목록·분포는 상단 버튼에서 확인할 수 있습니다.</p> : this.props.children; }
}

function Panel({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const node = dialog.current!; node.showModal(); return () => node.close(); }, []);
  return <dialog ref={dialog} className="data-window" aria-label={title} onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); } }}><div className="window-heading"><h2>{title}</h2><button autoFocus aria-label="창 닫기" onClick={onClose}>×</button></div><div className="window-content">{children}</div></dialog>;
}

function Histogram({ title, values, edges, labels, unit }: { title: string; values: number[]; edges: number[]; labels: string[]; unit: string }) {
  const data = useMemo(() => distribution(values, edges), [values, edges]);
  const format = (value: number | null) => value === null ? '해당 없음' : `${value.toLocaleString('ko-KR', { maximumFractionDigits: 2 })} ${unit}`;
  const max = Math.max(1, ...data.bins);
  return <section className="histogram"><h3>{title}</h3>
    <p>중앙값 {format(data.median)} · 90백분위 {format(data.p90)} · 최대 {format(data.max)}</p>
    <table><thead><tr><th>구간</th><th>분포</th><th>연결 수</th></tr></thead><tbody>{data.bins.map((count, i) =>
      <tr key={labels[i]}><th>{labels[i]}</th><td><div className="bar" style={{ width: `${count / max * 100}%` }} /></td><td>{count.toLocaleString()}</td></tr>)}</tbody></table>
  </section>;
}
const timeEdges = [1, 5, 30, 60, 360, 1440], timeLabels = ['1분 이하', '1–5분', '5–30분', '30–60분', '1–6시간', '6–24시간', '24시간 초과'];
const distanceEdges = [.1, 1, 10, 100, 1000], distanceLabels = ['100m 이하', '100m–1km', '1–10km', '10–100km', '100–1,000km', '1,000km 초과'];

export function LocalPreview() {
  const [result, setResult] = useState<ParseResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [timezone, setTimezone] = useState<DisplayTimezone>('UTC');
  const [panel, setPanel] = useState<'points' | 'time' | 'distance' | 'info' | null>(null);
  const [selectedId, setSelectedId] = useState<ObservationId | null>(null);
  const [candidates, setCandidates] = useState<Observation[] | null>(null);
  const [focusRevision, setFocusRevision] = useState(0);
  const selectObservation = (point: Observation) => { setSelectedId(point.id); setFocusRevision(value => value + 1); };
  const worker = useRef<Worker | null>(null);
  const stop = () => { worker.current?.terminate(); worker.current = null; setBusy(false); };
  useEffect(() => () => worker.current?.terminate(), []);
  const data = result?.ok ? result.data : null;
  const selectedObservation = data?.observations.find(point => point.id === selectedId) ?? null;
  const resetSelection = () => { setSelectedId(null); setCandidates(null); };
  const connections = useMemo(() => connectAll(data?.observations ?? []), [data]);
  const times = useMemo(() => connections.map(l => l.seconds / 60), [connections]);
  const distances = useMemo(() => connections.map(l => l.km), [connections]);
  const load = (file: File | undefined) => {
    if (!file) return;
    stop(); resetSelection(); setResult(null); setPanel(null);
    if (file.size > PREVIEW_LIMITS.bytes) { setResult({ ok: false, code: 'INPUT_LIMIT' }); return; }
    setBusy(true);
    try {
      const current = new Worker(new URL('./preview.worker.ts', import.meta.url), { type: 'module' });
      worker.current = current;
      current.onmessage = (event: MessageEvent<ParseResult>) => {
        if (worker.current !== current) return;
        setResult(event.data); stop();
      };
      current.onerror = event => { event.preventDefault(); if (worker.current === current) { setResult({ ok: false, code: 'FILE_READ_FAILED' }); stop(); } };
      current.onmessageerror = () => { if (worker.current === current) { setResult({ ok: false, code: 'FILE_READ_FAILED' }); stop(); } };
      current.postMessage({ file, datasetId: `dataset:${crypto.randomUUID()}` } satisfies ImportRequest);
    } catch { stop(); setResult({ ok: false, code: 'FILE_READ_FAILED' }); }
  };
  return <main className="map-app">
    <GlobeBoundary resetKey={data?.datasetId ?? 'empty'}><Suspense fallback={<p className="map-message">지도를 준비하고 있습니다…</p>}><MapTilerGlobe points={data?.observations ?? emptyPoints} connections={connections}
      selectedObservation={selectedObservation} focusRevision={focusRevision} timezone={timezone} candidates={candidates}
      onSelect={point => setSelectedId(point.id)} onClose={() => setSelectedId(null)}
      onPick={found => { setCandidates(found); setSelectedId(found[0]!.id); }} /></Suspense></GlobeBoundary>
    <div className="top-controls">
      <nav className="toolbar" aria-label="발자취 도구">
        <span className="brand">FOOTPRINT</span>
        <label className="file-button">JSON 올리기<input aria-label="JSON 올리기" type="file" accept=".json,application/json" onChange={e => { const file = e.currentTarget.files?.[0]; e.currentTarget.value = ''; load(file); }} /></label>
        <button onClick={() => { stop(); resetSelection(); setResult(null); setPanel(null); }} disabled={!result && !busy}>{busy ? '처리 취소' : '지우기'}</button>
        <div className="timezone-switch" role="group" aria-label="표시 시간대"><button aria-pressed={timezone === 'UTC'} onClick={() => setTimezone('UTC')}>UTC</button><button aria-pressed={timezone === 'Asia/Seoul'} onClick={() => setTimezone('Asia/Seoul')}>KST</button></div>
        <button disabled={!data} aria-haspopup="dialog" onClick={() => setPanel('points')}>포인트 목록</button>
        <button disabled={!data} aria-haspopup="dialog" onClick={() => setPanel('time')}>시간별 분포</button>
        <button disabled={!data} aria-haspopup="dialog" onClick={() => setPanel('distance')}>거리별 분포</button>
        <button aria-label="이용 안내" aria-haspopup="dialog" onClick={() => setPanel('info')}>ⓘ</button>
      </nav>
      <div className="import-status" role="status" aria-live="polite">{busy ? '로컬에서 위치·시각을 검사하고 정렬하는 중입니다…' : !result ? 'JSON을 올려 발자취를 확인하세요.' : result.ok ? '관측 ' + result.counts.accepted.toLocaleString() + '개 · 연결 ' + connections.length.toLocaleString() + '개' : '[' + result.code + '] ' + errors[result.code]}</div>
    </div>
    {panel && <Panel title={{ points: '포인트 목록', time: '시간별 분포', distance: '거리별 분포', info: '이용 안내' }[panel]} onClose={() => setPanel(null)}>
      {panel === 'points' && data && <ObservationList points={data.observations} selectedId={selectedId} timezone={timezone} onSelect={point => { setCandidates(null); selectObservation(point); setPanel(null); }} />}
      {panel === 'time' && <Histogram title="시간차 분포" values={times} edges={timeEdges} labels={timeLabels} unit="분" />}
      {panel === 'distance' && <><Histogram title="거리 분포" values={distances} edges={distanceEdges} labels={distanceLabels} unit="km" /><p>이웃 관측 사이의 지표면 최단 거리이며 실제 이동 거리나 도로 길이가 아닙니다.</p></>}
      {panel === 'info' && <><p>JSON은 이 탭에서만 처리하며 전송·저장하지 않습니다. rawSignals 형식, 최대 64 MiB·100,000개 신호를 지원합니다.</p><p>MapTiler 지도 요청으로 IP 주소와 열람 지역·확대 수준이 서비스에 전달될 수 있습니다. JSON 본문·파일명·관측 시각은 전송하지 않습니다.</p><p>연결선은 기록 지점 사이의 흐름이며 실제 이동 경로가 아닙니다. 지우기·새로고침·탭 종료 시 기록은 유지되지 않습니다.</p>{result?.counts && <p>입력 신호 {result.counts.input.toLocaleString()}개 · 위치 외 신호 제외 {result.counts.ignoredSignals.toLocaleString()}개 · 잘못된 위치 제외 {result.counts.invalidPositions.toLocaleString()}개. 제외된 기록 앞뒤의 유효 위치가 연결됩니다.</p>}</>}
    </Panel>}
  </main>;
}
