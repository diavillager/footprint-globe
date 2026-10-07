import { useMemo, useState } from 'react';
import type { Observation } from '../../domain/timeline';
import { summarizeImportDays, selectImportDays } from './importDates';
import { formatObservationTime, type DisplayTimezone } from './observationTime';

export interface ImportPeriod { start:string; end:string; timezone:DisplayTimezone }
const monthOffset=(month:string,delta:number)=>{const date=new Date(month+'-01T00:00:00Z');date.setUTCMonth(date.getUTCMonth()+delta);return date.toISOString().slice(0,7);};
export function ImportCalendar({points,initialTimezone,onNext}:{points:readonly Observation[];initialTimezone:DisplayTimezone;onNext:(period:ImportPeriod)=>void}) {
  const [timezone,setTimezone]=useState(initialTimezone);
  const days=useMemo(()=>summarizeImportDays(points,timezone),[points,timezone]);
  const [start,setStart]=useState(''),[end,setEnd]=useState('');
  const [month,setMonth]=useState(()=>days.first!.slice(0,7));
  const selected=useMemo(()=>selectImportDays(points,timezone,start,end),[points,timezone,start,end]);
  const changeZone=(zone:DisplayTimezone)=>{setTimezone(zone);setStart('');setEnd('');setMonth(summarizeImportDays(points,zone).first!.slice(0,7));};
  const choose=(day:string)=>{if(!start||end) {setStart(day);setEnd('');} else if(day<start) {setEnd(start);setStart(day);} else setEnd(day);};
  const firstDay=new Date(month+'-01T00:00:00Z').getUTCDay();
  const dayCount=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).getUTCDate();
  return <section className="import-calendar">
    <p>전체 유효 기록 범위<br/><strong>{formatObservationTime(points[0]!.time,timezone)} ~ {formatObservationTime(points.at(-1)!.time,timezone)}</strong></p>
    <p>기록 {points.length.toLocaleString()}개 · 기록이 있는 날 {days.days.length}일. 날짜별로 나누어 등록하며 날짜 사이를 연결하지 않습니다.</p>
    <div className="timezone-switch" role="group" aria-label="등록 날짜 기준"><button aria-pressed={timezone==='UTC'} onClick={()=>changeZone('UTC')}>UTC 기준</button><button aria-pressed={timezone==='Asia/Seoul'} onClick={()=>changeZone('Asia/Seoul')}>KST 기준</button></div>
    <div className="calendar-heading"><button aria-label="이전 달" disabled={month<=days.first!.slice(0,7)} onClick={()=>setMonth(monthOffset(month,-1))}>‹</button><label>표시 월 <input type="month" value={month} min={days.first!.slice(0,7)} max={days.last!.slice(0,7)} onChange={e=>{const value=e.target.value;if(/^\d{4}-\d{2}$/.test(value) && value>=days.first!.slice(0,7) && value<=days.last!.slice(0,7)) setMonth(value);}}/></label><button aria-label="다음 달" disabled={month>=days.last!.slice(0,7)} onClick={()=>setMonth(monthOffset(month,1))}>›</button></div>
    <p className="calendar-help">시작일과 종료일을 차례로 선택하세요. 하루는 같은 날짜를 두 번 선택합니다.</p>
    <div className="calendar-grid" role="group" aria-label="기간 선택 달력">
      {['일','월','화','수','목','금','토'].map(day=><span key={day} className="weekday">{day}</span>)}
      {Array.from({length:firstDay},(_,i)=><span key={'space'+i}/>)}
      {Array.from({length:dayCount},(_,i)=>{const day=`${month}-${String(i+1).padStart(2,'0')}`,count=days.counts.get(day)??0;return <button key={day} disabled={day<days.first!||day>days.last!} aria-label={`${day} · 기록 ${count}개`} aria-pressed={day===start||day===end} className={start && end && day>=start&&day<=end?'in-range':''} onClick={()=>choose(day)}><span>{i+1}</span><small>{count?count.toLocaleString():'—'}</small></button>;})}
    </div>
    <div className="date-inputs"><label>시작일<input type="date" value={start} min={days.first!} max={days.last!} onChange={e=>setStart(e.target.value)}/></label><label>종료일<input type="date" value={end} min={start||days.first!} max={days.last!} onChange={e=>setEnd(e.target.value)}/></label><button onClick={()=>{setStart(days.first!);setEnd(days.last!);}}>전체 기간</button></div>
    <p role="status">{start&&end?`${start} ~ ${end} · 선택 기록 ${selected.points.length.toLocaleString()}개`:'기간을 선택해 주세요.'}</p>
    <button className="import-next" disabled={!selected.points.length||start<days.first!||end>days.last!} onClick={()=>onNext({start,end,timezone})}>이 기간으로 계속</button>
  </section>;
}
