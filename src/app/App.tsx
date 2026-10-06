import { createSyntheticTimeline } from '../fixtures/timeline';

const demo = createSyntheticTimeline();

export function App() {
  return <main>
    <p className="eyebrow">FOOTPRINT GLOBE</p>
    <h1>여행의 기록을 담을 공간</h1>
    <p>지구본에서 위치 기록을 살펴보고, 직접 지정한 방문에 사진을 연결하는 앱을 준비하고 있습니다.</p>
    <section aria-labelledby="status-title">
      <h2 id="status-title">개발 준비 화면</h2>
      <p>현재는 공통 개발 환경만 준비되어 있습니다. 파일 읽기, 지구본, 방문 지정과 사진 첨부는 아직 제공하지 않습니다.</p>
      <dl><dt>완전 합성 위치 기록</dt><dd>{demo.observations.length}개</dd>
        <dt>기록된 경로</dt><dd>{demo.recordedPaths.length}개</dd></dl>
      <p className="note">표시된 건수는 개발용 가상 데이터입니다. 실제 파일을 읽거나 저장하지 않습니다.</p>
    </section>
  </main>;
}
