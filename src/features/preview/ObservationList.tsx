import { useEffect, useState } from 'react';
import type { Observation, ObservationId } from '../../domain/timeline';
import { formatObservationTime, type DisplayTimezone } from './observationTime';

const PAGE_SIZE = 20;
export function ObservationList({ points, candidates, selectedId, onSelect, onShowAll }: {
  points: readonly Observation[];
  candidates: readonly Observation[] | null;
  selectedId: ObservationId | null;
  onSelect: (point: Observation) => void;
  onShowAll: () => void;
}) {
  const [page, setPage] = useState(0);
  const [timezone, setTimezone] = useState<DisplayTimezone>('UTC');
  const selected = points.find(point => point.id === selectedId);
  const visible = candidates ?? points;
  useEffect(() => setPage(0), [candidates, points]);
  const lastPage = Math.max(0, Math.ceil(visible.length / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  const start = currentPage * PAGE_SIZE;
  return <section className="observation-panel" aria-label="관측 선택">
    <h2>관측을 선택하세요</h2>
    <p>시간순 목록에서 겹친 관측도 각각 선택할 수 있습니다. 번호는 목록 순서이며, 같은 좌표의 기록도 별도로 유지합니다.</p>
    {candidates && <p aria-live="polite">클릭 위치의 관측 {candidates.length}개 <button onClick={onShowAll}>전체 관측 목록</button></p>}
    <fieldset><legend>날짜·시각 표시 기준</legend>
      <label><input type="radio" name="timezone" checked={timezone === 'UTC'} onChange={() => setTimezone('UTC')} />UTC</label>
      <label><input type="radio" name="timezone" checked={timezone === 'Asia/Seoul'} onChange={() => setTimezone('Asia/Seoul')} />한국 시간 (UTC+09:00)</label>
    </fieldset>
    <p className="note">표시 시간대만 전환합니다. 원본 시각과 관측 순서는 유지합니다.</p>
    <ol className="observation-list" start={start + 1}>
      {visible.slice(start, start + PAGE_SIZE).map(point => <li key={point.id}>
        <button aria-pressed={point.id === selectedId} onClick={() => onSelect(point)}>
          관측 {points.indexOf(point) + 1} · {formatObservationTime(point.time, timezone)}
        </button>
      </li>)}
    </ol>
    <div className="globe-tools">
      <button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>이전 관측 목록</button>
      <span>{currentPage + 1} / {lastPage + 1} 페이지 · 총 {visible.length.toLocaleString('ko-KR')}개</span>
      <button disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>다음 관측 목록</button>
      {selected && visible.includes(selected) && <button onClick={() => setPage(Math.floor(visible.indexOf(selected) / PAGE_SIZE))}>선택한 관측의 목록으로</button>}
    </div>
    {selected && <div aria-live="polite" className="observation-detail">
      <h3>선택한 관측 {points.indexOf(selected) + 1}</h3>
      <p>{formatObservationTime(selected.time, timezone)}</p>
      <p>위도 {selected.coordinate.latitude} · 경도 {selected.coordinate.longitude}</p>
      <p>이 관측의 위치로 이동했습니다. 관측 선택만으로 방문을 생성하지 않습니다.</p>
    </div>}
  </section>;
}
