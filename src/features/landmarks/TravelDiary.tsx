import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Observation } from '../../domain/timeline';
import type { ObservationGroup } from './groups';
import { LandmarkSession, startMapping } from './session';
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
      <span className="diary-card-copy"><span className="diary-number">{index + 1}</span><strong>{label}</strong><small>{formatDiaryTime(group.start, timezone)}</small><small className="place-category">{categoryLabel(candidate.categories)}</small></span>
    </button>
    {media && <a className="diary-attribution" href={media.source} target="_blank" rel="noreferrer">사진 출처{media.author ? ` · ${media.author}` : ''}{media.license ? ` · ${media.license}` : ''}</a>}
  </article>;
}
export function usePlaceMapping(groups: readonly ObservationGroup[], session: LandmarkSession) {
  useSyncExternalStore(session.subscribe, session.snapshot);
  useEffect(() => startMapping(groups, session), [groups, session, session.consent]);
}
export function MappingConsent({ session, onAllow, onDecline }: { session: LandmarkSession; onAllow: () => void; onDecline: () => void }) {
  return <div className="mapping-consent"><p>이 기록의 지점을 묶고 주변 랜드마크와 사진을 자동으로 연결할까요?</p><p>허용하면 대표 좌표·검색 조건을 Geoapify에 보냅니다. Wikimedia에는 파일명·장소 ID로 사진 정보를 요청합니다. IP·앱 출처가 전달될 수 있으며 JSON 본문·원본 파일명·시각은 보내지 않습니다.</p><p>결과는 이 파일을 연 동안만 유지합니다. 가까운 장소의 추정 정보이며 실제 방문을 확정하지 않습니다. 전체 지점을 조회하며 파일당 요청 횟수 제한은 없습니다.</p><p>원본 경로를 보면서 조회합니다. 장소·사진 처리가 모두 끝나면 ‘장소별 보기’를 선택할 수 있습니다.</p><div className="consent-actions"><button onClick={onDecline}>원본만 보기</button><button disabled={!!session.unavailable} onClick={onAllow}>허용하고 장소 매핑</button></div>{session.unavailable && <p>[{session.unavailable}] 장소 조회를 사용할 수 없습니다.</p>}</div>;
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
  const states = groups.map(group => session.state(group.groupId));
  const processed = states.filter(state => ['success', 'empty', 'error', 'cancelled'].includes(state.status)).length;
  const success = states.filter(state => state.status === 'success').length;
  const empty = states.filter(state => state.status === 'empty').length;
  const failure = states.filter(state => state.status === 'error' || state.status === 'cancelled').length;
  const unique = new Set<string>();
  const photoGroups = groups.filter(group => {
    const candidate = diaryCandidate(session, group);
    if (!candidate || unique.has(candidate.providerPlaceId)) return false;
    unique.add(candidate.providerPlaceId); return !!session.image(candidate.providerPlaceId) && session.imageStatus(candidate.providerPlaceId) !== 'load-error';
  });
  const images = session.imageSummary();
  const imageDone = Object.values(images).reduce((sum, count) => sum + count, 0) - images.loading;
  const ratio = groups.length ? .8 * processed / groups.length + (processed === groups.length ? .2 * (unique.size ? imageDone / unique.size : 1) : 0) : 0;
  const percent = session.consent ? Math.min(100, Math.floor(ratio * 100)) : 0;
  const stage = !session.consent ? '매핑 미허용' : session.stopped ? '매핑 중단됨 · 조회 결과 유지' : session.unavailable ? '조회 중단' : processed < groups.length ? '장소 조회 중' : imageDone < unique.size ? '사진 조회 중' : '매핑 완료';
  return <div ref={anchor} className="mapping-progress" onKeyDown={event => { if (event.key === 'Escape') setOpen(false); }} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button className="mapping-progress-trigger" aria-label="장소 매핑 진행 상태" aria-expanded={open} onClick={() => setOpen(true)}>
      <span role="progressbar" aria-label={stage} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`${stage} ${percent}%`}><svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="16" /><circle className="progress-value" cx="20" cy="20" r="16" pathLength="100" strokeDasharray={`${percent} 100`} /></svg><span>{percent}</span></span>
    </button>
    {open && <div className="mapping-progress-detail" style={position} role="region" aria-label="매핑 진행 세부사항"><strong>{stage}</strong><p>조회 처리 {processed}/{groups.length}개</p><p>장소 · 성공 {success} · 실패 {failure} · 없음 {empty}</p><p>사진 · 성공 {images.ready + images.loaded} · 실패 {images.error + images['load-error'] + images.unsupported + images.cancelled} · 없음 {images.missing}</p><small>사진 성공은 이미지 주소 확보 기준 · 중복 장소 제외<br />요청 {session.attempts}회 (Wikimedia {session.mediaRequests}회)</small>
      {photoGroups.length > 0 && <details className="photo-places"><summary>사진이 있는 장소 {photoGroups.length}곳</summary><ul>{photoGroups.map(group => <li key={group.groupId}><button disabled={!session.mappingComplete(groups)} onClick={() => { onShowPhoto(group.representative); setOpen(false); }}>{diaryCandidate(session, group)!.name}</button></li>)}</ul></details>}
      {session.consent && !session.stopped && !session.mappingComplete(groups) && !session.unavailable && <button onClick={onStop}>추가 조회 중단</button>}

    </div>}
  </div>;
}
