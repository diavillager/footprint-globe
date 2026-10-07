// Local verification entry only. The production build uses /index.html, never this page.
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LocalPreview } from '../../src/features/preview/LocalPreview';
import { buildTrip, trips } from '../../src/fixtures/travel';
import '../../src/app/styles.css';

function SyntheticCheck() {
  const [trip, setTrip] = useState(trips[0]!.id);
  const load = () => {
    const input = document.querySelector<HTMLInputElement>('input[type=file]');
    if (!input) return;
    const transfer = new DataTransfer();
    transfer.items.add(new File([JSON.stringify(buildTrip(trip).timeline)], 'fully-synthetic.json', { type: 'application/json' }));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  return <><LocalPreview /><aside style={{ position: 'fixed', bottom: 40, left: 10, zIndex: 10, padding: 10, borderRadius: 10, background: '#fff', color: '#19313c', fontSize: 12 }}>
    <strong>로컬 합성 검증 전용</strong><br />
    <label>가상 여행 <select aria-label="가상 여행" value={trip} onChange={event => setTrip(event.target.value as typeof trip)}>{trips.map(item => <option key={item.id} value={item.id}>{item.id}</option>)}</select></label>
    <button onClick={load}>합성 기록 불러오기</button>
    <p style={{ margin: 0 }}>원본 파일을 읽지 않습니다. 지도·후보 실제 조회는 계정 사용량을 소비합니다.</p>
  </aside></>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><SyntheticCheck /></StrictMode>);
