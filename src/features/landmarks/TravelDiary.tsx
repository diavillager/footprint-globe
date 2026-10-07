import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Observation } from '../../domain/timeline';
import type { ObservationGroup } from './groups';
import { LandmarkSession } from './session';
import { formatObservationTime, type DisplayTimezone } from '../preview/observationTime';
export function diaryCandidate(session: LandmarkSession, group: ObservationGroup) {
  const state = session.state(group.groupId);
  if (state.status !== 'success') return null;
  return state.candidates.find(item => item.providerPlaceId === session.selection(group.groupId)) ?? state.candidates[0] ?? null;
}
export function DiaryCard({ group, index, session, timezone, onSelect }: { group: ObservationGroup; index: number; session: LandmarkSession; timezone: DisplayTimezone; onSelect: (point: Observation) => void }) {
  const candidate = diaryCandidate(session, group), state = session.state(group.groupId);
  const media = candidate ? session.image(candidate.providerPlaceId) : null;
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [media?.url]);
  const label = candidate?.name ?? (state.status === 'loading' ? '장소를 찾는 중…' : state.status === 'empty' ? '주변 명소 정보 없음' : state.status === 'error' ? '장소 조회 실패' : '기록 지점');
  return <article className="diary-card">
    {media && !failed && <img src={media.url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />}
    <button onClick={() => onSelect(group.representative)}><span className="diary-number">{index + 1}</span><strong>{label}</strong><small>{formatObservationTime(group.start, timezone)}{candidate ? ' · 추정' : ''}</small></button>
    {media && !failed && <a href={media.source} target="_blank" rel="noreferrer">사진 출처·이용 조건</a>}
  </article>;
}
export function TravelDiary({ groups, session, timezone, onSelect }: { groups: readonly ObservationGroup[]; session: LandmarkSession; timezone: DisplayTimezone; onSelect: (point: Observation) => void }) {
  useSyncExternalStore(session.subscribe, session.snapshot);
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [session]);
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
  if (!groups.length) return null;
  const completed = groups.filter(group => ['success', 'empty', 'error'].includes(session.state(group.groupId).status)).length;
  return <aside className="travel-diary" aria-label="여행일지">
    <header><h2>나의 여행 흐름</h2><span>{groups.length.toLocaleString()}개 기록 지점</span></header>
    {!session.consent ? <div className="diary-notice"><p>가까운 기록을 자동으로 묶었습니다. 장소를 채우면 대표 좌표·검색 조건을 Geoapify로 보내고, 사진이 있는 경우 Wikimedia에서 불러옵니다. IP·앱 출처가 전달될 수 있으며 JSON·파일명·시각은 보내지 않습니다.</p><p>현재 주변 명소를 추정 표시합니다. 실제 방문을 확정하지 않으며 결과는 이 파일을 연 동안만 유지합니다.</p><button disabled={!!session.unavailable} onClick={() => session.allow()}>동의하고 여행 장소 자동 표시</button>{session.unavailable && <p>[{session.unavailable}] 장소 조회를 사용할 수 없습니다.</p>}</div> : <div className="diary-progress"><p>{completed}/{groups.length}개 장소 조회 · 요청 {session.attempts}회 (사진 상세 포함)</p>{session.unavailable && <p>[{session.unavailable}] 자동 조회가 멈췄습니다. 조회하지 못한 기록은 이름 없이 표시합니다.</p>}<button onClick={() => session.revoke()}>자동 조회 중지·결과 지우기</button></div>}
    <ol className="diary-flow">{groups.slice(page * 32, (page + 1) * 32).map((group, index) => <li key={group.groupId}><DiaryCard group={group} index={page * 32 + index} session={session} timezone={timezone} onSelect={onSelect} /></li>)}</ol>
    {groups.length > 32 && <nav aria-label="여행일지 페이지"><button disabled={!page} onClick={() => setPage(value => value - 1)}>이전</button><span>{page + 1}/{Math.ceil(groups.length / 32)}</span><button disabled={(page + 1) * 32 >= groups.length} onClick={() => setPage(value => value + 1)}>다음</button></nav>}
    <footer>가까운 명소의 추정 표시 · 연결선은 기록의 흐름입니다.<br />Powered by <a href="https://www.geoapify.com/" target="_blank" rel="noreferrer">Geoapify</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a></footer>
  </aside>;
}
