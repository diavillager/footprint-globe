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
    if (typeof TimelineSample === 'undefined') {
      status.textContent = '생성 중단 [TOOL_NOT_LOADED]: 변환 도구 파일을 불러오지 못했습니다. index.html, sanitizer.js, ui.js를 같은 폴더에 두고 Chrome 또는 Edge에서 index.html을 다시 여세요. 원본은 읽지 않았습니다.';
      return;
    }
    if (file.size > TimelineSample.LIMITS.inputBytes) {
      const size = (file.size / 1024 / 1024).toFixed(1);
      const limit = (TimelineSample.LIMITS.inputBytes / 1024 / 1024).toFixed(0);
      status.textContent = `생성 중단 [FILE_TOO_LARGE]: 파일 크기 ${size} MiB가 현재 제한 ${limit} MiB를 초과했습니다. 원본은 읽지 않았습니다. 파일을 직접 편집하거나 업로드하지 말고 이 오류 코드와 크기만 알려 주세요.`;
      return;
    }
    status.textContent = '로컬 파일을 읽는 중입니다.';
    let input;
    try {
      input = await file.text();
    } catch {
      if (current === generation) status.textContent = '생성 중단 [FILE_READ_FAILED]: 브라우저가 선택한 파일을 읽지 못했습니다. 클라우드 전용 파일이면 로컬 다운로드를 완료하고 다시 선택하세요. 파일명과 오류 원문은 표시하지 않습니다.';
      return;
    }
    if (current !== generation) return;
    status.textContent = '로컬에서 샘플을 생성하는 중입니다.';
    try {
      const result = TimelineSample.sanitizeText(input);
      if (current !== generation) return;
      status.textContent = (result.ok ? '생성 완료 — 가상 샘플을 저장할 수 있습니다.\n\n' : '생성 중단 — 저장할 샘플이 없습니다.\n\n') + TimelineSample.formatReport(result.report);
      if (result.ok) { sample = result.text; save.disabled = false; }
    } catch {
      if (current === generation) status.textContent = '생성 중단 [PROCESSING_FAILED]: 파일 읽기는 완료했지만 샘플 처리 중 문제가 발생했습니다. 이 오류 코드만 알려 주세요. 원본 값과 오류 원문은 표시하지 않습니다.';
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
