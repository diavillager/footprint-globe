import { excludedLocationIds, type QualityReport } from './locationQuality';
import { QualityControls } from './QualityControls';
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
import { summarizePlaces } from '../landmarks/placeSummary';
import { LandmarkRail, mappedStops } from '../landmarks/LandmarkRail';
import { formatDiaryTime } from './observationTime';
import { ImportCalendar, type ImportPeriod } from './ImportCalendar';
import { observationDay, selectImportDays } from './importDates';
import { allSourcePoints, representativeRoute } from './representativeRoute';
const empty = [] as const;
const emptyQuality: QualityReport = { suspects: new Map(), conflicts: new Set() };
const MapTilerGlobe = lazy(() => import('./MapTilerGlobe'));

const errors: Record<ImportError, string> = {
  INVALID_JSON: 'JSON 형식이 올바르지 않습니다.', UNSUPPORTED_FORMAT: '지원하는 Timeline JSON 또는 GPX 1.0·1.1 형식이 아닙니다.', INVALID_XML: 'GPX XML 형식이 올바르지 않습니다.', UNSUPPORTED_ENCODING: 'GPX는 UTF-8 파일을 지원합니다.', DTD_FORBIDDEN: 'DTD가 포함된 GPX는 처리하지 않습니다.',
  INPUT_LIMIT: '미리보기 한도(64 MiB, 신호·경로점 합계 100,000개)를 초과했습니다.',
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
  const [loaded,setLoaded] = useState<Extract<ParseResult,{ok:true}> | null>(null);
  const [loadedQuality,setLoadedQuality] = useState<QualityReport>(emptyQuality);
  const [period,setPeriod] = useState<ImportPeriod | null>(null);
  const [activePeriod,setActivePeriod] = useState<ImportPeriod | null>(null);
  const allowOnCommit=useRef(false);
  const [busy, setBusy] = useState(false);
  const [timezone, setTimezone] = useState<DisplayTimezone>('UTC');
  const [panel, setPanel] = useState<'points' | 'distribution' | 'mapping' | 'quality' | 'info' | 'import' | 'import-mode' | null>(null);
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
  const allPoints=useMemo<readonly Observation[]>(()=>data?allSourcePoints(data):empty,[data]);
  const loadedPoints=useMemo<readonly Observation[]>(()=>loaded?allSourcePoints(loaded.data):empty,[loaded]);
  const [quality, setQuality] = useState<QualityReport>(emptyQuality);
  const [hideSuspects, setHideSuspects] = useState(true);
  const [restored, setRestored] = useState<ReadonlySet<ObservationId>>(new Set());
  // The key encodes actual membership, so no-op preference changes preserve the session and camera.
  const excludedKey = useMemo(() => JSON.stringify(excludedLocationIds(quality,hideSuspects,restored)), [quality,hideSuspects,restored]);
  const projection = useMemo(() => representativeRoute(data??{datasetId:'dataset:empty',observations:[],recordedPaths:[],recordedVisits:[]},quality,JSON.parse(excludedKey) as ObservationId[],new Set(),new Map(allPoints.map(p=>[p.id,observationDay(p,activePeriod?.timezone??'UTC')]))),[data,quality,excludedKey,allPoints,activePeriod]);
  const breakBefore = useMemo(() => new Set(projection.breaks.keys()), [projection]);
  const landmarkSession = useMemo(() => createWikimediaSession(), [projection]);
  useEffect(() => {
    if (data) {landmarkSession.prepareRegions(data.datasetId, projection.points, breakBefore);if(allowOnCommit.current){allowOnCommit.current=false;landmarkSession.allow();}}
    return () => landmarkSession.dispose();
  }, [landmarkSession, data, projection, breakBefore]);
  usePlaceMapping(landmarkSession);
  const groups = landmarkSession.groups;
  const groupsByRepresentative = useMemo(() => new Map(groups.map(group => [group.representative.id, group])), [groups]);
  const stops = useMemo(() => mappedStops(groups, group => diaryCandidate(landmarkSession, group)), [groups, landmarkSession]);
  const mappedGroups = useMemo(() => stops.map(stop => stop.group), [stops]);
  const placeSummary = useMemo(() => summarizePlaces(groups, group => diaryCandidate(landmarkSession,group), breakBefore), [groups,landmarkSession,breakBefore]);
  const summaryPoints = useMemo(() => placeSummary.nodes.map(node => node.point), [placeSummary]);
  const selectedObservation = allPoints.find(point => point.id === selectedId) ?? null;
  const selectedGroup = viewMode === 'mapped' && selectedId ? groupsByRepresentative.get(selectedId) : undefined;
  const mappedSelection = !!selectedGroup && !!diaryCandidate(landmarkSession, selectedGroup);
  const showPlaceDetails = mappedSelection && focusMode !== 'rail';
  const candidateIndex = candidates?.findIndex(point => point.id === selectedId) ?? -1;
  const resetSelection = () => { setSelectedId(null); setCandidates(null); };
  useEffect(() => {
    if (!selectedId || !mappedSelection) return;
    const outside = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('.record-window, .observation-popup, .diary-balloon, .landmark-rail [data-place-id]')) return;
      resetSelection();
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') resetSelection(); };
    document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',escape);
    return () => { document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',escape); };
  },[selectedId,mappedSelection]);
  const connections = useMemo(() => [...connectAll(data?.observations ?? []),...connectAll(data?.detailedObservations??[])].filter(e=>e.to.predecessorId===undefined||e.to.predecessorId===e.from.id), [data]);
  const times = useMemo(() => connections.map(l => l.seconds / 60), [connections]);
  const distances = useMemo(() => connections.map(l => l.km), [connections]);
  const load = (file: File | undefined) => {
    if (!file) return;
    stop(); landmarkSession.dispose(); resetSelection(); setResult(null); setLoaded(null);setPeriod(null);setActivePeriod(null);allowOnCommit.current=false;setPanel(null); setViewMode('raw');
    setQuality(emptyQuality); setHideSuspects(true); setRestored(new Set());
    if (file.size > PREVIEW_LIMITS.bytes) { setResult({ ok: false, code: 'INPUT_LIMIT' }); return; }
    setBusy(true);
    try {
      const current = new Worker(new URL('./preview.worker.ts', import.meta.url), { type: 'module' });
      worker.current = current;
      current.onmessage = (event: MessageEvent<ParseResult & { quality: QualityReport | null }>) => {
        if (worker.current !== current) return;
        if(event.data.ok){setLoaded(event.data);setLoadedQuality(event.data.quality??emptyQuality);setPanel('import');}
        else setResult(event.data);stop();
      };
      current.onerror = event => { event.preventDefault(); if (worker.current === current) { setResult({ ok: false, code: 'FILE_READ_FAILED' }); stop(); } };
      current.onmessageerror = () => { if (worker.current === current) { setResult({ ok: false, code: 'FILE_READ_FAILED' }); stop(); } };
      current.postMessage({ file, datasetId: `dataset:${crypto.randomUUID()}` } satisfies ImportRequest);
    } catch { stop(); setResult({ ok: false, code: 'FILE_READ_FAILED' }); }
  };
  const confirmImport=(allow:boolean)=>{
    if(!loaded||!period) return;
    const raw=selectImportDays(loaded.data.observations,period.timezone,period.start,period.end).points;
    const detail=selectImportDays(loaded.data.detailedObservations??[],period.timezone,period.start,period.end).points;
    const ids=new Set([...raw,...detail].map(p=>p.id));
    if(!ids.size) return;
    setQuality(ids.size===loadedPoints.length?loadedQuality:{suspects:new Map([...loadedQuality.suspects].filter(([id])=>ids.has(id))),conflicts:new Set([...loadedQuality.conflicts].filter(id=>ids.has(id)))});
    setHideSuspects(true);setRestored(new Set());setActivePeriod(period);setTimezone(period.timezone);
    allowOnCommit.current=allow;
    setResult({...loaded,data:{...loaded.data,observations:raw,detailedObservations:detail}});
    setViewMode('raw');setPanel(null);
  };
  const closePanel=()=>{if(panel==='import'||panel==='import-mode'){setLoaded(null);setPeriod(null);setLoadedQuality(emptyQuality);}setPanel(null);};
  const changeQuality = (nextHide: boolean, nextRestored: ReadonlySet<ObservationId>) => {
    if (JSON.stringify(excludedLocationIds(quality,nextHide,nextRestored)) !== excludedKey) {
      landmarkSession.dispose(); resetSelection(); setViewMode('raw');
    }
    setHideSuspects(nextHide); setRestored(nextRestored);
  };
  const restore = (id: ObservationId) => {
    const next = new Set(restored); if (next.has(id)) next.delete(id); else next.add(id);
    changeQuality(hideSuspects,next);
  };
  return <main className="map-app">
    <GlobeBoundary resetKey={data?.datasetId ?? 'empty'}><Suspense fallback={<p className="map-message">지도를 준비하고 있습니다…</p>}><MapTilerGlobe points={viewMode === 'raw' ? projection.points : summaryPoints} connections={viewMode === 'raw' ? projection.connections : empty} summary={viewMode === 'mapped' ? placeSummary : null} groups={viewMode === 'mapped' ? mappedGroups : empty}
      originalPoints={allPoints} landmarkSession={landmarkSession} gapConnections={projection.gapConnections}
      selectedObservation={selectedObservation} focusRevision={focusRevision} focusMode={focusMode} timezone={timezone}
      showPointPopup={!panel && !mappedSelection} candidates={candidates ?? empty} onClose={() => setSelectedId(null)}
      onMapInteract={() => { if (mappedSelection) resetSelection(); }} onSelect={point => { setFocusMode('detail'); if (viewMode === 'mapped') setCandidates(placeSummary.byObservation.get(point.id)?.groups.map(group => group.representative) ?? null); setSelectedId(point.id); }}
      onPick={found => { setFocusMode('detail'); setCandidates(found); setSelectedId(found[0]!.id); }} /></Suspense></GlobeBoundary>
    <div className="top-controls">
      <nav className="toolbar" aria-label="발자취 도구">
        <span className="brand">FOOTPRINT</span>
        <label className="file-button">JSON·GPX 올리기<input aria-label="JSON·GPX 올리기" type="file" accept=".json,.gpx,application/json,application/gpx+xml" onChange={e => { const file = e.currentTarget.files?.[0]; e.currentTarget.value = ''; load(file); }} /></label>
        <button onClick={() => { stop(); landmarkSession.dispose(); resetSelection(); setResult(null);setLoaded(null);setLoadedQuality(emptyQuality);setPeriod(null);setActivePeriod(null);allowOnCommit.current=false; setQuality(emptyQuality); setRestored(new Set()); setHideSuspects(true); setPanel(null); setViewMode('raw'); }} disabled={!result && !loaded && !busy}>{busy ? '처리 취소' : '지우기'}</button>
        <div className="timezone-switch" role="group" aria-label="표시 시간대"><button aria-pressed={timezone === 'UTC'} onClick={() => setTimezone('UTC')}>UTC</button><button aria-pressed={timezone === 'Asia/Seoul'} onClick={() => setTimezone('Asia/Seoul')}>KST</button></div>
        <div className="timezone-switch" role="group" aria-label="경로 보기"><button disabled={!data} aria-pressed={viewMode === 'raw'} onClick={() => { resetSelection(); setViewMode('raw'); }}>{data?.detailedObservations?.length?'기록 경로':'원본 경로'}</button><button disabled={!landmarkSession.mappingComplete(groups)} title={landmarkSession.mappingComplete(groups) ? '묶인 기록과 주변 장소 보기' : '장소·사진 매핑이 완료되면 사용할 수 있습니다'} aria-pressed={viewMode === 'mapped'} onClick={() => { resetSelection(); setViewMode('mapped'); }}>장소별 보기</button></div>
        <button disabled={!data} aria-haspopup="dialog" onClick={() => setPanel('points')}>위치 기록</button>
        <button disabled={!data} aria-haspopup="dialog" onClick={() => setPanel('distribution')}>기록 분포</button>
        <label className="quality-toggle"><input type="checkbox" disabled={!data} checked={hideSuspects} onChange={event => changeQuality(event.target.checked,restored)} />오류 의심 지점 숨기기</label>
        <button disabled={!data} aria-haspopup="dialog" onClick={() => setPanel('quality')}>위치 검사{data ? ` · 숨김 ${projection.excluded.size}` : ''}</button>
        <MappingProgress groups={groups} session={landmarkSession} onShowPhoto={point => { setViewMode('mapped'); setCandidates(null); selectObservation(point); }} onStop={() => landmarkSession.stopMapping()} />
        <button aria-label="이용 안내" aria-haspopup="dialog" onClick={() => setPanel('info')}>ⓘ</button>
      </nav>
      <div className="import-summary"><div className="import-status" role="status" aria-live="polite">{busy ? '로컬에서 위치·시각을 검사하고 정렬하는 중입니다…' : !result ? loaded ? `분석 완료 · 관측 ${loadedPoints.length.toLocaleString()}개 · 기간과 표시 방식을 선택해 주세요.` : 'JSON 또는 GPX를 올려 발자취를 확인하세요.' : result.ok ? '관측 ' + allPoints.length.toLocaleString() + '개 · 대표 경로 ' + projection.points.length.toLocaleString() + '개 · 연결 ' + projection.connections.length.toLocaleString() + '개 · 숨김 ' + projection.excluded.size.toLocaleString() + '개' + (projection.gapConnections.length ? ' · 공백 연결 '+projection.gapConnections.length+'개 (점선)' : '') + (groups.length ? ' · 장소별 지점 ' + groups.length.toLocaleString() + '개' : '') : '[' + result.code + '] ' + errors[result.code]}</div>{data && <button className="period-control" title={activePeriod ? `${activePeriod.start} ~ ${activePeriod.end}` : undefined} onClick={()=>{landmarkSession.dispose();resetSelection();setResult(null);setQuality(emptyQuality);setViewMode('raw');setPeriod(null);setPanel('import');}}>기간 다시 선택</button>}</div>
    </div>
    {viewMode === 'mapped' && <div className="summary-legend" role="status">장소 {placeSummary.nodes.length}곳 · 연결 {placeSummary.edges.length}개<span>같은 장소와 가까운 경유점을 모아 표시합니다.</span>{mappedSelection && <span>선택 기록의 앞뒤 연결 강조</span>}</div>}
    {viewMode === 'mapped' && stops.length > 0 && <LandmarkRail key={data?.datasetId} stops={stops} selectedId={selectedId} onSelect={point => { setCandidates(null); setPanel(null); selectObservation(point, 'rail'); }} />}
    {!panel && selectedObservation && showPlaceDetails && <Panel title="기록 상세" modal={false} onClose={resetSelection}>
      <div className="record-detail">
        <h3>{viewMode === 'mapped' && groupsByRepresentative.get(selectedObservation.id) ? `기록 지점 ${mappedGroups.findIndex(group => group.representative.id === selectedObservation.id) + 1}` : `관측 ${allPoints.indexOf(selectedObservation) + 1}`}</h3>
        <p>{formatDiaryTime(selectedObservation.time, timezone)}</p>
        <p>위도 {selectedObservation.coordinate.latitude} · 경도 {selectedObservation.coordinate.longitude}</p>
        {candidates && candidates.length > 1 && <div className="detail-neighbors"><p>연결된 기록 {candidateIndex + 1} / {candidates.length}</p><button disabled={candidateIndex <= 0} onClick={() => setSelectedId(candidates[candidateIndex - 1]!.id)}>이전 지점</button><button disabled={candidateIndex >= candidates.length - 1} onClick={() => setSelectedId(candidates[candidateIndex + 1]!.id)}>다음 지점</button></div>}
        {viewMode === 'mapped' && groupsByRepresentative.has(selectedObservation.id) && <><p>관측 {groupsByRepresentative.get(selectedObservation.id)!.observationCount}개 · 첫 관측 {formatDiaryTime(groupsByRepresentative.get(selectedObservation.id)!.start, timezone)} · 마지막 관측 {formatDiaryTime(groupsByRepresentative.get(selectedObservation.id)!.end, timezone)}</p><LandmarkPanel group={groupsByRepresentative.get(selectedObservation.id)!} session={landmarkSession} /></>}
      </div>
    </Panel>}
    {panel && <Panel title={{ import:'등록할 기간 선택', 'import-mode':'표시 방식 선택', points: '위치 기록', distribution: '기록 분포', mapping: '장소 매핑 안내', quality: '위치 검사', info: '이용 안내' }[panel]} onClose={closePanel}>
      {panel==='import' && loaded && <ImportCalendar points={loadedPoints} initialTimezone={timezone} onNext={value=>{setPeriod(value);setPanel('import-mode');}}/>}
      {panel==='import-mode' && period && <><p>{period.start} ~ {period.end} ({period.timezone==='UTC'?'UTC':'KST'}) · 선택을 확정하면 경로가 지도에 표시됩니다.</p><p>상세 경로가 있는 구간은 우선 사용하고, 없는 구간은 원시 관측으로 보완합니다. 원본은 위치 기록에 보존하며 신뢰하기 어려운 경계는 연결하지 않습니다.</p><button onClick={()=>setPanel('import')}>기간 다시 고르기</button><MappingConsent session={landmarkSession} onAllow={()=>confirmImport(true)} onDecline={()=>confirmImport(false)}/></>}
      {panel === 'points' && data && <ObservationList points={allPoints} selectedId={selectedId} timezone={timezone} onSelect={point => { setViewMode('raw'); setCandidates(null); selectObservation(point); setPanel(null); }} quality={quality} excluded={projection.excluded} restored={restored} onRestore={restore} />}
      {panel === 'quality' && data && <QualityControls points={allPoints} report={quality} projection={projection} restored={restored} timezone={timezone} onRestore={restore} onSelect={point => { setViewMode('raw'); setCandidates(null); selectObservation(point); setPanel(null); }} onRemap={() => setPanel('mapping')} />}
      {panel === 'mapping' && <><p>원본 {allPoints.length}개 중 오류 의심 지점 {projection.excluded.size}개를 숨기고 {projection.points.length}개를 매핑합니다. 판정과 개별 복원은 ‘위치 검사’에서 확인할 수 있습니다.</p><MappingConsent session={landmarkSession} onAllow={() => { landmarkSession.allow(); setViewMode('raw'); setPanel(null); }} onDecline={() => { setViewMode('raw'); setPanel(null); }} /></>}
      {panel === 'distribution' && <p>선택 기간의 출처별 원본 인접 관측을 기준으로 계산합니다. 숨기기와 지도 연결 중단은 이 분포에 적용하지 않습니다.</p>}
      {panel === 'distribution' && <div className="distribution-options" role="group" aria-label="분류 기준"><button aria-pressed={distributionMode === 'time'} onClick={() => setDistributionMode('time')}>시간 간격</button><button aria-pressed={distributionMode === 'distance'} onClick={() => setDistributionMode('distance')}>이동 거리</button></div>}
      {panel === 'distribution' && distributionMode === 'time' && <Histogram title="시간차 분포" values={times} edges={timeEdges} labels={timeLabels} unit="분" />}
      {panel === 'distribution' && distributionMode === 'distance' && <><Histogram title="거리 분포" values={distances} edges={distanceEdges} labels={distanceLabels} unit="km" /><p>이웃 관측 사이의 지표면 최단 거리이며 실제 이동 거리나 도로 길이가 아닙니다.</p></>}
      {panel === 'info' && <><p>JSON·GPX는 이 탭에서만 처리하며 전송·저장하지 않습니다. Timeline 원시 관측·상세 경로와 GPX 1.0·1.1을 지원합니다. 최대 64 MiB·100,000개 신호를 지원합니다.</p><p>MapTiler 지도 요청으로 IP 주소와 열람 지역·확대 수준이 서비스에 전달될 수 있습니다. JSON·GPX 본문·파일명·관측 시각은 전송하지 않습니다.</p><p>실선은 기록 지점 사이의 흐름이며 실제 도로를 복원한 경로가 아닙니다. 점선은 GPX 기록 공백의 양 끝을 잇는 안내선입니다. 신호가 없던 동안의 실제 위치나 이동 수단을 추정하지 않습니다. 지우기·새로고침·탭 종료 시 기록은 유지되지 않습니다.</p>{result?.counts && <p>전체 파일 입력 신호·경로점 {result.counts.input.toLocaleString()}개 · 위치 외 신호 제외 {result.counts.ignoredSignals.toLocaleString()}개 · 잘못된 위치 제외 {result.counts.invalidPositions.toLocaleString()}개. 파서에서 유효하지 않은 입력은 관측으로 채택하지 않습니다. 위치 검사는 채택된 원본 관측을 보존하며, 숨긴 지점의 앞뒤·30분 초과 공백·동일 시각 위치 충돌은 연결하지 않습니다.</p>}</>}
      {panel === 'info' && <><p>기록 주변 300m를 덮는 구역의 장소를 먼저 조회하고 원본 포인트와 대조합니다. 같은 장소에 연결된 연속 기록에서 장소와 가장 가까운 관측을 대표점으로 정하고, 그 주변 100m 이내를 묶습니다. 다른 장소로 이동하거나 인접 공백이 120분을 넘으면 분리합니다. 원본 목록·분포는 유지하며 관측 시간 범위는 확정 체류 시간이 아닙니다.</p><p>파일별 동의 후 검색 구역 경계를 일본어·영어 Wikipedia로 보내고 같은 Wikidata ID는 합칩니다. 도시·행정구역·사건으로 분류된 문서는 제외하지만, 일반 시설도 후보에 포함될 수 있습니다. 지역 검색은 모든 장소의 완전한 수집을 보장하지 않으며 실패한 지역은 후보 없음과 구분합니다. 원본 포인트 대조와 묶기 후 연결된 장소의 사진을 조회합니다. 가장 가까운 후보를 추정 표시하며 실제 방문을 확정하지 않습니다. 동시 최대 3건·모든 메타데이터 요청 400ms 이상 간격·파일당 횟수 제한 없음·요청당 10초 제한이며 자동 재시도하지 않습니다. 사용량 제한·인증 오류 때 자동 조회를 중지합니다. 사진은 해당 Wikidata 항목의 P18과 해당 Wikipedia 문서의 자유 이용 대표 이미지만 확인합니다. Commons에 파일명, Wikidata에 항목 ID를 전달하며 원본 시각·파일명·기록 ID는 보내지 않습니다. 사진 출처와 이용 조건을 표시합니다. 문서에 좌표·사진이 없으면 찾지 못합니다. 사진 조회 상태는 상단 원형 진행 표시에서 확인할 수 있습니다. 추가 조회 중단은 진행 중인 요청을 취소하고 이미 조회한 결과를 유지합니다. 기록과 조회 결과의 삭제는 JSON·GPX 올리기 옆 지우기를 사용합니다.</p></>}

    </Panel>}
  </main>;
}
