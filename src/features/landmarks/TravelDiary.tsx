import { useEffect, useSyncExternalStore } from 'react';
import type { Observation } from '../../domain/timeline';
import type { ObservationGroup } from './groups';
import { LandmarkSession } from './session';
import { LandmarkPhoto } from './LandmarkPhoto';
import { formatObservationTime, type DisplayTimezone } from '../preview/observationTime';
export function diaryCandidate(session: LandmarkSession, group: ObservationGroup) {
  const state = session.state(group.groupId);
  if (state.status !== 'success') return null;
  return state.candidates[0] ?? null;
}
export function DiaryCard({ group, index, session, timezone, onSelect }: { group: ObservationGroup; index: number; session: LandmarkSession; timezone: DisplayTimezone; onSelect: (point: Observation) => void }) {
  const candidate = diaryCandidate(session, group);
  if (!candidate) return null;
  const label = candidate.name;
  return <article className="diary-card">
    <LandmarkPhoto id={candidate.providerPlaceId} session={session} />
    <button onClick={() => onSelect(group.representative)}><span className="diary-number">{index + 1}</span><strong>{label}</strong><small>{formatObservationTime(group.start, timezone)}{candidate ? ' · 추정' : ''}</small></button>

  </article>;
}
export function usePlaceMapping(groups: readonly ObservationGroup[], session: LandmarkSession) {
  useSyncExternalStore(session.subscribe, session.snapshot);
  useEffect(() => {
    let cursor = 0;
    const timer = setInterval(() => {
      if (!session.consent || session.busy || session.unavailable) return;
      while (cursor < groups.length) {
        const group = groups[cursor]!;
        if (session.state(group.groupId).status === 'idle') { void session.query(group); return; }
        const candidate = diaryCandidate(session, group);
        if (candidate && !session.hasImageAttempt(candidate.providerPlaceId)) { void session.queryImage(candidate.providerPlaceId); return; }
        cursor++;
      }
    }, 300);
    return () => clearInterval(timer);
  }, [groups, session, session.consent]);
}
export function PlaceMappingPanel({ groups, session, onShowPhoto, selectedId }: { groups: readonly ObservationGroup[]; session: LandmarkSession; onShowPhoto: (point: Observation) => void; selectedId: Observation['id'] | null }) {
  useSyncExternalStore(session.subscribe, session.snapshot);
  const seen = new Set<string>();
  const photoGroups = groups.filter(group => {
    const candidate = diaryCandidate(session, group);
    if (!candidate || !session.image(candidate.providerPlaceId) || seen.has(candidate.providerPlaceId)) return false;
    seen.add(candidate.providerPlaceId); return true;
  });
  if (!groups.length) return null;
  const images = session.imageSummary();
  const completed = groups.filter(group => ['success', 'empty', 'error'].includes(session.state(group.groupId).status)).length;
  return <div className="place-mapping" aria-label="장소 매핑 상태">
    <header><span>{groups.length.toLocaleString()}개 기록 지점</span></header>
    {!session.consent ? <div className="diary-notice"><p>가까운 기록을 자동으로 묶었습니다. 장소를 채우면 대표 좌표·검색 조건을 Geoapify로 보내고, Wikimedia Commons에 파일명으로 이미지·저작자 정보를 조회하고 사진을 불러옵니다. 파일 참조가 없으면 연결된 Wikidata 장소 ID의 대표 사진을 확인합니다. Wikimedia에는 관측 좌표·시각을 보내지 않습니다. IP·앱 출처가 전달될 수 있으며 JSON·파일명·시각은 보내지 않습니다.</p><p>현재 주변 명소를 추정 표시합니다. 실제 방문을 확정하지 않으며 결과는 이 파일을 연 동안만 유지합니다.</p><button disabled={!!session.unavailable} onClick={() => session.allow()}>동의하고 여행 장소 자동 표시</button>{session.unavailable && <p>[{session.unavailable}] 장소 조회를 사용할 수 없습니다.</p>}</div> : <div className="diary-progress"><p>{completed}/{groups.length}개 장소 조회 처리 · 요청 {session.attempts}회 (Wikimedia 메타데이터 {session.mediaRequests}회 포함)</p><p>장소 일치 {groups.filter(group => session.state(group.groupId).status === 'success').length}개 · 빈 결과 {groups.filter(group => session.state(group.groupId).status === 'empty').length}개 · 실패 {groups.filter(group => session.state(group.groupId).status === 'error').length}개</p><p className="image-summary">사진: 조회 중 {images.loading} · 표시 대기 {images.ready} · 불러오기 성공 {images.loaded} · 없음 {images.missing} · 미지원 주소 {images.unsupported} · 조회 실패 {images.error} · 로딩 실패 {images['load-error']} · 취소 {images.cancelled}</p><p>사진 집계는 중복을 제외한 대표 장소 기준입니다. 화면 밖이거나 겹쳐 숨겨진 사진은 표시 대기로 남을 수 있습니다. 불러오기 성공은 이미지 로딩 완료를 뜻합니다.</p>{photoGroups.length > 0 && <button onClick={() => { const next = (photoGroups.findIndex(group => group.representative.id === selectedId) + 1) % photoGroups.length; onShowPhoto(photoGroups[next]!.representative); }}>사진 있는 장소 보기 ({photoGroups.length}곳)</button>}{session.unavailable && <p>[{session.unavailable}] 자동 조회가 멈췄습니다. 조회하지 못한 지점은 말풍선 없이 위치만 표시합니다.</p>}<button onClick={() => session.revoke()}>자동 조회 중지·결과 지우기</button></div>}
    <footer>가까운 명소의 추정 표시 · 연결선은 기록의 흐름입니다.<br />Powered by <a href="https://www.geoapify.com/" target="_blank" rel="noreferrer">Geoapify</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a></footer>
  </div>;
}
