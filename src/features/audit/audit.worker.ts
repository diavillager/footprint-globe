import { PREVIEW_LIMITS } from '../../parser/rawPreview';
import { auditApp, createAudit, emptyAudit, type AuditReport } from './structureAudit';

// Each selection gets its own worker. Termination drops the File, parsed tree and aliases.
self.onmessage = async (event: MessageEvent<{file: File}>) => {
  let report: AuditReport=emptyAudit();
  const fail=(error: NonNullable<AuditReport['error']>) => {
    report.status='failed';report.error=error;self.postMessage(report);
  };
  try {
    const file=event.data.file;
    if (file.size>PREVIEW_LIMITS.bytes) {fail('INPUT_LIMIT');return;}
    let text:string;
    try {text=await file.text();} catch {fail('FILE_READ_FAILED');return;}
    if(new TextEncoder().encode(text).length>PREVIEW_LIMITS.bytes) {fail('INPUT_LIMIT');return;}
    let root:unknown;
    try {root=JSON.parse(text.replace(/^\uFEFF/,''));} catch {fail('INVALID_JSON');return;}
    text='';
    const scan=createAudit(root);report=scan.report;
    // Report metadata only; never post parser observations or raw values to the UI.
    report.app=auditApp(root);
    let updated=0;
    do {
      scan.step();
      if (Date.now()-updated>150 || report.status==='complete') {
        self.postMessage(report);updated=Date.now();
        await new Promise(resolve=>setTimeout(resolve,0));
      }
    } while(report.status==='scanning');
  } catch {fail('AUDIT_FAILED');}
};
