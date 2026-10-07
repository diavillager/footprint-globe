import { emptyAudit, formatAuditReport, type AuditReport } from '../../src/features/audit/structureAudit';
import { PREVIEW_LIMITS } from '../../src/parser/rawPreview';
import './style.css';

const input=document.querySelector<HTMLInputElement>('#source')!;
const cancel=document.querySelector<HTMLButtonElement>('#cancel')!;
const clear=document.querySelector<HTMLButtonElement>('#clear')!;
const save=document.querySelector<HTMLButtonElement>('#save')!;
const status=document.querySelector<HTMLElement>('#status')!;
const reportBox=document.querySelector<HTMLTextAreaElement>('#report')!;
let current: Worker | null=null, report: AuditReport | null=null;
const stop=()=>{current?.terminate();current=null;cancel.disabled=true;};
const render=()=>{
  if(!report) {reportBox.value='';save.disabled=true;status.textContent='검사할 JSON을 선택하세요.';return;}
  reportBox.value=formatAuditReport(report);
  save.disabled=report.status==='scanning';
  status.textContent=report.status==='complete' ? '전체 항목 탐색 완료 · 아래 보고서의 앱 채택 범위와 미확정 영역을 확인하세요.'
    : report.status==='scanning' ? `검사 중 · ${report.visited.toLocaleString('ko-KR')}개 항목 확인 (전체 건수 미확정)`
    : report.status==='cancelled' ? '검사 취소 · 미완료 보고서입니다.' : `검사 중단 [${report.error}] · 미완료 보고서입니다.`;
};
input.addEventListener('change',()=>{
  const file=input.files?.[0];input.value='';
  if(!file) return;
  stop();report=emptyAudit();render();
  if(file.size>PREVIEW_LIMITS.bytes) {report.status='failed';report.error='INPUT_LIMIT';render();return;}
  try {
    const worker=new Worker(new URL('../../src/features/audit/audit.worker.ts',import.meta.url),{type:'module'});
    current=worker;cancel.disabled=false;
    worker.onmessage=(event:MessageEvent<AuditReport>)=>{
      if(current!==worker) return;
      report=event.data;render();
      if(report.status!=='scanning') stop();
    };
    const failed=()=>{
      if(current!==worker) return;
      stop();report ??=emptyAudit();report.status='failed';report.error='AUDIT_FAILED';render();
    };
    worker.onerror=event=>{event.preventDefault();failed();};worker.onmessageerror=failed;
    worker.postMessage({file});
  } catch {stop();report!.status='failed';report!.error='AUDIT_FAILED';render();}
});
cancel.addEventListener('click',()=>{stop();if(report) report.status='cancelled';render();});
clear.addEventListener('click',()=>{stop();report=null;render();});
save.addEventListener('click',()=>{
  if(!report || report.status==='scanning') return;
  const url=URL.createObjectURL(new Blob([formatAuditReport(report)],{type:'text/plain;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download='timeline-structure-report.txt';link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
});
window.addEventListener('pagehide',stop);
