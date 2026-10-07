// Preview-only experiment. Not imported by the production application.
export type Point = { lat: number; lon: number; ms: number };
export type Group = { id: number; point: Point; start: number; end: number; count: number };
export type Place = { name: string; lat: number; lon: number; category: string; meters: number };
export function meters(a: {lat: number; lon: number}, b: {lat: number; lon: number}) {
  const r = Math.PI / 180;
  const h = Math.sin((b.lat-a.lat)*r/2)**2 + Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin((b.lon-a.lon)*r/2)**2;
  return 12742000*Math.asin(Math.sqrt(Math.min(1,h)));
}
export function groupPoints(points: Point[], radius = 100): Group[] {
  const result: Group[] = [];
  points.forEach((point, index) => {
    const group = result.at(-1);
    // Fixed anchor prevents a sequence of nearby moving points swallowing the whole trip.
    if (group && point.ms-group.end <= 120*60000 && meters(point,group.point) <= radius) {
      group.end=point.ms; group.count++;
    } else result.push({id:index,point,start:point.ms,end:point.ms,count:1});
  });
  return result;
}
export function pointsFromTimeline(timeline: {rawSignals: {position: {LatLng: string; timestamp: string}}[]}): Point[] {
  return timeline.rawSignals.map(({position}) => {
    const [lat,lon] = position.LatLng.replaceAll('°','').split(',').map(Number);
    return {lat:lat!,lon:lon!,ms:Date.parse(position.timestamp)};
  });
}
export function shortlist(groups: Group[]): Group[] {
  const unique: Group[] = [];
  for (const group of groups.filter(g => g.end-g.start >= 10*60000)) {
    if (!unique.some(g => meters(g.point,group.point)<120)) unique.push(group);
  }
  if (unique.length<=8) return unique;
  return Array.from({length:8},(_,i)=>unique[Math.round(i*(unique.length-1)/7)]!);
}
export function placesUrl(provider: string, point: Point, key: string) {
  if(provider==='maptiler') {
    const url=new URL(`https://api.maptiler.com/geocoding/${point.lon},${point.lat}.json`);
    url.search=new URLSearchParams({key,types:'poi',limit:'10',language:'ko'}).toString();return url;
  }
  if(provider!=='geoapify') throw new Error('PROVIDER_INVALID');
  const url=new URL('https://api.geoapify.com/v2/places');
  url.search=new URLSearchParams({apiKey:key,categories:'tourism.attraction,tourism.sights,entertainment.museum',filter:`circle:${point.lon},${point.lat},300`,bias:`proximity:${point.lon},${point.lat}`,limit:'10',lang:'ko'}).toString();return url;
}
export function normalizePlaces(provider: string, body: unknown, point: Point): Place[] {
  if (!body || typeof body!=='object' || !('features' in body) || !Array.isArray(body.features)) throw new Error('RESPONSE_INVALID');
  const result: Place[]=[];
  for(const feature of body.features.slice(0,10)) {
    if (!feature || typeof feature !== 'object') continue;
    const p=feature?.properties || {};
    const coords=feature?.geometry?.type==='Point' ? feature.geometry.coordinates : feature?.center;
    const lat=coords?.[1],lon=coords?.[0];
    const name=provider==='maptiler' ? feature.text_ko || feature.text || p.name : p.name;
    if(typeof name!=='string'||!name.trim()||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)continue;
    const category=provider==='maptiler' ? (Array.isArray(p.categories)?p.categories.join(', '):'주변 POI · 관광지 확정 아님') : (Array.isArray(p.categories)?p.categories.join(', '):'관광 POI');
    const d=meters(point,{lat,lon});
    if(d<=300&&!result.some(item=>item.name===name&&meters(item,{lat,lon})<5))result.push({name:name.slice(0,160),lat,lon,category:category.slice(0,240),meters:Math.round(d)});
  }
  return result.sort((a,b)=>a.meters-b.meters);
}
