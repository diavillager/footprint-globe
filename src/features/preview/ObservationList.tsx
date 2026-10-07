import type { QualityReport } from './locationQuality';
import { QualityEvidence } from './QualityEvidence';
import { useEffect, useState } from 'react';
import type { Observation, ObservationId } from '../../domain/timeline';
import { formatObservationTime, type DisplayTimezone } from './observationTime';

const PAGE_SIZE = 20;
export function ObservationList({ points, selectedId, onSelect, timezone, quality, excluded, restored, onRestore, filter }: {
  quality?: QualityReport;
  excluded?: ReadonlySet<ObservationId>;
  restored?: ReadonlySet<ObservationId>;
  onRestore?: (id: ObservationId) => void;
  filter?: (point: Observation) => boolean;
  points: readonly Observation[];
  selectedId: ObservationId | null;
  onSelect: (point: Observation) => void;
  timezone: DisplayTimezone;
}) {
  const [page, setPage] = useState(0);
  const selected = points.find(point => point.id === selectedId);
  const visible = filter ? points.filter(filter) : points;
  useEffect(() => setPage(0), [points]);
  const lastPage = Math.max(0, Math.ceil(visible.length / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  const start = currentPage * PAGE_SIZE;
  return <section className="observation-panel" aria-label="관측 선택">
    <h2>관측을 선택하세요</h2>
    <p>시간순 목록에서 겹친 관측도 각각 선택할 수 있습니다. 번호는 목록 순서이며, 같은 좌표의 기록도 별도로 유지합니다.</p>
    <p className="note">표시 시간대만 전환합니다. 원본 시각과 관측 순서는 유지합니다.</p>
    <ol className="observation-list" start={start + 1}>
      {visible.slice(start, start + PAGE_SIZE).map(point => <li key={point.id}>
        <button aria-pressed={point.id === selectedId} onClick={() => onSelect(point)}>
          관측 {points.indexOf(point) + 1} · {formatObservationTime(point.time, timezone)}
        </button>
        <small className="source-label">{point.source==='semantic'?'Timeline 상세 경로':point.source==='gpx'?'GPX 기록':'Timeline 원시 관측'}</small>
        {quality && excluded && restored && onRestore && <QualityEvidence point={point} report={quality} excluded={excluded} restored={restored} onRestore={onRestore} />}
      </li>)}
    </ol>
    <div className="globe-tools">
      <button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>이전 관측 목록</button>
      <span>{currentPage + 1} / {lastPage + 1} 페이지 · 총 {visible.length.toLocaleString('ko-KR')}개</span>
      <button disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>다음 관측 목록</button>
      {selected && visible.includes(selected) && <button onClick={() => setPage(Math.floor(visible.indexOf(selected) / PAGE_SIZE))}>선택한 관측의 목록으로</button>}
    </div>
  </section>;
}
