import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { mapTilerKey } from '../../map-config';
import { PREVIEW_LIMITS } from '../../parser';
import type { ParseResult, ImportError, Observation, ObservationId } from '../../domain/timeline';
import type { ImportRequest } from './importFile';
import { connectAll, distribution } from './analysis';
import { PreviewGlobe } from './PreviewGlobe';
import { createPreviewDemo } from '../../fixtures/preview';
import { ObservationList } from './ObservationList';
const MapTilerGlobe = lazy(() => import('./MapTilerGlobe'));

const errors: Record<ImportError, string> = {
  INVALID_JSON: 'JSON 형식이 올바르지 않습니다.', UNSUPPORTED_FORMAT: '이 미리보기는 rawSignals 위치 기록만 지원합니다.',
  INPUT_LIMIT: '미리보기 한도(64 MiB, 원시 신호 100,000개)를 초과했습니다.',
  NO_VALID_POSITIONS: '표시할 수 있는 좌표·시각이 없습니다.', FILE_READ_FAILED: '로컬 파일을 처리하지 못했습니다.',
};
class GlobeBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <p role="alert">[DISPLAY_UNAVAILABLE] 지구본을 표시하지 못했습니다. WebGL을 지원하는 Chrome/Edge에서 확인하세요. 집계는 아래에서 볼 수 있습니다.</p> : this.props.children; }
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
  const [mode, setMode] = useState<'solid' | 'gaps'>('solid');
  const [threshold, setThreshold] = useState(60);
  const [demo, setDemo] = useState(false);
  const [renderer, setRenderer] = useState<'maptiler' | 'offline'>(mapTilerKey ? 'maptiler' : 'offline');
  const Globe = renderer === 'maptiler' ? MapTilerGlobe : PreviewGlobe;
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
  const longCount = connections.filter(c => c.seconds > threshold * 60).length;
  const load = (file: File | undefined) => {
    if (!file) return;
    stop(); resetSelection(); setResult(null); setDemo(false);
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
  return <main>
    <header><p className="eyebrow">FOOTPRINT GLOBE · LOCAL PREVIEW</p><h1>내 기록으로 연결 방식을 비교하세요</h1>
      <p>시간순 연결은 유지합니다. 실제 도로를 예측하지 않고, 기록된 위치 사이의 흐름을 지구 표면을 따라 보여줍니다.</p></header>
    <section className="file-panel">
      <label className="file-button">원본 JSON 선택<input aria-label="원본 JSON 선택" type="file" accept=".json,application/json" onChange={e => { const file = e.currentTarget.files?.[0]; e.currentTarget.value = ''; load(file); }} /></label>
      <button onClick={() => { stop(); resetSelection(); setDemo(true); setResult(createPreviewDemo()); }}>합성 예제로 체험</button>
      <button onClick={() => { stop(); resetSelection(); setResult(null); setDemo(false); }} disabled={!result && !busy}>{busy ? '처리 취소' : '기록 지우기'}</button>
      <p>파일은 이 탭 안에서만 처리하며 전송·저장하지 않습니다. 현재 rawSignals 형식, 최대 64 MiB·100,000개 신호를 지원합니다.</p>
      <label>지도 표시 <select aria-label="지도 표시" value={renderer} onChange={event => setRenderer(event.target.value as 'maptiler' | 'offline')}><option value="maptiler">상세 지도 (MapTiler)</option><option value="offline">개략 지구본 (외부 요청 없음)</option></select></label>
      <p className="note">상세 지도는 MapTiler에서 지도 자료를 불러옵니다. 이때 IP 주소와 보고 있는 지역·확대 수준이 서비스에 전달될 수 있습니다. JSON 내용·파일명·관측 시각은 전송하지 않습니다. 개략 지구본은 외부 지도 요청 없이 사용할 수 있습니다.</p>
    </section>
    <div role="status" aria-live="polite">{busy ? '로컬에서 위치·시각을 검사하고 정렬하는 중입니다…' : !result ? '원본을 선택하거나 합성 예제로 먼저 확인하세요.' : result.ok ? `${demo ? '완전 합성 예제' : '로컬 기록'} · 유효 위치 ${result.counts.accepted.toLocaleString()}개 · 연결 ${connections.length.toLocaleString()}개` : `[${result.code}] ${errors[result.code]}`}</div>
    {result?.counts && <p className="note">입력 신호 {result.counts.input.toLocaleString()}개 · 위치 외 신호 제외 {result.counts.ignoredSignals.toLocaleString()}개 · 잘못된 위치 제외 {result.counts.invalidPositions.toLocaleString()}개 · 추가 최상위 필드 미사용 {result.counts.ignoredRootFields}개. 유효 위치만 연결하며 제외된 기록이 있으면 그 앞뒤의 유효 위치가 연결됩니다.</p>}
    {data && <>
      <section className="comparison"><fieldset><legend>연결 표시 비교</legend>
        <label><input type="radio" name="mode" checked={mode === 'solid'} onChange={() => setMode('solid')} />모두 실선</label>
        <label><input type="radio" name="mode" checked={mode === 'gaps'} onChange={() => setMode('gaps')} />긴 공백은 점선</label>
      </fieldset>
      <label className="threshold">점선으로 구분할 시간차 (분)<input type="number" aria-label="점선 시간차 기준" disabled={mode !== 'gaps'} min="0" max="5256000" step="1" value={threshold} onChange={e => { const n = e.currentTarget.valueAsNumber; if (Number.isFinite(n)) setThreshold(Math.max(0, Math.min(5256000, n))); }} /></label>
      <p>시험 기준 {threshold.toLocaleString()}분 초과: {longCount.toLocaleString()}개 연결. 기준은 직접 바꿀 수 있으며 정확도 판단이나 확정 정책이 아닙니다.</p>
      <p aria-live="polite">현재 표시: 실선 {(connections.length - (mode === 'gaps' ? longCount : 0)).toLocaleString()}개 · 점선 {(mode === 'gaps' ? longCount : 0).toLocaleString()}개.
        {mode === 'solid' ? ' 점선을 비교하려면 ‘긴 공백은 점선’을 선택하세요.' : longCount === 0 ? ' 현재 시간차 기준을 초과하는 연결이 없습니다.' : ' 주황색 점선으로 구분합니다. 화면에서 매우 짧거나 같은 위치의 연결은 점선 모양이 보이지 않을 수 있습니다.'}</p>
      <p className="legend">● 관측 위치　<span className="solid">━ 기록 지점 연결</span>　<span className="dashed">┄ 긴 시간차의 연결</span></p>
      <GlobeBoundary key={`${data.datasetId}:${renderer}`}><Suspense fallback={<p>지도를 준비하고 있습니다…</p>}><Globe points={data.observations} connections={connections} differentiated={mode === 'gaps'} thresholdSeconds={threshold * 60}
        selectedObservation={selectedObservation} focusRevision={focusRevision} onPick={found => { setCandidates(found); if (found.length === 1) selectObservation(found[0]!); }} /></Suspense></GlobeBoundary>
      <p className="note">같은 위치의 점·선은 겹쳐 보일 수 있습니다. 지구 뒤편은 회전해서 확인하세요. {renderer === 'offline' ? '배경은 개략 육지 윤곽이며 도로 지도는 아닙니다.' : '국가·지역·도시 이름과 경계는 확대 수준과 지도 자료에 따라 표시됩니다. 연결선은 실제 도로나 이동 경로를 뜻하지 않습니다.'}</p>
      </section>
      <ObservationList key={data.datasetId} points={data.observations} candidates={candidates} selectedId={selectedId} onSelect={selectObservation} onShowAll={() => setCandidates(null)} />
      <h2>기록 간격을 확인하세요</h2><p>아래 분포는 전체 유효 관측의 이웃 쌍을 대상으로 합니다. 거리는 두 점 사이의 지표면 최단 거리이며 실제 이동 거리나 도로 길이가 아닙니다. 날짜·좌표·원본 파일명은 표에 표시하지 않습니다.</p>
      <div className="distributions"><Histogram title="시간차 분포" values={times} edges={timeEdges} labels={timeLabels} unit="분" /><Histogram title="지점 간 거리 분포" values={distances} edges={distanceEdges} labels={distanceLabels} unit="km" /></div>
    </>}
    <footer>브라우저를 닫거나 기록을 지우면 앱의 기록 참조를 해제합니다. 실제 지구본 화면에는 위치 정보가 드러나므로 공유할 때는 원본 지도 캡처 대신 표시 방식에 대한 의견을 알려 주세요. 방문 지정 기능은 준비 중이며, 사진 추가는 MVP 이후 확장 기능입니다.</footer>
  </main>;
}
