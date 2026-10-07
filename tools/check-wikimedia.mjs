// Explicit live, free Wikimedia API check against the fully synthetic Japan fixture only.
// Never accepts user files. No Geoapify requests or API keys.
import { createServer } from 'vite';
import { writeFile, mkdir } from 'node:fs/promises';
if (!process.argv.includes('--live')) { console.log('Use --live to test Wikimedia with the fully synthetic Japan fixture.'); process.exit(0); }
const server = await createServer({server:{middlewareMode:true},logLevel:'error'});
let session, timer;
try {
 const {WikimediaSource}=await server.ssrLoadModule('/src/features/landmarks/wikimedia.ts');
 const {LandmarkSession,startRegionMapping}=await server.ssrLoadModule('/src/features/landmarks/session.ts');
 const {buildTrip}=await server.ssrLoadModule('/src/fixtures/travel.ts');
 const {parseTimeline}=await server.ssrLoadModule('/src/parser/index.ts');
 const source=new WikimediaSource((url,opts)=>fetch(url,{...opts,headers:{'User-Agent':'FootprintGlobe-validation/1.0 (https://github.com/diavillager/footprint-globe)'}}));
 session=new LandmarkSession('',undefined,source.fetchImage,source.fetchRegion,{clear:source.clear,actualRequests:true});source.onRequest=kind=>session.noteRequest(kind);
 const parsed=await parseTimeline(JSON.stringify(buildTrip('japan').timeline),'dataset:synthetic-japan');
 if(!parsed.ok)throw Error('SYNTHETIC_PARSE_FAILED');
 session.prepareRegions(parsed.data.datasetId,parsed.data.observations);session.allow();timer=startRegionMapping(session);
 const start=Date.now();let last=0;
 while(session.phase!=='complete' && !session.unavailable && !session.stopped) {
  await new Promise(resolve=>setTimeout(resolve,500));
  if(Date.now()-last>15000) {last=Date.now();console.log(JSON.stringify({phase:session.phase,regions:session.regionSummary,requests:session.attempts}));}
  if(Date.now()-start>600000) {session.stopMapping();throw Error('VALIDATION_TIMEOUT');}
 }
 const report={fixture:'fully synthetic japan',timestamp:new Date().toISOString(),phase:session.phase,error:session.unavailable,
  points:session.pointCount,regions:session.regionSummary,pointCounts:session.pointCounts,groups:session.groups.length,
  uniqueMappedPlaces:new Set(session.groups.map(g=>g.landmarkId).filter(Boolean)).size,images:session.imageSummary(),
  requests:session.attempts,regionRequests:session.regionRequests,photoRequests:session.mediaRequests,elapsedSeconds:Math.round((Date.now()-start)/1000)};
 await mkdir('node_modules/.cache',{recursive:true});await writeFile('node_modules/.cache/wikimedia-live-report.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));if(report.error)process.exitCode=1;
} finally {timer?.();session?.dispose();await server.close();}
