import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Observation } from '../../domain/timeline';
import type { ObservationGroup } from './groups';
import { LandmarkSession, startRegionMapping } from './session';
import { categoryLabel } from './categories';
import { LandmarkPhoto } from './LandmarkPhoto';
import { formatDiaryTime, type DisplayTimezone } from '../preview/observationTime';
export function diaryCandidate(session: LandmarkSession, group: ObservationGroup) {
  const state = session.state(group.groupId);
  if (state.status !== 'success') return null;
  return state.candidates[0] ?? null;
}
export function DiaryCard({ group, index, session, timezone, onSelect }: { group: ObservationGroup; index: number; session: LandmarkSession; timezone: DisplayTimezone; onSelect: (point: Observation) => void }) {
  const candidate = diaryCandidate(session, group);
  if (!candidate) return null;
  const label = candidate.name;
  const media = session.image(candidate.providerPlaceId);
  return <article className="diary-card">
    <button className="diary-card-hit" aria-label={`${index + 1}. ${label} 상세 보기`} onClick={event => { event.stopPropagation(); onSelect(group.representative); }}>
      <span className="diary-card-photo">{session.image(candidate.providerPlaceId) ? <LandmarkPhoto id={candidate.providerPlaceId} session={session} compact /> : <span className="photo-placeholder">사진 없음</span>}</span>
      <span className="diary-card-copy"><span className="diary-number">{index + 1}</span><strong>{label}</strong><small>{formatDiaryTime(group.representative.time, timezone)}</small><small className="place-category">{categoryLabel(candidate.categories)}</small></span>
    </button>
    {media && <a className="diary-attribution" href={media.source} target="_blank" rel="noreferrer">사진 출처{media.author ? ` · ${media.author}` : ''}{media.license ? ` · ${media.license}` : ''}</a>}
  </article>;
}
export function usePlaceMapping(session: LandmarkSession) {
  useSyncExternalStore(session.subscribe, session.snapshot);
  useEffect(() => startRegionMapping(session), [session, session.consent]);
}
export function MappingConsent({ session, onAllow, onDecline }: { session: LandmarkSession; onAllow: () => void; onDecline: () => void }) {
  return <div className="mapping-consent"><p>기록 주변 지역의 장소를 조회하고, 장소를 중심으로 기록과 사진을 연결할까요?</p><p>허용하면 검색 구역 경계 좌표를 일본어·영어 Wikipedia에 보내 주변 문서를 찾습니다. Wikidata에는 항목 ID, Commons에는 파일명으로 사진을 요청합니다. Geoapify는 사용하지 않습니다. IP·앱 출처가 전달될 수 있으며 JSON 본문·원본 파일명·시각은 보내지 않습니다.</p><p>결과는 이 파일을 연 동안만 유지합니다. 가까운 장소의 추정 정보이며 실제 방문을 확정하지 않습니다. 겹치는 검색 구역은 재사용하고 원본 포인트와의 대조는 브라우저에서 수행합니다. 좌표가 등록된 문서만 찾으며 일반 시설도 포함될 수 있습니다. 넓거나 밀집된 지역은 여러 번 조회합니다. 공개 API는 무료이며 속도 제한에 도달하면 중단합니다.</p><p>원본 경로를 보면서 조회합니다. 장소·사진 처리가 모두 끝나면 ‘장소별 보기’를 선택할 수 있습니다.</p><div className="consent-actions"><button onClick={onDecline}>원본만 보기</button><button disabled={!!session.unavailable} onClick={onAllow}>허용하고 장소 매핑</button></div>{session.unavailable && <p>[{session.unavailable}] 장소 조회를 사용할 수 없습니다.</p>}</div>;
}
export function MappingProgress({ groups, session, onShowPhoto, onStop }: { groups: readonly ObservationGroup[]; session: LandmarkSession; onShowPhoto: (point: Observation) => void; onStop: () => void }) {
  useSyncExternalStore(session.subscribe, session.snapshot);
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => { const rect = anchor.current!.getBoundingClientRect(); setPosition({ top: rect.bottom, left: Math.max(10, Math.min(rect.right - 270, innerWidth - 280)) }); };
    place(); window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => { if (!anchor.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);
  const regions = session.regionSummary;
  const {success, empty, error:failure} = session.pointCounts;
  const unique = new Set<string>();
  const photoGroups = groups.filter(group => {
    const candidate = diaryCandidate(session, group);
    if (!candidate || unique.has(candidate.providerPlaceId)) return false;
    unique.add(candidate.providerPlaceId); return !!session.image(candidate.providerPlaceId) && session.imageStatus(candidate.providerPlaceId) !== 'load-error';
  });
  const images = session.imageSummary();
  const imageDone = Object.values(images).reduce((sum, count) => sum + count, 0) - images.loading;
  const ratio = .65 * (regions.total ? regions.processed / regions.total : 0)
    + .15 * (session.pointCount ? session.matchedPoints / session.pointCount : 0)
    + (session.phase === 'photos' || session.phase === 'complete' ? .2 * (unique.size ? imageDone / unique.size : 1) : 0);
  const percent = session.consent ? Math.min(100, Math.floor(ratio * 100)) : 0;
  const stage = !session.consent ? '매핑 미허용' : session.stopped ? '매핑 중단됨 · 조회 결과 유지' : session.unavailable ? '조회 중단'
    : session.phase === 'regions' ? '지역별 장소 조회 중' : session.phase === 'matching' ? '원본 포인트 대조 중'
    : session.phase === 'photos' ? '사진 조회 중' : regions.failed ? '매핑 처리 완료 · 일부 지역 조회 실패' : '매핑 완료';
  return <div ref={anchor} className="mapping-progress" onKeyDown={event => { if (event.key === 'Escape') setOpen(false); }} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button className="mapping-progress-trigger" aria-label="장소 매핑 진행 상태" aria-expanded={open} onClick={() => setOpen(true)}>
      <span role="progressbar" aria-label={stage} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`${stage} ${percent}%`}><svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="16" /><circle className="progress-value" cx="20" cy="20" r="16" pathLength="100" strokeDasharray={`${percent} 100`} /></svg><span>{percent}</span></span>
    </button>
    {open && <div className="mapping-progress-detail" style={position} role="region" aria-label="매핑 진행 세부사항"><strong>{stage}</strong><p>지역 조회 {regions.processed}/{regions.total}개 · 실패 {regions.failed}</p><p>포인트 대조 {session.matchedPoints}/{session.pointCount}개</p><p>포인트 · 장소 연결 {success} · 실패 {failure} · 후보 없음 {empty}</p><p>수집 장소 {regions.places}곳 · 묶음 {groups.length}개</p><p>사진 · 성공 {images.ready + images.loaded} · 실패 {images.error + images['load-error'] + images.unsupported + images.cancelled} · 없음 {images.missing}</p><small>사진 성공은 이미지 주소 확보 기준 · 중복 장소 제외<br />요청 {session.attempts}회 (지역 검색 {session.regionRequests} · 사진 정보 {session.mediaRequests})</small>
      {photoGroups.length > 0 && <details className="photo-places"><summary>사진이 있는 장소 {photoGroups.length}곳</summary><ul>{photoGroups.map(group => <li key={group.groupId}><button disabled={!session.mappingComplete(groups)} onClick={() => { onShowPhoto(group.representative); setOpen(false); }}>{diaryCandidate(session, group)!.name}</button></li>)}</ul></details>}
      {session.consent && !session.stopped && !session.mappingComplete(groups) && !session.unavailable && <button onClick={onStop}>추가 조회 중단</button>}

    </div>}
  </div>;
}
