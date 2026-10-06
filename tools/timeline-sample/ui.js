'use strict';
(() => {
  const source = document.getElementById('source');
  const save = document.getElementById('save');
  const status = document.getElementById('status');
  let sample = null;
  let generation = 0;
  source.addEventListener('change', async () => {
    const current = ++generation;
    sample = null;
    save.disabled = true;
    const file = source.files[0];
    source.value = ''; // Do not retain or display the original filename.
    if (!file) { status.textContent = '파일 선택이 취소되었습니다.'; return; }
    status.textContent = '로컬에서 처리 중입니다.';
    try {
      if (file.size > TimelineSample.LIMITS.inputBytes) throw new Error('INPUT_LIMIT');
      const result = TimelineSample.sanitizeText(await file.text());
      if (current !== generation) return;
      status.textContent = (result.ok ? '생성 완료 — 가상 샘플을 저장할 수 있습니다.\n\n' : '생성 중단 — 저장할 샘플이 없습니다.\n\n') + TimelineSample.formatReport(result.report);
      if (result.ok) { sample = result.text; save.disabled = false; }
    } catch {
      if (current === generation) status.textContent = '생성 중단: 파일을 읽을 수 없거나 입력 크기 제한을 초과했습니다. 원본 값은 표시하지 않습니다.';
    }
  });
  save.addEventListener('click', () => {
    if (sample === null) return;
    const url = URL.createObjectURL(new Blob([sample], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'timeline.synthetic.sample.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
})();
