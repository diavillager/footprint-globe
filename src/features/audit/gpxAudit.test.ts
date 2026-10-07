import { describe, expect, it } from 'vitest';
import { createGpxAudit, formatGpxReport } from './gpxAudit';
import { formatLocalReport, reportFileName } from './report';
import { emptyAudit } from './structureAudit';

const ns='http://www.topografix.com/GPX/1/1';
const wrap=(body:string,version='1.1')=>`<gpx xmlns="http://www.topografix.com/GPX/1/${version==='1.0'?'0':'1'}" version="${version}" creator="PRIVATE_CREATOR">${body}</gpx>`;
const stamp=(seconds:number)=>new Date(Date.UTC(2040,0,1)+seconds*1000).toISOString();
const point=(seconds:number,extra='',kind='trkpt')=>`<${kind} lat="0" lon="0"><time>${stamp(seconds)}</time>${extra}</${kind}>`;
const track=(body:string)=>`<trk><trkseg>${body}</trkseg></trk>`;
const scan=(xml:string,chunk=65536)=>{
  const audit=createGpxAudit();
  for(let offset=0;offset<xml.length && audit.report.status==='scanning';offset+=chunk) audit.write(xml.slice(offset,offset+chunk),offset+chunk>=xml.length);
  if(!xml.length) audit.write('',true);
  return audit.report;
};

