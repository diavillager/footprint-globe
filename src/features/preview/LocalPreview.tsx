import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PREVIEW_LIMITS } from '../../parser';
import type { ParseResult, ImportError, Observation, ObservationId } from '../../domain/timeline';
import type { ImportRequest } from './importFile';
import { connectAll, distribution } from './analysis';
import { ObservationList } from './ObservationList';
import type { DisplayTimezone } from './observationTime';
import { createWikimediaSession } from '../landmarks/createSession';
import { diaryCandidate, MappingConsent, MappingProgress, usePlaceMapping } from '../landmarks/TravelDiary';
import { LandmarkPanel } from '../landmarks/LandmarkPanel';
import { LandmarkRail, mappedStops } from '../landmarks/LandmarkRail';
import { formatDiaryTime } from './observationTime';
const empty = [] as const;
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

function Panel({ title, children, onClose, modal = true }: { title: string; children: ReactNode; onClose: () => void; modal?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const node = dialog.current!; if (modal) node.showModal(); else node.show(); return () => node.close(); }, [modal]);
  return <dialog ref={dialog} className={`data-window${title === '기록 상세' ? ' record-window' : ''}`} aria-label={title} onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); } }}><div className="window-heading"><h2>{title}</h2><button autoFocus aria-label="창 닫기" onClick={onClose}>×</button></div><div className="window-content">{children}</div></dialog>;
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
  const [panel, setPanel] = useState<'points' | 'distribution' | 'mapping' | 'info' | null>(null);
  const [viewMode, setViewMode] = useState<'raw' | 'mapped'>('raw');
  const [distributionMode, setDistributionMode] = useState<'time' | 'distance'>('time');
  const [selectedId, setSelectedId] = useState<ObservationId | null>(null);
  const [candidates, setCandidates] = useState<Observation[] | null>(null);
  const [focusRevision, setFocusRevision] = useState(0);
  const [focusMode, setFocusMode] = useState<'detail' | 'rail'>('detail');
  const selectObservation = (point: Observation, mode: 'detail' | 'rail' = 'detail') => { setFocusMode(mode); setSelectedId(point.id); setFocusRevision(value => value + 1); };
  const worker = useRef<Worker | null>(null);
  const stop = () => { worker.current?.terminate(); worker.current = null; setBusy(false); };
  useEffect(() => () => worker.current?.terminate(), []);
  const data = result?.ok ? result.data : null;
  const landmarkSession = useMemo(() => createWikimediaSession(), [data]);
  useEffect(() => {
    if (data) landmarkSession.prepareRegions(data.datasetId, data.observations);
    return () => landmarkSession.dispose();
  }, [landmarkSession, data]);
  usePlaceMapping(landmarkSession);
  const groups = landmarkSession.groups;
  const groupsByRepresentative = useMemo(() => new Map(groups.map(group => [group.representative.id, group])), [groups]);
  const stops = useMemo(() => mappedStops(groups, group => diaryCandidate(landmarkSession, group)), [groups, landmarkSession]);
  const mappedGroups = useMemo(() => stops.map(stop => stop.group), [stops]);
  const groupedPoints = useMemo(() => groups.map(group => group.representative), [groups]);
  const groupedConnections = useMemo(() => connectAll(groupedPoints), [groupedPoints]);
  const selectedObservation = data?.observations.find(point => point.id === selectedId) ?? null;
  const selectedGroup = viewMode === 'mapped' && selectedId ? groupsByRepresentative.get(selectedId) : undefined;
  const mappedSelection = !!selectedGroup && !!diaryCandidate(landmarkSession, selectedGroup);
  const showPlaceDetails = mappedSelection && focusMode !== 'rail';
  const candidateIndex = candidates?.findIndex(point => point.id === selectedId) ?? -1;
  const resetSelection = () => { setSelectedId(null); setCandidates(null); };
  useEffect(() => {
    if (!selectedId || !mappedSelection) return;
    const outside = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('.record-window, .observation-popup, .landmark-rail [data-place-id]')) return;
      resetSelection();
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') resetSelection(); };
    document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',escape);
    return () => { document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',escape); };
  },[selectedId,mappedSelection]);
  const connections = useMemo(() => connectAll(data?.observations ?? []), [data]);
  const times = useMemo(() => connections.map(l => l.seconds / 60), [connections]);
  const distances = useMemo(() => connections.map(l => l.km), [connections]);
  const load = (file: File | undefined) => {
    if (!file) return;
    stop(); landmarkSession.dispose(); resetSelection(); setResult(null); setPanel(null); setViewMode('raw');
    if (file.size > PREVIEW_LIMITS.bytes) { setResult({ ok: false, code: 'INPUT_LIMIT' }); return; }
    setBusy(true);
    try {
      const current = new Worker(new URL('./preview.worker.ts', import.meta.url), { type: 'module' });
      worker.current = current;
      current.onmessage = (event: MessageEvent<ParseResult>) => {
        if (worker.current !== current) return;
        setResult(event.data); if (event.data.ok) setPanel('mapping'); stop();
      };
      current.onerror = event => { event.preventDefault(); if (worker.current === current) { setResult({ ok: false, code: 'FILE_READ_FAILED' }); stop(); } };
      current.onmessageerror = () => { if (worker.current === current) { setResult({ ok: false, code: 'FILE_READ_FAILED' }); stop(); } };
      current.postMessage({ file, datasetId: `dataset:${crypto.randomUUID()}` } satisfies ImportRequest);
    } catch { stop(); setResult({ ok: false, code: 'FILE_READ_FAILED' }); }
  };
  return <main className="map-app">
    <GlobeBoundary resetKey={data?.datasetId ?? 'empty'}><Suspense fallback={<p className="map-message">지도를 준비하고 있습니다…</p>}><MapTilerGlobe points={viewMode === 'raw' ? data?.observations ?? empty : groupedPoints} connections={viewMode === 'raw' ? connections : groupedConnections} groups={viewMode === 'mapped' ? mappedGroups : empty}
      originalPoints={data?.observations ?? empty} landmarkSession={landmarkSession}
      selectedObservation={selectedObservation} focusRevision={focusRevision} focusMode={focusMode} timezone={timezone}
      showPointPopup={!panel && !mappedSelection} candidates={candidates ?? empty} onClose={() => setSelectedId(null)}
      onMapInteract={() => { if (mappedSelection) resetSelection(); }} onSelect={point => { setFocusMode('detail'); setSelectedId(point.id); }}
      onPick={found => { setFocusMode('detail'); setCandidates(found); setSelectedId(found[0]!.id); }} /></Suspense></GlobeBoundary>
    <div className="top-controls">
      <nav className="toolbar" aria-label="발자취 도구">
        <span className="brand">FOOTPRINT</span>
        <label className="file-button">JSON 올리기<input aria-label="JSON 올리기" type="file" accept=".json,application/json" onChange={e => { const file = e.currentTarget.files?.[0]; e.currentTarget.value = ''; load(file); }} /></label>
        <button onClick={() => { stop(); landmarkSession.dispose(); resetSelection(); setResult(null); setPanel(null); setViewMode('raw'); }} disabled={!result && !busy}>{busy ? '처리 취소' : '지우기'}</button>
        <div className="timezone-switch" role="group" aria-label="표시 시간대"><button aria-pressed={timezone === 'UTC'} onClick={() => setTimezone('UTC')}>UTC</button><button aria-pressed={timezone === 'Asia/Seoul'} onClick={() => setTimezone('Asia/Seoul')}>KST</button></div>
        <div className="timezone-switch" role="group" aria-label="경로 보기"><button disabled={!data} aria-pressed={viewMode === 'raw'} onClick={() => { resetSelection(); setViewMode('raw'); }}>원본 경로</button><button disabled={!landmarkSession.mappingComplete(groups)} title={landmarkSession.mappingComplete(groups) ? '묶인 기록과 주변 장소 보기' : '장소·사진 매핑이 완료되면 사용할 수 있습니다'} aria-pressed={viewMode === 'mapped'} onClick={() => { resetSelection(); setViewMode('mapped'); }}>장소별 보기</button></div>
        <button disabled={!data} aria-haspopup="dialog" onClick={() => setPanel('points')}>위치 기록</button>
        <button disabled={!data} aria-haspopup="dialog" onClick={() => setPanel('distribution')}>기록 분포</button>
        <MappingProgress groups={groups} session={landmarkSession} onShowPhoto={point => { setViewMode('mapped'); setCandidates(null); selectObservation(point); }} onStop={() => landmarkSession.stopMapping()} />
        <button aria-label="이용 안내" aria-haspopup="dialog" onClick={() => setPanel('info')}>ⓘ</button>
      </nav>
      <div className="import-status" role="status" aria-live="polite">{busy ? '로컬에서 위치·시각을 검사하고 정렬하는 중입니다…' : !result ? 'JSON을 올려 발자취를 확인하세요.' : result.ok ? '관측 ' + result.counts.accepted.toLocaleString() + '개 · 연결 ' + connections.length.toLocaleString() + '개' + (groups.length ? ' · 장소별 지점 ' + groups.length.toLocaleString() + '개' : '') : '[' + result.code + '] ' + errors[result.code]}</div>
    </div>
    {viewMode === 'mapped' && stops.length > 0 && <LandmarkRail key={data?.datasetId} stops={stops} selectedId={selectedId} onSelect={point => { setCandidates(null); setPanel(null); selectObservation(point, 'rail'); }} />}
    {!panel && selectedObservation && showPlaceDetails && <Panel title="기록 상세" modal={false} onClose={resetSelection}>
      <div className="record-detail">
        <h3>{viewMode === 'mapped' && groupsByRepresentative.get(selectedObservation.id) ? `기록 지점 ${mappedGroups.findIndex(group => group.representative.id === selectedObservation.id) + 1}` : `관측 ${data!.observations.indexOf(selectedObservation) + 1}`}</h3>
        <p>{formatDiaryTime(selectedObservation.time, timezone)}</p>
        <p>위도 {selectedObservation.coordinate.latitude} · 경도 {selectedObservation.coordinate.longitude}</p>
        {candidates && candidates.length > 1 && <div className="detail-neighbors"><p>겹친 지점 {candidateIndex + 1} / {candidates.length}</p><button disabled={candidateIndex <= 0} onClick={() => setSelectedId(candidates[candidateIndex - 1]!.id)}>이전 지점</button><button disabled={candidateIndex >= candidates.length - 1} onClick={() => setSelectedId(candidates[candidateIndex + 1]!.id)}>다음 지점</button></div>}
        {viewMode === 'mapped' && groupsByRepresentative.has(selectedObservation.id) && <><p>관측 {groupsByRepresentative.get(selectedObservation.id)!.observationCount}개 · 첫 관측 {formatDiaryTime(groupsByRepresentative.get(selectedObservation.id)!.start, timezone)} · 마지막 관측 {formatDiaryTime(groupsByRepresentative.get(selectedObservation.id)!.end, timezone)}</p><LandmarkPanel group={groupsByRepresentative.get(selectedObservation.id)!} session={landmarkSession} /></>}
      </div>
    </Panel>}
    {panel && <Panel title={{ points: '위치 기록', distribution: '기록 분포', mapping: '장소 매핑 안내', info: '이용 안내' }[panel]} onClose={() => setPanel(null)}>
      {panel === 'points' && data && <ObservationList points={data.observations} selectedId={selectedId} timezone={timezone} onSelect={point => { setCandidates(null); selectObservation(point); setPanel(null); }} />}
      {panel === 'mapping' && <MappingConsent session={landmarkSession} onAllow={() => { landmarkSession.allow(); setViewMode('raw'); setPanel(null); }} onDecline={() => { setViewMode('raw'); setPanel(null); }} />}
      {panel === 'distribution' && <div className="distribution-options" role="group" aria-label="분류 기준"><button aria-pressed={distributionMode === 'time'} onClick={() => setDistributionMode('time')}>시간 간격</button><button aria-pressed={distributionMode === 'distance'} onClick={() => setDistributionMode('distance')}>이동 거리</button></div>}
      {panel === 'distribution' && distributionMode === 'time' && <Histogram title="시간차 분포" values={times} edges={timeEdges} labels={timeLabels} unit="분" />}
      {panel === 'distribution' && distributionMode === 'distance' && <><Histogram title="거리 분포" values={distances} edges={distanceEdges} labels={distanceLabels} unit="km" /><p>이웃 관측 사이의 지표면 최단 거리이며 실제 이동 거리나 도로 길이가 아닙니다.</p></>}
      {panel === 'info' && <><p>JSON은 이 탭에서만 처리하며 전송·저장하지 않습니다. rawSignals 형식, 최대 64 MiB·100,000개 신호를 지원합니다.</p><p>MapTiler 지도 요청으로 IP 주소와 열람 지역·확대 수준이 서비스에 전달될 수 있습니다. JSON 본문·파일명·관측 시각은 전송하지 않습니다.</p><p>연결선은 기록 지점 사이의 흐름이며 실제 이동 경로가 아닙니다. 지우기·새로고침·탭 종료 시 기록은 유지되지 않습니다.</p>{result?.counts && <p>입력 신호 {result.counts.input.toLocaleString()}개 · 위치 외 신호 제외 {result.counts.ignoredSignals.toLocaleString()}개 · 잘못된 위치 제외 {result.counts.invalidPositions.toLocaleString()}개. 제외된 기록 앞뒤의 유효 위치가 연결됩니다.</p>}</>}
      {panel === 'info' && <><p>기록 주변 300m를 덮는 구역의 장소를 먼저 조회하고 원본 포인트와 대조합니다. 같은 장소에 연결된 연속 기록에서 장소와 가장 가까운 관측을 대표점으로 정하고, 그 주변 100m 이내를 묶습니다. 다른 장소로 이동하거나 인접 공백이 120분을 넘으면 분리합니다. 원본 목록·분포는 유지하며 관측 시간 범위는 확정 체류 시간이 아닙니다.</p><p>파일별 동의 후 검색 구역 경계를 일본어·영어 Wikipedia로 보내고 같은 Wikidata ID는 합칩니다. 도시·행정구역·사건으로 분류된 문서는 제외하지만, 일반 시설도 후보에 포함될 수 있습니다. 지역 검색은 모든 장소의 완전한 수집을 보장하지 않으며 실패한 지역은 후보 없음과 구분합니다. 원본 포인트 대조와 묶기 후 연결된 장소의 사진을 조회합니다. 가장 가까운 후보를 추정 표시하며 실제 방문을 확정하지 않습니다. 동시 최대 3건·모든 메타데이터 요청 400ms 이상 간격·파일당 횟수 제한 없음·요청당 10초 제한이며 자동 재시도하지 않습니다. 사용량 제한·인증 오류 때 자동 조회를 중지합니다. 사진은 해당 Wikidata 항목의 P18과 해당 Wikipedia 문서의 자유 이용 대표 이미지만 확인합니다. Commons에 파일명, Wikidata에 항목 ID를 전달하며 원본 시각·파일명·기록 ID는 보내지 않습니다. 사진 출처와 이용 조건을 표시합니다. 문서에 좌표·사진이 없으면 찾지 못합니다. 사진 조회 상태는 상단 원형 진행 표시에서 확인할 수 있습니다. 추가 조회 중단은 진행 중인 요청을 취소하고 이미 조회한 결과를 유지합니다. 기록과 조회 결과의 삭제는 JSON 올리기 옆 지우기를 사용합니다.</p></>}

    </Panel>}
  </main>;
}
