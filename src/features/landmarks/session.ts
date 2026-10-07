import type { Coordinate } from '../../domain/timeline';
import { fetchCandidates, fetchImage, ImageFailure, type LandmarkImage, LandmarkFailure, type LandmarkCandidate, type LandmarkError } from './geoapify';
import type { ObservationGroup } from './groups';

export const REQUEST_TIMEOUT_MS = 10_000;
export type QueryState =
  | { status: 'idle' | 'loading' | 'cancelled' }
  | { status: 'success' | 'empty'; candidates: readonly LandmarkCandidate[]; fetchedAt: number }
  | { status: 'error'; code: LandmarkError };
export type ImageStatus = 'loading' | 'ready' | 'loaded' | 'missing' | 'unsupported' | 'error' | 'load-error' | 'cancelled';
const idle: QueryState = { status: 'idle' };
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
  private active = new Map<symbol, { id: string; media: boolean; controller: AbortController; timer: ReturnType<typeof setTimeout> }>();
  private coordinateGroups = new Map<string, Set<string>>();
  private coordinateStates = new Map<string, QueryState>();
  private blocked: LandmarkError | null = null;
  consent = false;
  attempts = 0;
  constructor(readonly key: string, private lookup: Lookup = fetchCandidates, private imageLookup = fetchImage) {}
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
  get busy() { return this.active.size > 0; }
  get capacity() { return this.active.size < 3; }
  get unavailable(): LandmarkError | null { return !this.key.trim() ? 'CONFIGURATION' : this.blocked; }
  allow() { this.consent = true; this.emit(); }
  select(groupId: string, candidateId: string | null) {
    const state = this.state(groupId);
    if (candidateId === null) this.selections.delete(groupId);
    else if (state.status === 'success' && state.candidates.some(candidate => candidate.providerPlaceId === candidateId)) this.selections.set(groupId, candidateId);
    this.emit();
  }
  cancel() {
    this.generation++;
    for (const job of this.active.values()) {
      clearTimeout(job.timer); job.controller.abort();
      if (job.media) this.imageStates.set(job.id, 'cancelled');
      else this.updateCoordinate(job.id, { status: 'cancelled' });
    }
    this.active.clear(); this.emit();
  }
  revoke() {
    this.cancel(); this.consent = false; this.states.clear(); this.selections.clear(); this.images.clear();
    this.imageAttempts.clear(); this.imageStates.clear(); this.coordinateGroups.clear(); this.coordinateStates.clear(); this.emit();
  }
  dispose() { this.revoke(); this.attempts = 0; this.mediaRequests = 0; this.blocked = null; }
  private updateCoordinate(key: string, state: QueryState) {
    this.coordinateStates.set(key, state);
    for (const id of this.coordinateGroups.get(key) ?? []) this.states.set(id, state);
  }
  private async run(id: string, media: boolean, work: (signal: AbortSignal, valid: () => boolean) => Promise<void>) {
    const token = Symbol(), generation = this.generation, controller = new AbortController();
    const valid = () => generation === this.generation && this.active.has(token);
    const fail = (error: unknown) => {
      if (!valid()) return;
      const code = error instanceof LandmarkFailure ? error.code : 'NETWORK';
      if (code === 'AUTH' || code === 'RATE_LIMIT') this.blocked = code;
      if (media) this.imageStates.set(id, error instanceof ImageFailure && error.code === 'UNSUPPORTED' ? 'unsupported' : 'error');
      else this.updateCoordinate(id, { status: 'error', code });
    };
    const timer = setTimeout(() => {
      fail(new LandmarkFailure('TIMEOUT')); controller.abort(); this.active.delete(token); this.emit();
    }, REQUEST_TIMEOUT_MS);
    this.active.set(token, { id, media, controller, timer }); this.attempts++; this.emit();
    try { await work(controller.signal, valid); } catch (error) { fail(error); }
    finally { clearTimeout(timer); if (valid()) { this.active.delete(token); this.emit(); } }
  }
  async queryImage(id: string): Promise<void> {
    if (!this.consent || !this.capacity || this.unavailable || this.imageAttempts.has(id)) return;
    this.imageAttempts.add(id); this.imageStates.set(id, 'loading');
    await this.run(id, true, async (signal, valid) => {
      const image = await this.imageLookup(id, this.key, signal, fetch, () => {
        if (valid()) { this.attempts++; this.mediaRequests++; this.emit(); }
      });
      if (valid()) { this.images.set(id, image); this.imageStates.set(id, image ? 'ready' : 'missing'); }
    });
  }
  async query(group: ObservationGroup): Promise<void> {
    const previous = this.state(group.groupId);
    if (!this.consent || previous.status !== 'idle') return;
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
    if (!session.consent || !session.capacity || session.unavailable) return;
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
