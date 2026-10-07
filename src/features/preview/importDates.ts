import type { Observation, ObservationId } from '../../domain/timeline';
import { formatObservationTime, type DisplayTimezone } from './observationTime';

/** Explicit timezone argument: import-day membership must not depend on the browser locale. */
export const observationDay = (point:Observation, timezone:DisplayTimezone) => formatObservationTime(point.time,timezone).slice(0,10);

export function summarizeImportDays(points:readonly Observation[], timezone:DisplayTimezone) {
  const counts=new Map<string,number>();
  for(const point of points) {
    const day=observationDay(point,timezone);
    counts.set(day,(counts.get(day)??0)+1);
  }
  const days=[...counts.keys()].sort();
  return {counts,days,first:days[0]??null,last:days.at(-1)??null};
}

export function selectImportDays(points:readonly Observation[], timezone:DisplayTimezone, start:string, end:string) {
  const selected:Observation[]=[],dayBreaks=new Set<ObservationId>();
  const validDay=(day:string)=>/^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day+'T00:00:00Z')) && new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day;
  if(!validDay(start)||!validDay(end)||start>end) return {points:selected,dayBreaks};
  let previousDay:string|undefined;
  for(const point of points) {
    const day=observationDay(point,timezone);
    if(day<start||day>end) continue;
    if(previousDay!==undefined && previousDay!==day) dayBreaks.add(point.id);
    selected.push(point);previousDay=day;
  }
  return {points:selected,dayBreaks};
}
