import type { Coordinate, DatasetId, Observation, ObservationId } from '../../domain/timeline';
import { fetchCandidates, fetchRegion, fetchImage, ImageFailure, type LandmarkImage, LandmarkFailure, type LandmarkCandidate, type LandmarkError, type RegionBounds, type RegionPage } from './geoapify';
import { groupByLandmark, type LandmarkGroup, type ObservationGroup } from './groups';
import { RegionPlan } from './regions';

export const REQUEST_TIMEOUT_MS = 10_000;
export type QueryState =
  | { status: 'idle' | 'loading' | 'cancelled' }
  | { status: 'success' | 'empty'; candidates: readonly LandmarkCandidate[]; fetchedAt: number }
  | { status: 'error'; code: LandmarkError };
export type ImageStatus = 'loading' | 'ready' | 'loaded' | 'missing' | 'unsupported' | 'error' | 'load-error' | 'cancelled';
const idle: QueryState = { status: 'idle' };
type RegionLookup = (bounds: RegionBounds, offset: number, key: string, signal: AbortSignal, additional?: () => void) => Promise<RegionPage>;
type Lookup = (coordinate: Coordinate, key: string, signal: AbortSignal) => Promise<LandmarkCandidate[]>;

/** One instance per loaded dataset. Automatic diary requests start only after file-level consent. */
export class LandmarkSession {
  private imageStates = new Map<string, ImageStatus>();
  mediaRequests = 0;
  private images = new Map<string, LandmarkImage | null>();
  private imageAttempts = new Set<string>();
  private states = new Map<string, QueryState>();
  private selections = new Map<string, string>();
  private listeners = new Set<() => void>();
  private revision = 0;
  private generation = 0;
  private active = new Map<symbol, { id: string; media: boolean; controller: AbortController; timer: ReturnType<typeof setTimeout>; onCancel?: () => void }>();
  private coordinateGroups = new Map<string, Set<string>>();
  private coordinateStates = new Map<string, QueryState>();
  private blocked: LandmarkError | null = null;
  consent = false;
  stopped = false;
  attempts = 0;
  constructor(readonly key: string, private lookup: Lookup = fetchCandidates, private imageLookup = fetchImage, private regionLookup: RegionLookup = (b,o,k,s)=>fetchRegion(b,o,k,s), private source?: {clear:()=>void; actualRequests:boolean}) {}
  get provider() { return this.source ? 'wikimedia' : 'geoapify'; }
  noteRequest(kind: 'region' | 'photo') { this.attempts++; if(kind === 'region') this.regionRequests++; else this.mediaRequests++; this.emit(); }
  private regionPlan: RegionPlan | null = null;
  private datasetId: DatasetId = 'dataset:empty';
  private observations: readonly Observation[] = [];
  groups: readonly LandmarkGroup[] = [];
  phase: 'regions' | 'matching' | 'photos' | 'complete' = 'regions';
  matchedPoints = 0;
  pointCounts = {success:0, empty:0, error:0};
  regionRequests = 0;
  prepareRegions(datasetId: DatasetId, observations: readonly Observation[]) {
    this.datasetId = datasetId; this.observations = observations; this.regionPlan = new RegionPlan(observations);
    this.emit();
  }
  get regionSummary() { return this.regionPlan?.summary() ?? {total:0, processed:0, failed:0, places:0}; }
  get pointCount() { return this.observations.length; }
  async queryNextRegion() {
    if (!this.consent || this.stopped || !this.capacity || this.unavailable || !this.regionPlan) return;
    const task = this.regionPlan.next();
    if (!task) return;
    const plan = this.regionPlan;
    if (!this.source?.actualRequests) this.regionRequests++;
    await this.run(task.id, false, async (signal, valid) => {
      const page = await this.regionLookup(task.bounds, task.offset, this.key, signal);
      if (valid()) plan.accept(task, page);
    }, code => plan.fail(task, code), () => plan.cancel(task));
  }
  async matchRegions() {
    if (!this.regionPlan?.finished || this.phase !== 'regions' || this.stopped || !this.consent || this.unavailable) return;
    this.phase = 'matching'; this.emit();
    const plan = this.regionPlan, generation = this.generation;
    const matches = new Map<ObservationId, readonly LandmarkCandidate[]>(), errors = new Map<ObservationId, LandmarkError>();
    const cache = new Map<string, ReturnType<RegionPlan['candidates']>>();
    const counts = {success:0, empty:0, error:0};
    for (let index = 0; index < this.observations.length; index++) {
      if (index % 500 === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
        if (generation !== this.generation || this.stopped || !this.consent) return;
        this.matchedPoints = index; this.emit();
      }
      const point = this.observations[index]!, key = `${point.coordinate.latitude},${point.coordinate.longitude}`;
      let result = cache.get(key);
      if (!result) { result = plan.candidates(point.coordinate); cache.set(key, result); }
      matches.set(point.id, result.candidates);
      if (result.error) { errors.set(point.id, result.error); counts.error++; }
      else if (result.candidates.length) counts.success++;
      else counts.empty++;
    }
    if (generation !== this.generation || this.stopped || !this.consent) return;
    this.groups = groupByLandmark(this.datasetId, this.observations, matches);
    for (const group of this.groups) {
      const id = group.representative.id, code = errors.get(id), candidates = matches.get(id) ?? [];
      this.states.set(group.groupId, code ? {status:'error', code}
        : {status:candidates.length ? 'success' : 'empty', candidates, fetchedAt:Date.now()});
    }
    this.pointCounts = counts; this.matchedPoints = this.observations.length;
    this.phase = 'photos'; this.emit();
  }
  advanceRegionMapping() {
    if (!this.consent || this.stopped || this.unavailable || !this.capacity) return;
    if (this.phase === 'regions') {
      if (this.regionPlan?.finished && !this.busy) void this.matchRegions();
      else void this.queryNextRegion();
    } else if (this.phase === 'photos') {
      for (const group of this.groups) {
        if (group.landmarkId && !this.hasImageAttempt(group.landmarkId)) { void this.queryImage(group.landmarkId); return; }
      }
      if (!this.busy) { this.phase = 'complete'; this.emit(); }
    }
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.revision;
  private emit() { this.revision++; this.listeners.forEach(listener => listener()); }
  state(groupId: string): QueryState { return this.states.get(groupId) ?? idle; }
  image(id: string) { return this.images.get(id) ?? null; }
  imageStatus(id: string) { return this.imageStates.get(id); }
  imageSummary() {
    const result: Record<ImageStatus, number> = { loading: 0, ready: 0, loaded: 0, missing: 0, unsupported: 0, error: 0, 'load-error': 0, cancelled: 0 };
    for (const state of this.imageStates.values()) result[state]++;
    return result;
  }
  imageRendered(id: string, ok: boolean) {
    if (!this.consent || !this.images.get(id) || this.imageStates.get(id) === 'loaded') return;
    const next = ok ? 'loaded' : 'load-error';
    if (this.imageStates.get(id) !== next) { this.imageStates.set(id, next); this.emit(); }
  }
  hasImageAttempt(id: string) { return this.imageAttempts.has(id); }
  selection(groupId: string) { return this.selections.get(groupId) ?? null; }
  mappingComplete(groups: readonly ObservationGroup[]) {
    return (!this.regionPlan || this.phase === 'complete') && this.consent && !this.stopped && !this.unavailable && !this.busy && groups.length > 0 && groups.every(group => {
      const state = this.state(group.groupId);
      if (state.status === 'empty' || state.status === 'error') return true;
      if (state.status !== 'success') return false;
      const id = state.candidates[0]?.providerPlaceId;
      const photo = id ? this.imageStatus(id) : undefined;
      return !id || (photo !== undefined && photo !== 'loading');
    });
  }
  get busy() { return this.active.size > 0; }
  get capacity() { return this.active.size < 3; }
  get unavailable(): LandmarkError | null { return !this.source && !this.key.trim() ? 'CONFIGURATION' : this.blocked; }
  allow() { this.consent = true; this.emit(); }
  select(groupId: string, candidateId: string | null) {
    const state = this.state(groupId);
    if (candidateId === null) this.selections.delete(groupId);
    else if (state.status === 'success' && state.candidates.some(candidate => candidate.providerPlaceId === candidateId)) this.selections.set(groupId, candidateId);
    this.emit();
  }
  stopMapping() { this.stopped = true; this.cancel(); }
  cancel() {
    this.generation++;
    for (const job of this.active.values()) {
      clearTimeout(job.timer); job.controller.abort();
      if (job.onCancel) job.onCancel();
      else if (job.media) this.imageStates.set(job.id, 'cancelled');
      else this.updateCoordinate(job.id, { status: 'cancelled' });
    }
    this.active.clear(); this.emit();
  }
  revoke() {
    this.cancel(); this.source?.clear(); this.consent = false; this.states.clear(); this.selections.clear(); this.images.clear();
    this.imageAttempts.clear(); this.imageStates.clear(); this.coordinateGroups.clear(); this.coordinateStates.clear(); this.regionPlan = null; this.observations = []; this.groups = []; this.phase = 'regions'; this.matchedPoints = 0; this.pointCounts = {success:0,empty:0,error:0}; this.regionRequests = 0; this.emit();
  }
  dispose() { this.revoke(); this.attempts = 0; this.mediaRequests = 0; this.blocked = null; this.stopped = false; }
  private updateCoordinate(key: string, state: QueryState) {
    this.coordinateStates.set(key, state);
    for (const id of this.coordinateGroups.get(key) ?? []) this.states.set(id, state);
  }
  private async run(id: string, media: boolean, work: (signal: AbortSignal, valid: () => boolean) => Promise<void>, onFail?: (code: LandmarkError) => void, onCancel?: () => void) {
    const token = Symbol(), generation = this.generation, controller = new AbortController();
    const valid = () => generation === this.generation && this.active.has(token);
    const fail = (error: unknown) => {
      if (!valid()) return;
      const code = error instanceof LandmarkFailure ? error.code : 'NETWORK';
      if (code === 'AUTH' || code === 'RATE_LIMIT') this.blocked = code;
      if (onFail) onFail(code);
      else if (media) this.imageStates.set(id, error instanceof ImageFailure && error.code === 'UNSUPPORTED' ? 'unsupported' : 'error');
      else this.updateCoordinate(id, { status: 'error', code });
    };
    const timer = setTimeout(() => {
      fail(new LandmarkFailure('TIMEOUT')); controller.abort(); this.active.delete(token); this.emit();
    }, REQUEST_TIMEOUT_MS);
    this.active.set(token, { id, media, controller, timer, ...(onCancel ? {onCancel} : {}) }); if (!this.source?.actualRequests) this.attempts++; this.emit();
    try { await work(controller.signal, valid); } catch (error) { fail(error); }
    finally { clearTimeout(timer); if (valid()) { this.active.delete(token); this.emit(); } }
  }
  async queryImage(id: string): Promise<void> {
    if (!this.consent || this.stopped || !this.capacity || this.unavailable || this.imageAttempts.has(id)) return;
    this.imageAttempts.add(id); this.imageStates.set(id, 'loading');
    await this.run(id, true, async (signal, valid) => {
      const image = await this.imageLookup(id, this.key, signal, fetch, () => {
        if (valid() && !this.source?.actualRequests) { this.attempts++; this.mediaRequests++; this.emit(); }
      });
      if (valid()) { this.images.set(id, image); this.imageStates.set(id, image ? 'ready' : 'missing'); }
    });
  }
  async query(group: ObservationGroup): Promise<void> {
    const previous = this.state(group.groupId);
    if (!this.consent || this.stopped || previous.status !== 'idle') return;
    const point = group.representative.coordinate, key = `${point.latitude},${point.longitude}`;
    const reused = this.coordinateStates.get(key);
    const ids = this.coordinateGroups.get(key) ?? new Set<string>(); ids.add(group.groupId); this.coordinateGroups.set(key, ids);
    if (reused) { this.states.set(group.groupId, reused); this.emit(); return; }
    if (this.unavailable) { this.states.set(group.groupId, { status: 'error', code: this.unavailable }); this.emit(); return; }
    if (!this.capacity) return;
    this.updateCoordinate(key, { status: 'loading' });
    await this.run(key, false, async (signal, valid) => {
      const candidates = await this.lookup(point, this.key, signal);
      if (valid()) this.updateCoordinate(key, { status: candidates.length ? 'success' : 'empty', candidates, fetchedAt: Date.now() });
    });
  }
}

/** Only this scheduler starts provider work in the UI. At most 4 starts/sec across both phases. */
export function startMapping(groups: readonly ObservationGroup[], session: LandmarkSession) {
  let cursor = 0, photoCursor = 0;
  const timer = setInterval(() => {
    if (!session.consent || session.stopped || !session.capacity || session.unavailable) return;
    while (cursor < groups.length && session.state(groups[cursor]!.groupId).status !== 'idle') cursor++;
    while (cursor < groups.length) { const before = session.attempts; void session.query(groups[cursor++]!); if (session.attempts !== before) return; }
    // Wait for all place results so images cannot delay names or skip late results.
    if (groups.some(group => session.state(group.groupId).status === 'loading')) return;
    while (photoCursor < groups.length) {
      const state = session.state(groups[photoCursor++]!.groupId);
      if (state.status !== 'success') continue;
      const candidate = state.candidates[0];
      if (candidate && !session.hasImageAttempt(candidate.providerPlaceId)) { void session.queryImage(candidate.providerPlaceId); return; }
    }
    if (!session.busy) clearInterval(timer);
  }, 250);
  return () => clearInterval(timer);
}


export function startRegionMapping(session: LandmarkSession) {
  const timer = setInterval(() => {
    session.advanceRegionMapping();
    if (session.phase === 'complete' || session.stopped || session.unavailable) clearInterval(timer);
  }, 250);
  return () => clearInterval(timer);
}