describe('GPX offline structural diagnosis',()=>{
  it('distinguishes track, route, waypoint and segment boundaries',()=>{
    const report=scan(wrap(track(point(0)+point(1))+track(point(7200))+`<trk><trkseg/></trk><rte>${point(0,'','rtept')+point(2,'','rtept')}</rte>`+point(0,'','wpt')));
    expect(report.status).toBe('complete');expect(report.supported).toBe(true);
    expect([report.tracks,report.segments,report.routes,report.emptySegments]).toEqual([3,3,1,1]);
    expect([report.points.trkpt.total,report.points.rtept.total,report.points.wpt.total]).toEqual([3,2,1]);
    expect(report.points.trkpt.comparable).toBe(3);
    expect(report.positiveIntervals).toBe(2);expect(report.gapsOver30Minutes).toBe(0);
    expect(report.intervals).toEqual([1,1,0,0,0,0]);
  });
  it('supports 1.0 and namespace prefixes without relying on prefix spelling',()=>{
    const old=scan(wrap(track(point(0,'<speed>2.1</speed>')),'1.0'),1);
    expect(old.gpxVersion).toBe('1.0');expect(old.quality.speed.valid).toBe(1);
    const prefixed=scan(`<p:gpx xmlns:p="${ns}" version="1.1"><p:trk><p:trkseg><p:trkpt lat="0" lon="0"><p:time>${stamp(0)}</p:time></p:trkpt></p:trkseg></p:trk></p:gpx>`,7);
    expect(prefixed.points.trkpt.comparable).toBe(1);
    expect(prefixed.paths.some(p=>p.path.includes('p:'))).toBe(false);
  });
  it('does not interpret other XML, missing namespaces or version mismatches as GPX records',()=>{
    for(const xml of ['<gpx version="1.1"><wpt lat="0" lon="0"/></gpx>',`<gpx xmlns="${ns}" version="1.0"><wpt lat="0" lon="0"/></gpx>`,'<kml><trkpt/></kml>']) {
      const r=scan(xml);expect(r.status).toBe('complete');expect(r.supported).toBe(false);expect(r.points.wpt.total).toBe(0);
      expect(formatGpxReport(r)).toContain('0건을 실제 기록 없음으로 해석하지 마세요');
    }
  });
  it('counts missing, invalid and zero coordinates independently',()=>{
    const r=scan(wrap(track('<trkpt lat="0" lon="0"/><trkpt lon="0"/><trkpt lat="" lon="0"/><trkpt lat="91" lon="0"/><trkpt lat="0" lon="180"/><trkpt lat="-90" lon="-180"/>')));
    expect([r.points.trkpt.coordinatesValid,r.points.trkpt.coordinatesMissing,r.points.trkpt.coordinatesInvalid]).toEqual([2,1,3]);
  });
  it('separates absent, invalid, timezone-free and duplicate time elements',()=>{
    const body=['','<time>invalid</time>','<time>2040-01-01T00:00:00</time>',`<time>${stamp(0)}</time><time>${stamp(1)}</time>`,'<time>2040-02-30T00:00:00Z</time>'].map(t=>`<trkpt lat="0" lon="0">${t}</trkpt>`).join('');
    const p=scan(wrap(track(body))).points.trkpt;
    expect([p.timeMissing,p.timeInvalid,p.timeZoneMissing,p.timeRepeated,p.timeValid]).toEqual([1,2,1,1,0]);
  });
  it('computes nanosecond/offset-aware adjacent intervals without sorting or crossing invalid records',()=>{
    const r=scan(wrap(track(point(0)+point(0)+point(-1)+point(1800)+'<trkpt lat="0" lon="0"/>'+point(9000)+point(9001))));
    expect([r.duplicateTimes,r.reversedTimes,r.positiveIntervals,r.gapsOver30Minutes]).toEqual([1,1,2,1]);
    const nsReport=scan(wrap(track('<trkpt lat="0" lon="0"><time>2040-01-01T09:00:00.000000001+09:00</time></trkpt><trkpt lat="0" lon="0"><time>2040-01-01T00:00:00.000000002Z</time></trkpt>')));
    expect(nsReport.intervals[0]).toBe(1);
  });
  it('does not use a point with invalid coordinates to compare adjacent times',()=>{
    const r=scan(wrap(track(point(0)+'<trkpt lat="bad" lon="0"><time>'+stamp(4000)+'</time></trkpt>'+point(8000))));
    expect(r.positiveIntervals).toBe(0);
  });
  it('validates optional quality fields without exporting values or converting DOP',()=>{
    const r=scan(wrap(track(point(0,'<ele>-22.55</ele><fix>3d</fix><sat>7</sat><hdop>0.9</hdop><vdop>-1</vdop><pdop>NaN</pdop>')+point(1,'<ele>1</ele><ele>2</ele><fix>invented</fix><sat>2.2</sat><speed>5</speed>'))));
    expect(r.quality.ele).toEqual({present:2,valid:1,invalid:1});
    expect(r.quality.sat.valid).toBe(1);expect(r.quality.hdop.valid).toBe(1);
    expect(r.quality.vdop.invalid).toBe(1);expect(r.quality.pdop.invalid).toBe(1);expect(r.quality.speed.present).toBe(0);
    expect(formatGpxReport(r)).not.toContain('22.55');
  });
  it('does not mistake nested or extension lookalikes for real points or quality',()=>{
    const r=scan(wrap(`<extensions xmlns:x="https://PRIVATE_NAMESPACE.invalid"><x:trk><x:trkseg>${point(0)}</x:trkseg></x:trk><trk><trkseg>${point(0)}</trkseg></trk></extensions>`+track(point(0,'<extensions xmlns:x="https://PRIVATE_NAMESPACE.invalid"><x:hdop>1</x:hdop><x:accuracy>5</x:accuracy></extensions>'))));
    expect(r.points.trkpt.total).toBe(1);expect(r.quality.hdop.present).toBe(0);expect(r.extensionElements).toBeGreaterThan(1);
    expect(JSON.stringify(r)).not.toContain('PRIVATE_NAMESPACE');
  });
  it('scrubs arbitrary names, namespace URIs, attributes, text, comments and instructions',()=>{
    const xml=`<?xml version="1.0" encoding="UTF-8"?><?xml-stylesheet href="https://PRIVATE_URL.invalid"?>`+wrap(`<metadata><name>PRIVATE_NAME</name><desc><![CDATA[{"SECRET_JSON":1}]]></desc></metadata><!-- PRIVATE_COMMENT --><extensions xmlns:secret="https://PRIVATE_URI.invalid"><secret:PRIVATE_ELEMENT PRIVATE_ATTR="PRIVATE_VALUE">PRIVATE_TEXT</secret:PRIVATE_ELEMENT></extensions>`+track(point(0)));
    const r=scan(xml,3),output=JSON.stringify(r)+formatGpxReport(r);
    expect(r.status).toBe('complete');expect(r.comments).toBe(1);expect(r.instructions).toBe(1);
    expect(output).not.toMatch(/PRIVATE_|SECRET_JSON|2040-01-01|https?:|secret:/);
    expect(output).toContain('필드');
  });
  it('rejects malformed XML, DTD, custom entities and declared non-UTF8 without error contents',()=>{
    for(const xml of ['<gpx><PRIVATE_UNCLOSED>',wrap('<wpt lat="1" lat="2"/>'),wrap('<name>&PRIVATE_ENTITY;</name>'),'']) {
      const r=scan(xml);expect(r.status).toBe('failed');expect(r.error).toBe('INVALID_XML');expect(JSON.stringify(r)).not.toContain('PRIVATE_');
    }
    for(const dtd of ['<!DOCTYPE gpx SYSTEM "https://PRIVATE_URL.invalid">','<!DOCTYPE gpx [<!ENTITY private "PRIVATE_ENTITY">]>']) expect(scan(dtd+wrap('')).error).toBe('DTD_FORBIDDEN');
    expect(scan('<?xml version="1.0" encoding="UTF-16"?>'+wrap('')).error).toBe('UNSUPPORTED_ENCODING');
  });
  it('never treats overlong or child-containing scalar fields as valid prefixes',()=>{
    const p=scan(wrap(track(`<trkpt lat="0" lon="0"><time>${stamp(0)+' '.repeat(300)}INVALID</time></trkpt><trkpt lat="0" lon="0"><time><name/>${stamp(0)}</time></trkpt>`)),8).points.trkpt;
    expect(p.timeInvalid).toBe(2);
  });
  it('visits deep structures and large arrays through their last point',()=>{
    const deep='<extensions>'+Array(200).fill('<nested>').join('')+'<last/>'+Array(200).fill('</nested>').join('')+'</extensions>';
    const r=scan(wrap(deep+track(Array(30000).fill('<trkpt lat="0" lon="0"/>').join('')+point(0))),16384);
    expect(r.status).toBe('complete');expect(r.points.trkpt.total).toBe(30001);expect(r.points.trkpt.timeValid).toBe(1);expect(r.shortenedPaths).toBeGreaterThan(0);
  });
  it('discloses detailed report caps without stopping traversal',()=>{
    const r=scan(wrap('<extensions>'+Array.from({length:1300},(_,i)=>`<PRIVATE_${i}/>`).join('')+'</extensions>'));
    expect(r.elements).toBe(1302);expect(r.paths).toHaveLength(1200);expect(r.unlistedNodes).toBeGreaterThan(0);expect(r.unaliasedNames).toBe(100);expect(r.status).toBe('complete');
    expect(formatGpxReport(r)).not.toContain('PRIVATE_');
  });
  it('keeps cancellation and JSON/GPX reports unambiguous',()=>{
    const audit=createGpxAudit();audit.write(wrap('').slice(0,20));audit.report.status='cancelled';
    expect(formatLocalReport(audit.report)).toContain('취소 — 미완료');expect(formatLocalReport(audit.report)).toContain('건수 미확정');
    expect(reportFileName(audit.report)).toBe('gpx-structure-report.txt');expect(reportFileName(emptyAudit())).toBe('timeline-structure-report.txt');
  });
});
