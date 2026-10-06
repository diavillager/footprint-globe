import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './app/styles.css';

createRoot(document.getElementById('root')!, {
  // Do not serialize render errors or component props containing local records.
  onCaughtError: () => {},
  onRecoverableError: () => {},
  onUncaughtError: () => { document.getElementById('root')!.textContent = '[DISPLAY_UNAVAILABLE] 화면을 표시하지 못했습니다. 페이지를 다시 열어 주세요. 원본 값은 출력하지 않습니다.'; },
}).render(<StrictMode><App /></StrictMode>);
