import { categoryLabel } from './categories';
import { LandmarkPhoto } from './LandmarkPhoto';
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
  const candidate = state.status === 'success' ? state.candidates.find(item => item.providerPlaceId === selected) ?? state.candidates[0] : undefined;
  const photoStatus = candidate ? session.imageStatus(candidate.providerPlaceId) : undefined;
  return <div className="landmark-panel" aria-label="주변 랜드마크">
    {state.status === 'success' && candidate && <div className="place-browser">
      <aside className="place-list" aria-label="주변 장소 목록">
        <h4>주변 랜드마크 후보</h4>
        <ul className="landmark-candidates">{state.candidates.map(item => <li key={item.providerPlaceId}>
          <button aria-pressed={candidate.providerPlaceId === item.providerPlaceId} onClick={() => session.select(group.groupId, item.providerPlaceId)}>
            <strong>{item.name}</strong><span>{categoryLabel(item.categories)}</span><span>기록 지점에서 {Math.round(item.distanceMeters)}m</span>
          </button>
        </li>)}</ul>
      </aside>
      <div className="place-details" role="region" aria-label="선택한 장소 상세">
        <h3>{candidate.name}</h3>
        <p className="place-category">{categoryLabel(candidate.categories)}</p>
        {session.image(candidate.providerPlaceId) && photoStatus !== 'load-error' ? <LandmarkPhoto key={candidate.providerPlaceId} id={candidate.providerPlaceId} session={session} eager /> : <div className="place-photo-empty">{photoStatus === undefined ? '이 장소의 사진은 아직 조회되지 않았습니다.' : photoStatus === 'loading' ? '사진을 조회하고 있습니다…' : '표시할 사진이 없습니다.'}</div>}
        <dl><dt>기록 지점과 거리</dt><dd>{Math.round(candidate.distanceMeters)}m</dd><dt>장소 위치</dt><dd>{candidate.coordinate.latitude.toFixed(5)}, {candidate.coordinate.longitude.toFixed(5)}</dd></dl>
        <p>지도 말풍선은 기록 위치에 표시됩니다. 위 장소 위치와 다를 수 있습니다. 기록 지점 주변에서 찾은 장소입니다. 실제 방문 여부와 당시 존재 여부를 뜻하지 않습니다.</p>
      </div>
    </div>}
    {state.status === 'loading' && <p role="status">주변 장소를 조회하는 중입니다…</p>}
    {state.status === 'empty' && <p role="status">주변 장소를 찾지 못했습니다.</p>}
    {state.status === 'cancelled' && <p role="status">조회가 취소되었습니다.</p>}
    {(state.status === 'error' || (!cached && unavailable)) && <p role="alert">[{state.status === 'error' ? state.code : unavailable}] {messages[state.status === 'error' ? state.code : unavailable!]}</p>}
    <p className="landmark-attribution">Powered by <a href="https://www.geoapify.com/" target="_blank" rel="noreferrer">Geoapify</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a></p>
  </div>;
}
