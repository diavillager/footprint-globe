import { PREVIEW_LIMITS } from '../../parser/rawPreview';
import { auditApp, createAudit, emptyAudit } from './structureAudit';
import { createGpxAudit, emptyGpxAudit } from './gpxAudit';
import type { LocalAuditReport } from './report';

// Each selection gets its own worker. Termination drops the File, parsed tree and aliases.
self.onmessage = async (event: MessageEvent<{file: File}>) => {
  let report: LocalAuditReport=/\.(gpx|xml)$/i.test(event.data.file.name)?emptyGpxAudit():emptyAudit();
  const fail=(error: NonNullable<LocalAuditReport['error']>) => {
    report.status='failed';report.error=error;self.postMessage(report);
  };
  try {
    const file=event.data.file;
    if (file.size>PREVIEW_LIMITS.bytes) {fail('INPUT_LIMIT');return;}
    let text:string;
    try {text=await file.text();} catch {fail('FILE_READ_FAILED');return;}
    if(new TextEncoder().encode(text).length>PREVIEW_LIMITS.bytes) {fail('INPUT_LIMIT');return;}
    if('format' in report || /^\s*</.test(text.replace(/^\uFEFF/,''))) {
      const scan=createGpxAudit();report=scan.report;
      // File.text replaces malformed bytes. GPX requires strict UTF-8 instead.
      let bytes:ArrayBuffer;
      try {bytes=await file.arrayBuffer();} catch {fail('FILE_READ_FAILED');return;}
      try {text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
      catch {fail('UNSUPPORTED_ENCODING');return;}
      if(text.includes('\u0000')) {fail('UNSUPPORTED_ENCODING');return;}
      let offset=0,updated=0;
      do {
        const end=Math.min(offset+65536,text.length);
        scan.write(text.slice(offset,end),end===text.length);offset=end;
        if(Date.now()-updated>150 || report.status!=='scanning') {
          self.postMessage(report);updated=Date.now();
          await new Promise(resolve=>setTimeout(resolve,0));
        }
      } while(report.status==='scanning');
      text='';return;
    }
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
