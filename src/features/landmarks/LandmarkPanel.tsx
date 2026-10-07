import { useSyncExternalStore } from 'react';
import type { ObservationGroup } from './groups';
import { LandmarkSession } from './session';
import type { LandmarkError } from './geoapify';

const messages: Record<LandmarkError, string> = {
  CONFIGURATION: '랜드마크 검색 키가 설정되지 않았습니다.', AUTH: '검색 서비스의 접근 설정을 확인해야 합니다.',
  RATE_LIMIT: '검색 서비스의 사용량 제한에 도달했습니다.',
  NETWORK: '검색 서비스에 연결하지 못했습니다.', TIMEOUT: '검색 응답이 10초 안에 도착하지 않았습니다.',
  RESPONSE_INVALID: '검색 결과를 읽을 수 없습니다.', PROVIDER_FAILURE: '검색 서비스가 요청을 처리하지 못했습니다.',
};
export function LandmarkPanel({ group, session }: { group: ObservationGroup; session: LandmarkSession }) {
  useSyncExternalStore(session.subscribe, session.snapshot);
  const state = session.state(group.groupId), selected = session.selection(group.groupId);
  const cached = state.status === 'success' || state.status === 'empty';
  const unavailable = session.unavailable;
  return <div className="landmark-panel" aria-label="주변 랜드마크">
    <h4>주변 랜드마크 후보</h4>
    <p>현재 관광 명소·볼거리·박물관 정보를 300m 안에서 최대 10개 찾습니다. 가까운 순서이며 방문 여부·당시 존재 여부를 뜻하지 않습니다. 기념비·예술품·계절 행사가 포함될 수 있습니다.</p>
    {!session.consent ? <p>여행일지 안내에서 동의하면 장소를 자동으로 표시합니다.</p> : <>
      {state.status === 'loading' && <p role="status">주변 장소를 자동 조회하는 중입니다…</p>}
      {state.status === 'cancelled' && <p role="status">조회가 취소되었습니다.</p>}
      {state.status === 'empty' && <p role="status">표시할 수 있는 주변 후보가 없습니다.</p>}
      {state.status === 'success' && <>
        <ul className="landmark-candidates">{state.candidates.map(candidate => <li key={candidate.providerPlaceId}>
          <button aria-pressed={selected === candidate.providerPlaceId} onClick={() => session.select(group.groupId, selected === candidate.providerPlaceId ? null : candidate.providerPlaceId)}>
            <strong>{candidate.name}</strong><span>{Math.round(candidate.distanceMeters)}m · {candidate.categories.join(', ') || '종류 정보 없음'}</span>
          </button>
        </li>)}</ul>
        {selected && <><p>후보를 선택했습니다. 방문 확정·저장은 하지 않습니다.</p><button onClick={() => session.select(group.groupId, null)}>후보 선택 해제</button></>}
        <p>이 파일에서 조회한 결과를 재사용합니다.</p>
      </>}
      <button className="revoke-consent" onClick={() => session.revoke()}>조회 동의 철회·결과 지우기</button>
    </>}
    {(state.status === 'error' || (!cached && unavailable)) && <p role="alert">[{state.status === 'error' ? state.code : unavailable}] {messages[state.status === 'error' ? state.code : unavailable!]}</p>}
    <p className="landmark-budget">조회 {session.attempts}회 · 실패·취소 포함 · 자동 재시도 없음</p>
    <p className="landmark-attribution">Powered by <a href="https://www.geoapify.com/" target="_blank" rel="noreferrer">Geoapify</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a></p>
  </div>;
}
