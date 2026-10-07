import { commonsFile, normalizeImage, plainMetadata, validCoordinate, LandmarkFailure, ImageFailure,
  type LandmarkPlace, type RegionBounds, type RegionPage, type LandmarkImage } from './geoapify';

const object = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
const qid = (v: unknown): v is string => typeof v === 'string' && /^Q[1-9][0-9]{0,15}$/.test(v);
const languages = ['ja', 'en'] as const;
type Language = typeof languages[number];
interface WikiPlace { place: LandmarkPlace; file: string | null; entity: string | null; koreanName: string | null }
function koreanPlaceName(page: Record<string, unknown>): string | null {
  const labels = object(page.terms)?.label;
  const links = Array.isArray(page.langlinks) ? page.langlinks : [];
  // pageterms may return a language fallback; do not mistake it for Korean.
  const names = [...(Array.isArray(labels) ? labels : []), ...links.filter(link => object(link)?.lang === 'ko').map(link => object(link)?.title)];
  for (const name of names) if (typeof name === 'string' && /[가-힣]/u.test(name) && name.trim()) return name.trim().slice(0, 160);
  return null;
}
const broadTypes = new Set(['country','state','adm1st','adm2nd','city','event']);
const types: Record<string,string> = {landmark:'wiki.landmark',mountain:'wiki.mountain',waterbody:'wiki.waterbody',isle:'wiki.island',railwaystation:'wiki.station',airport:'wiki.airport',edu:'wiki.education'};
export function wikipediaRegionUrl(bounds: RegionBounds, language: Language) {
  if (!validCoordinate({latitude:bounds.south,longitude:bounds.west}) || !validCoordinate({latitude:bounds.north,longitude:bounds.east}) || bounds.south >= bounds.north || bounds.west >= bounds.east) throw new LandmarkFailure('RESPONSE_INVALID');
  const url = new URL(`https://${language}.wikipedia.org/w/api.php`);
  url.search = new URLSearchParams({action:'query',format:'json',formatversion:'2',origin:'*',generator:'geosearch',
    ggsbbox:`${bounds.north}|${bounds.west}|${bounds.south}|${bounds.east}`,ggslimit:'500',ggsnamespace:'0',ggsprimary:'primary',
    prop:'coordinates|pageprops|pageimages|pageterms|langlinks',coprop:'type',coprimary:'primary',colimit:'max',ppprop:'wikibase_item',piprop:'name',pilicense:'free',pilimit:'max',
    wbptlanguage:'ko',wbptterms:'label',lllang:'ko',lllimit:'max'}).toString();
  return url;
}
export function normalizeWikipedia(body: unknown, bounds: RegionBounds, language: Language): {items:WikiPlace[]; pageCount:number} {
  const root = object(body);
  if (!root || root.error) throw new LandmarkFailure('RESPONSE_INVALID');
  // An empty generator result has batchcomplete but no query.
  const query = object(root.query);
  if (!query && Object.hasOwn(root,'batchcomplete')) return {items:[],pageCount:0};
  if (!Array.isArray(query?.pages)) throw new LandmarkFailure('RESPONSE_INVALID');
  const items: WikiPlace[] = [];
  for (const value of query.pages) {
    const page = object(value), coordinates = page?.coordinates;
    if (!page || page.ns !== 0 || !Number.isSafeInteger(page.pageid) || Number(page.pageid) <= 0 || typeof page.title !== 'string' || !page.title.trim() || !Array.isArray(coordinates)) continue;
    const c = object(coordinates[0]);
    if (!c || (c.globe && c.globe !== 'earth') || typeof c.lat !== 'number' || typeof c.lon !== 'number') continue;
    const coordinate = {latitude:c.lat,longitude:c.lon};
    if (!validCoordinate(coordinate) || c.lat < bounds.south || c.lat > bounds.north || c.lon < bounds.west || c.lon > bounds.east || broadTypes.has(String(c.type))) continue;
    const entity = object(page.pageprops)?.wikibase_item;
    const id = qid(entity) ? `wikidata:${entity}` : `wikipedia:${language}:${page.pageid}`;
    const originalName = page.title.trim().slice(0,160), koreanName = koreanPlaceName(page);
    items.push({entity:qid(entity) ? entity : null, koreanName, file:commonsFile(`File:${typeof page.pageimage === 'string' ? page.pageimage : ''}`),
      place:{provider:'wikimedia',providerPlaceId:id,name:koreanName ?? originalName,...(koreanName && koreanName !== originalName ? {originalName} : {}),coordinate,categories:[types[String(c.type)] ?? 'wiki.place'],
        attribution:'Wikipedia · Wikidata',sourceUrl:`https://${language}.wikipedia.org/?curid=${page.pageid}`}});
  }
  return {items,pageCount:query.pages.length};
}
/** Each dataset owns its metadata; no user history, persistent cache, or Geoapify fallback. */
export class WikimediaSource {
  private records = new Map<string, WikiPlace>();
  private nextStart = 0;
  onRequest: (kind:'region'|'photo')=>void = ()=>{};
  constructor(private fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) {}
  clear = () => { this.records.clear(); };
  // Throttle *all* metadata calls, including image subrequests: <=150 starts/minute.
  private async json(url: URL, signal: AbortSignal, kind: 'region'|'photo' = 'region'): Promise<unknown> {
    if (signal.aborted) throw new LandmarkFailure('NETWORK');
    const delay = Math.max(0, this.nextStart - Date.now()); this.nextStart = Date.now() + delay + 400;
    if (delay) await new Promise<void>((resolve,reject) => {
      const abort = () => { clearTimeout(timer); reject(new LandmarkFailure('NETWORK')); };
      const timer = setTimeout(() => { signal.removeEventListener('abort',abort); resolve(); },delay);
      signal.addEventListener('abort',abort,{once:true});
    });
    if (signal.aborted) throw new LandmarkFailure('NETWORK');
    this.onRequest(kind);
    let response: Response;
    try { response = await this.fetcher(url,{signal,credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer'}); }
    catch { throw new LandmarkFailure('NETWORK'); }
    if (response.status === 429 || response.status === 503) throw new LandmarkFailure('RATE_LIMIT');
    if (response.status === 401 || response.status === 403) throw new LandmarkFailure('AUTH');
    if (!response.ok) throw new LandmarkFailure('PROVIDER_FAILURE');
    let body:unknown;try {body=await response.json();} catch {throw new LandmarkFailure('RESPONSE_INVALID');}
    if (signal.aborted) throw new LandmarkFailure('NETWORK');
    const error=object(object(body)?.error);
    if(error) throw new LandmarkFailure(['ratelimited','maxlag'].includes(String(error.code)) ? 'RATE_LIMIT':'RESPONSE_INVALID');
    return body;
  }
  fetchRegion = async (bounds: RegionBounds, _offset: number, _key: string, signal: AbortSignal, additional:()=>void = ()=>{}): Promise<RegionPage> => {
    const found = new Map<string,WikiPlace>(); let calls=0, saturated=false;
    for(const language of languages) {
      const base=wikipediaRegionUrl(bounds,language); let url=base, pages=0;
      const seen=new Set<string>(); const pageIds=new Set<number>(); const merged=new Map<number,Record<string,unknown>>();
      while(true) {
        if(calls++) additional();
        const body=object(await this.json(url,signal));
        if(!body) throw new LandmarkFailure('RESPONSE_INVALID');
        // Property continuation can omit already returned fields; merge by article ID first.
        const entries=object(body.query)?.pages;
        if(Array.isArray(entries)) for(const raw of entries) {const p=object(raw);if(p && Number.isSafeInteger(p.pageid)) {const id=Number(p.pageid);pageIds.add(id);merged.set(id,{...merged.get(id),...p});}}
        else if(!Object.hasOwn(body,'batchcomplete')) throw new LandmarkFailure('RESPONSE_INVALID');
        const continuation=object(body.continue);
        if(!continuation) break;
        const key=JSON.stringify(continuation);
        if(seen.has(key) || ++pages >= 16) throw new LandmarkFailure('SEARCH_INCOMPLETE');
        seen.add(key);url=new URL(base);
        for(const [k,v] of Object.entries(continuation)) {
          if(!['continue','cocontinue','picontinue','ppcontinue','ggscontinue','wbptcontinue','llcontinue'].includes(k) || !['string','number'].includes(typeof v)) throw new LandmarkFailure('RESPONSE_INVALID');
          url.searchParams.set(k,String(v));
        }
      }
      saturated ||= pageIds.size >= 500;
      for(const item of normalizeWikipedia({query:{pages:[...merged.values()]}},bounds,language).items) {
        const previous=found.get(item.place.providerPlaceId);
        if(!previous) found.set(item.place.providerPlaceId,item);
        else {
          if(!previous.file && item.file) previous.file=item.file;
          if(!previous.koreanName && item.koreanName) {
            previous.koreanName=item.koreanName;
            previous.place={...previous.place,originalName:previous.place.name,name:item.koreanName};
          }
        }
      }
    }
    if(signal.aborted) throw new LandmarkFailure('NETWORK');
    for(const [id,item] of found) this.records.set(id,item);
    return {places:[...found.values()].map(item=>item.place),rawCount:saturated ? 500 : Math.min(499,found.size),subdivide:saturated};
  };
  fetchImage = async (id:string, _key:string, signal:AbortSignal, _fetcher:typeof fetch=fetch, additional:()=>void=()=>{}): Promise<LandmarkImage|null> => {
    const item=this.records.get(id);if(!item) return null;
    let file:string|null=null, calls=0;
    const json=async(url:URL)=>{if(calls++) additional();return this.json(url,signal,'photo');};
    if(item.entity) {
      const url=new URL('https://www.wikidata.org/w/api.php');
      url.search=new URLSearchParams({action:'wbgetclaims',format:'json',origin:'*',entity:item.entity,property:'P18'}).toString();
      const body=await json(url), claims=object(object(body)?.claims);
      if(!claims) throw new LandmarkFailure('RESPONSE_INVALID');
      if(Array.isArray(claims.P18)) for(const raw of [...claims.P18].sort((a,b)=>Number(object(b)?.rank==='preferred')-Number(object(a)?.rank==='preferred'))) {
        const claim=object(raw);if(claim?.rank==='deprecated')continue;
        const value=object(object(claim?.mainsnak)?.datavalue)?.value;
        file=commonsFile(`File:${typeof value==='string'?value:''}`);if(file)break;
      }
    }
    // Only an explicit entity photo or the matched article's free representative image.
    const files=[...new Set([file,item.file].filter((f):f is string=>!!f))];
    for(const filename of files) {
      const url=new URL('https://commons.wikimedia.org/w/api.php');
      url.search=new URLSearchParams({action:'query',format:'json',origin:'*',titles:`File:${filename}`,prop:'imageinfo',iiprop:'url|extmetadata',iiurlwidth:'480',iiextmetadatafilter:'Artist|LicenseShortName'}).toString();
      const body=await json(url), pages=object(object(object(body)?.query)?.pages);
      if(!pages) throw new ImageFailure('METADATA');
      for(const value of Object.values(pages)) {
        const infos=object(value)?.imageinfo;if(!Array.isArray(infos)||!infos.length)continue;
        const info=object(infos[0]);const image=normalizeImage({features:[{properties:{wiki_and_media:{image:info?.thumburl??info?.url}}}]});
        if(!image || commonsFile(image.url)!==filename) throw new ImageFailure('UNSUPPORTED');
        const meta=object(info?.extmetadata),author=plainMetadata(object(meta?.Artist)?.value),license=plainMetadata(object(meta?.LicenseShortName)?.value);
        if(!license) throw new ImageFailure('METADATA');
        return {...image,author,license};
      }
    }
    return null;
  };
}
