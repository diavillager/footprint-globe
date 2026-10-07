import type { Observation, ObservationId } from '../../domain/timeline';
import type { QualityReport } from './locationQuality';

export function QualityEvidence({ point, report, excluded, restored, onRestore }: {
  point: Observation; report: QualityReport; excluded: ReadonlySet<ObservationId>;
  restored: ReadonlySet<ObservationId>; onRestore: (id: ObservationId) => void;
}) {
  const reason = report.suspects.get(point.id);
  if (!reason && !report.conflicts.has(point.id)) return null;
  return <div className="quality-evidence">
    {reason && <><strong>{excluded.has(point.id) ? '숨김' : restored.has(point.id) ? '개별 복원됨' : '표시 중'} · 오류 의심</strong>
      <p>{reason.reason==='moving-excursion'?'이동 중 경로 이탈·복귀':'전후 안정된 관측 사이에서 1km 이상 벗어났다가 10분 이내 복귀'} · {reason.count}개 연속 관측 · 이탈 구간 {Math.round(reason.durationMs / 1000)}초 · 진입 약 {Math.round(reason.entryKmh)}km/h · 복귀 약 {Math.round(reason.exitKmh)}km/h</p>
      {reason.reason==='moving-excursion' && <p>주변 이동 약 {Math.round(reason.surroundingKmh??0)}km/h · 경로 이탈 최소 {Math.round(reason.deviationMeters??0)}m · 직접 연결 대비 우회 약 {reason.detourRatio?.toFixed(1)}배. 전후 이동 방향과 짧은 복귀, 이탈 위치의 지속성 부족을 함께 확인했습니다.</p>}
      {reason.detailComparison && <p>{reason.detailComparison==='distant'?'같은 시간대의 상세 경로와도 1km 이상 차이가 납니다.':'같은 시간대의 상세 경로는 이 관측에서 1km 미만 거리에 있습니다.'} 상세 경로 대조는 참고 정보이며 독립적인 정답이나 추가 숨김 기준은 아닙니다.</p>}
      {reason.accuracyUsed && <p>제공된 정확도 반경을 거리·속도 근거에서 차감했습니다. 정확도는 보조 정보이며 위치 오류를 확정하지 않습니다.</p>}
      <button onClick={() => onRestore(point.id)}>{restored.has(point.id) ? '복원 취소' : '이 지점 복원'}</button></>}
    {report.conflicts.has(point.id) && <p>동일 시각의 먼 위치와 충돌합니다. 어느 쪽도 자동 숨기지 않으며 이 관측의 앞뒤 연결을 끊습니다.</p>}
    {point.accuracyMeters !== undefined && <p>원본 제공 정확도: {point.accuracyMeters}m</p>}
  </div>;
}
