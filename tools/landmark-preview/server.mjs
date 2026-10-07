import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { buildTrip, trips } from '../../src/fixtures/travel.ts';
import { groupPoints, pointsFromTimeline, shortlist, placesUrl, normalizePlaces } from '../../src/experiments/landmark.ts';
const root=fileURLToPath(new URL('../../',import.meta.url));
const base=resolve(root,'node_modules/.cache/landmark-preview');
let env={};try{env=parseEnv(readFileSync(resolve(root,'.env.local'),'utf8'));}catch{}
const keys={maptiler:env.MAPTILER_API_KEY||env.VITE_MAPTILER_API_KEY||'',geoapify:env.GEOAPIFY_API_KEY||env.VITE_GEOAPIFY_API_KEY||''};
const samples=Object.fromEntries(trips.map(t=>[t.id,shortlist(groupPoints(pointsFromTimeline(buildTrip(t.id).timeline)))]));
const cache=new Map(), used={maptiler:0,geoapify:0};let active=false;
const server=http.createServer(async(req,res)=>{
  const origin=`http://127.0.0.1:${res.socket.localPort}`;
  const send=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; worker-src 'self' blob:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
  if(req.headers.host!==new URL(origin).host||req.method!=='GET')return send(403,{code:'REQUEST_DENIED'});
  const url=new URL(req.url,origin);
  if(url.pathname.startsWith('/api/')) {
    if(req.headers['sec-fetch-site']!=='same-origin')return send(403,{code:'REQUEST_DENIED'});
    if(url.pathname==='/api/status')return send(200,{configured:{maptiler:!!keys.maptiler,geoapify:!!keys.geoapify},used,cap:32});
    if(url.pathname!=='/api/places')return send(404,{code:'NOT_FOUND'});
    const provider=url.searchParams.get('provider'),trip=url.searchParams.get('trip'),index=Number(url.searchParams.get('index'));
    if(!['maptiler','geoapify'].includes(provider)||!Object.hasOwn(samples,trip)||!Number.isInteger(index)||index<0||!samples[trip][index])return send(400,{code:'INPUT_INVALID'});
    if(!keys[provider])return send(503,{code:'KEY_MISSING'});
    const slot=`${provider}:${trip}:${index}`;
    if(cache.has(slot))return send(200,{places:cache.get(slot),cached:true,used:used[provider]});
    if(active)return send(429,{code:'BUSY'});
    if(used[provider]>=32)return send(429,{code:'PREVIEW_CAP'});
    active=true;used[provider]++;
    try{
      const response=await fetch(placesUrl(provider,samples[trip][index].point,keys[provider]),{signal:AbortSignal.timeout(12000),redirect:'error',headers:{Referer:origin+'/',Origin:origin}});
      if(!response.ok)return send(502,{code:response.status===429?'PROVIDER_LIMIT':response.status===401||response.status===403?'PROVIDER_AUTH':'PROVIDER_ERROR',used:used[provider]});
      const text=await response.text();if(text.length>1000000)throw new Error('RESPONSE_LIMIT');
      const places=normalizePlaces(provider,JSON.parse(text),samples[trip][index].point);
      cache.set(slot,places);return send(200,{places,cached:false,used:used[provider]});
    }catch{return send(502,{code:'REQUEST_FAILED',used:used[provider]});}finally{active=false;}
  }
  if(url.pathname==='/'){res.writeHead(302,{Location:'/maptiler/'});return res.end();}
  // Explicit build assets only. No repository traversal, data files, env, or source serving.
  if(!/^\/(maptiler|geoapify)\/(?:index\.html|assets\/[A-Za-z0-9_.-]+)?$/.test(url.pathname))return send(404,{code:'NOT_FOUND'});
  const filename=resolve(base,'.'+url.pathname+(url.pathname.endsWith('/')?'index.html':''));
  if(!existsSync(filename))return send(404,{code:'BUILD_MISSING'});
  res.writeHead(200,{'Content-Type':{'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css'}[extname(filename)]||'application/octet-stream'});
  res.end(readFileSync(filename));
});
server.on('error',()=>{console.error('PREVIEW_SERVER_FAILED');process.exitCode=1;});
server.listen(4175,'127.0.0.1',()=>console.log('Local previews: http://127.0.0.1:4175/maptiler/ and /geoapify/ (32 live requests/provider/server run)'));
