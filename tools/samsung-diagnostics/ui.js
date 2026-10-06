'use strict';
(() => {
  const picker = document.getElementById('folder'), choose = document.getElementById('choose');
  const cancel = document.getElementById('cancel'), result = document.getElementById('result');
  let worker = null, workerUrl = null;
  function stop() {
    if (worker) worker.terminate();
    if (workerUrl) URL.revokeObjectURL(workerUrl);
    worker = null; workerUrl = null; picker.value = '';
  }
  choose.addEventListener('click', () => picker.click());
  cancel.addEventListener('click', () => { stop(); result.textContent = '검사를 취소하거나 결과를 지웠습니다. 원본은 변경되지 않았습니다.'; cancel.disabled = true; });
  window.addEventListener('pagehide', stop);
  picker.addEventListener('change', () => {
    const files = Array.from(picker.files || []);
    if (!files.length) return;
    stop(); cancel.disabled = false; result.textContent = '로컬에서 검사 중입니다… 파일명과 원본 값은 표시하지 않습니다.';
    try {
      const code = 'const factory = ' + createSamsungInspector.toString() + ';onmessage = async event => {try { const api = factory(); const report = await api.inspect(event.data, progress => postMessage({progress})); postMessage({done: api.format(report)}); } catch { postMessage({failed: true}); }};';
      workerUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      const current = new Worker(workerUrl); worker = current;
      current.onmessage = event => {
        if (worker !== current) return;
        if (event.data.progress) { result.textContent = `로컬 검사 중: ${event.data.progress.inspectedFiles} / ${event.data.progress.selectedFiles}개 파일`; return; }
        result.textContent = event.data.done || '[PROCESSING_FAILED] 검사를 완료하지 못했습니다. 원본 값과 오류 원문은 표시하지 않습니다.';
        stop();
      };
      const failed = event => { event.preventDefault(); if (worker === current) { result.textContent = '[PROCESSING_FAILED] 처리 스레드를 실행하지 못했습니다. 최신 Chrome/Edge에서 다시 여세요. 원본은 변경되지 않았습니다.'; stop(); } };
      current.onerror = failed; current.onmessageerror = failed;
      current.postMessage(files);
    } catch { stop(); result.textContent = '[TOOL_UNAVAILABLE] 도구 파일이 같은 폴더에 있는지 확인하고 Chrome/Edge에서 다시 여세요.'; }
  });
})();
