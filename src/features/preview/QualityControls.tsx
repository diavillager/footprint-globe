import type { Observation, ObservationId } from '../../domain/timeline';
import type { QualityReport, projectLocations } from './locationQuality';
import { ObservationList } from './ObservationList';
import type { DisplayTimezone } from './observationTime';

export function QualityControls({ points, report, projection, restored, timezone, onRestore, onSelect, onRemap }: {
  points: readonly Observation[]; report: QualityReport; projection: ReturnType<typeof projectLocations>;
  restored: ReadonlySet<ObservationId>; timezone: DisplayTimezone; onRestore: (id: ObservationId) => void;
  onSelect: (point: Observation) => void; onRemap: () => void;
}) {
  return <section>
    <p>원본 {points.length}개 · 오류 의심 {report.suspects.size}개 · 숨김 {projection.excluded.size}개 · 개별 복원 {restored.size}개 · 시각 충돌 {report.conflicts.size}개</p>
    <p>연결 중단 {projection.breaks.size}곳 (30분 초과 공백 {Array.from(projection.breaks.values()).filter(reason => reason === 'long-gap').length}곳 포함). 의심 지점을 숨겨도 남은 앞뒤를 새로 연결하지 않습니다.</p>
    <p>짧은 이탈·복귀와 전후 지속성, 양쪽 속도를 함께 검사합니다. 오류 확정이 아니므로 실제 이동이었다면 복원하세요. 원본 전체는 ‘위치 기록’에서 확인할 수 있습니다.</p>
    <p>숨기기·복원을 변경하면 장소 결과를 초기화합니다. 아래 버튼으로 안내를 확인하고 허용할 때만 다시 조회합니다.</p>
    <button disabled={!projection.points.length} onClick={onRemap}>현재 지점으로 장소 매핑 안내 열기</button>
    <ObservationList points={points} filter={point => report.suspects.has(point.id) || report.conflicts.has(point.id)} selectedId={null} timezone={timezone} onSelect={onSelect} quality={report} excluded={projection.excluded} restored={restored} onRestore={onRestore} />
  </section>;
}
