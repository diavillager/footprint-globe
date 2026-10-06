import { Component, lazy, Suspense, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { PREVIEW_LIMITS } from '../../parser';
import type { ParseResult, ImportError, Observation, ObservationId } from '../../domain/timeline';
import type { ImportRequest } from './importFile';
import { connectAll, distribution } from './analysis';
import { createPreviewDemo } from '../../fixtures/preview';
import { ObservationList } from './ObservationList';
import type { DisplayTimezone } from './observationTime';
const emptyPoints: readonly Observation[] = [];
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

function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return <div className="disclosure"><button className="disclosure-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>{title}<span aria-hidden="true">{open ? '−' : '+'}</span></button><div id={id} hidden={!open}>{children}</div></div>;
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
  const [demo, setDemo] = useState(false);
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
    <header><p className="eyebrow">FOOTPRINT GLOBE · LOCAL PREVIEW</p><h1>내 발자취를 지구본에서 만나세요</h1>
      <p>시간순 연결은 유지합니다. 실제 도로를 예측하지 않고, 기록된 위치 사이의 흐름을 지구 표면을 따라 보여줍니다.</p></header>
    <section className="file-panel">
      <label className="file-button">JSON 등록<input aria-label="JSON 등록" type="file" accept=".json,application/json" onChange={e => { const file = e.currentTarget.files?.[0]; e.currentTarget.value = ''; load(file); }} /></label>
      <button onClick={() => { stop(); resetSelection(); setDemo(true); setResult(createPreviewDemo()); }}>합성 예제로 체험</button>
      <button onClick={() => { stop(); resetSelection(); setResult(null); setDemo(false); }} disabled={!result && !busy}>{busy ? '처리 취소' : '기록 지우기'}</button>
      <p>파일은 이 탭 안에서만 처리하며 전송·저장하지 않습니다. 현재 rawSignals 형식, 최대 64 MiB·100,000개 신호를 지원합니다.</p>
      <p className="note">상세 지도는 MapTiler에서 지도 자료를 불러옵니다. 이때 IP 주소와 보고 있는 지역·확대 수준이 서비스에 전달될 수 있습니다. JSON 내용·파일명·관측 시각은 전송하지 않습니다.</p>
    </section>
    <div role="status" aria-live="polite">{busy ? '로컬에서 위치·시각을 검사하고 정렬하는 중입니다…' : !result ? '원본을 선택하거나 합성 예제로 먼저 확인하세요.' : result.ok ? `${demo ? '완전 합성 예제' : '로컬 기록'} · 유효 위치 ${result.counts.accepted.toLocaleString()}개 · 연결 ${connections.length.toLocaleString()}개` : `[${result.code}] ${errors[result.code]}`}</div>
    {result?.counts && <p className="note">입력 신호 {result.counts.input.toLocaleString()}개 · 위치 외 신호 제외 {result.counts.ignoredSignals.toLocaleString()}개 · 잘못된 위치 제외 {result.counts.invalidPositions.toLocaleString()}개 · 추가 최상위 필드 미사용 {result.counts.ignoredRootFields}개. 유효 위치만 연결하며 제외된 기록이 있으면 그 앞뒤의 유효 위치가 연결됩니다.</p>}
    <section className="comparison" aria-label="기록 지도">
      <div className="map-heading"><h2>나의 발자취</h2>
        <label>표시 시간대 <select aria-label="표시 시간대" value={timezone} onChange={event => setTimezone(event.target.value as DisplayTimezone)}><option value="UTC">UTC</option><option value="Asia/Seoul">한국 시간 (UTC+09:00)</option></select></label>
      </div>
      <p className="legend">● 관측 위치　<span className="solid">━ 기록 지점 연결</span></p>
      <GlobeBoundary key={data?.datasetId ?? 'empty'}><Suspense fallback={<p>지도를 준비하고 있습니다…</p>}><MapTilerGlobe points={data?.observations ?? emptyPoints} connections={connections}
        selectedObservation={selectedObservation} focusRevision={focusRevision} timezone={timezone} candidates={candidates}
        onSelect={point => setSelectedId(point.id)} onClose={() => setSelectedId(null)}
        onPick={found => { setCandidates(found); setSelectedId(found[0]!.id); }} /></Suspense></GlobeBoundary>
      <p className="note">연결선은 기록된 지점 사이의 흐름이며 실제 도로나 이동 경로를 뜻하지 않습니다. 국가·지역·도시 이름과 경계는 확대 수준과 지도 자료에 따라 표시됩니다.</p>
    </section>
    {data && <div key={data.datasetId} className="data-panels">
      <Disclosure title="관측포인트 목록"><ObservationList points={data.observations} selectedId={selectedId} timezone={timezone} onSelect={point => { setCandidates(null); selectObservation(point); }} /></Disclosure>
      <Disclosure title="시간차 분포"><Histogram title="시간차 분포" values={times} edges={timeEdges} labels={timeLabels} unit="분" /></Disclosure>
      <Disclosure title="거리 분포"><Histogram title="거리 분포" values={distances} edges={distanceEdges} labels={distanceLabels} unit="km" /><p className="note">이웃 관측 사이의 지표면 최단 거리이며 실제 이동 거리나 도로 길이가 아닙니다.</p></Disclosure>
    </div>}
    <footer>브라우저를 닫거나 기록을 지우면 앱의 기록 참조를 해제합니다. 실제 지구본 화면에는 위치 정보가 드러나므로 공유할 때는 원본 지도 캡처 대신 표시 방식에 대한 의견을 알려 주세요. 방문 지정 기능은 준비 중이며, 사진 추가는 MVP 이후 확장 기능입니다.</footer>
  </main>;
}
