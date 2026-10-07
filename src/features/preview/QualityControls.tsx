import { SCREENING_LABELS, type ScreeningReason } from './locationQuality';
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
    <p>실선 연결 중단 {projection.breaks.size}곳 (30분 초과 공백 {Array.from(projection.breaks.values()).filter(reason => reason === 'long-gap').length}곳 포함). 의심 지점을 숨겨도 남은 앞뒤를 새로 연결하지 않습니다.</p>
    <p>짧은 이탈·복귀와 전후 지속성, 양쪽 속도를 함께 검사합니다. 오류 확정이 아니므로 실제 이동이었다면 복원하세요. 원본 전체는 ‘위치 기록’에서 확인할 수 있습니다.</p>
    <p>숨기기·복원으로 실제 매핑 대상이 달라질 때만 장소 결과를 초기화합니다. 대상이 같으면 현재 결과와 보기를 유지합니다. 아래 버튼으로 안내를 확인하고 허용할 때만 다시 조회합니다.</p>
    <button disabled={!projection.points.length} onClick={onRemap}>현재 지점으로 장소 매핑 안내 열기</button>
    {report.screening && <details className="quality-screening"><summary>탐지되지 않은 이유 확인</summary>
      <p>인접 위치가 1km 이상 변한 이탈 시작 후보 {report.screening.candidates}건 중 탐지 {report.screening.detected}건입니다. 아래는 각 후보가 처음 충족하지 못한 조건의 집계이며, 오류 지점 수가 아닙니다. 지역명은 판정에 사용하지 않습니다.</p>
      <p>앞 조건에서 검사가 끝난 후보는 뒤 조건을 검사하지 않습니다. 뒤 조건의 0건은 충족했다는 뜻이 아닙니다.</p>
      <ul>{(Object.keys(SCREENING_LABELS) as ScreeningReason[]).map(reason => <li key={reason}>{SCREENING_LABELS[reason]}: {report.screening!.rejected[reason]}건</li>)}</ul>
      {report.patternScreening && <section aria-label="속도와 무관한 복귀 패턴 진단"><h3>속도와 무관한 복귀 패턴 진단</h3>
        <p>진단 완료 {report.patternScreening.completed}건 · 처리 한도로 미검사 {report.patternScreening.skipped}건</p>
        <ul>
          <li>이탈 전 지속성 충족: {report.patternScreening.stableBefore}건</li>
          <li>시간·거리 조건에 맞는 짧은 복귀: {report.patternScreening.shortReturn}건</li>
          <li>짧은 복귀 후 지속성 충족: {report.patternScreening.stableAfter}건</li>
          <li>전후 지속성·짧은 복귀 모두 충족하고 시각 충돌 없음: {report.patternScreening.pattern}건</li>
          <li>그중 정확도를 반영한 거리도 충족: {report.patternScreening.accuracySupported}건</li>
          <li>그중 양쪽 속도 100km/h 초과: {report.patternScreening.speed100}건</li>
          <li>그중 양쪽 속도 200km/h 초과: {report.patternScreening.speed200}건</li>
          <li>그중 양쪽 속도 300km/h 초과: {report.patternScreening.speed300}건</li>
        </ul>
        <p>각 항목은 서로 겹치므로 합산하지 않습니다. 추가 진단은 숨기기나 매핑 대상을 변경하지 않으며 100·200km/h는 비교용 수치입니다.</p>
      </section>}
      <p>1km 미만 변화는 후보에 포함하지 않습니다. 이 집계만으로 실제 위치 오류를 확정할 수 없습니다.</p>
    </details>}
    {report.suspects.size === 0 && report.conflicts.size === 0 ? <p>현재 기준으로 탐지된 의심·충돌 지점이 없습니다. 전체 관측은 상단 ‘위치 기록’에서 확인하세요.</p> : <ObservationList points={points} filter={point => report.suspects.has(point.id) || report.conflicts.has(point.id)} selectedId={null} timezone={timezone} onSelect={onSelect} quality={report} excluded={projection.excluded} restored={restored} onRestore={onRestore} />}
  </section>;
}
