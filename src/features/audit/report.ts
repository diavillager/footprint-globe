import { formatAuditReport, type AuditReport } from './structureAudit';
import { formatGpxReport, type GpxReport } from './gpxAudit';

export type LocalAuditReport = AuditReport | GpxReport;
export const isGpxReport = (report:LocalAuditReport):report is GpxReport => 'format' in report && report.format==='gpx';
export const formatLocalReport = (report:LocalAuditReport) => isGpxReport(report)?formatGpxReport(report):formatAuditReport(report);
export const reportFileName = (report:LocalAuditReport) => isGpxReport(report)?'gpx-structure-report.txt':'timeline-structure-report.txt';
