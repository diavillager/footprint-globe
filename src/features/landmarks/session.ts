import type { Coordinate } from '../../domain/timeline';
import { fetchCandidates, fetchImage, type LandmarkImage, LandmarkFailure, type LandmarkCandidate, type LandmarkError } from './geoapify';
import type { ObservationGroup } from './groups';

export const REQUEST_TIMEOUT_MS = 10_000;
export type QueryState =
  | { status: 'idle' | 'loading' | 'cancelled' }
  | { status: 'success' | 'empty'; candidates: readonly LandmarkCandidate[]; fetchedAt: number }
  | { status: 'error'; code: LandmarkError };
const idle: QueryState = { status: 'idle' };
type Lookup = (coordinate: Coordinate, key: string, signal: AbortSignal) => Promise<LandmarkCandidate[]>;

/** One instance per loaded dataset. Automatic diary requests start only after file-level consent. */
export class LandmarkSession {
  private images = new Map<string, LandmarkImage | null>();
  private imageAttempts = new Set<string>();
  private states = new Map<string, QueryState>();
  private selections = new Map<string, string>();
  private listeners = new Set<() => void>();
  private revision = 0;
  private generation = 0;
  private active: { groupId: string; controller: AbortController; timer: ReturnType<typeof setTimeout>; media?: boolean } | null = null;
  private blocked: LandmarkError | null = null;
  consent = false;
  attempts = 0;
  constructor(readonly key: string, private lookup: Lookup = fetchCandidates, private imageLookup = fetchImage) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.revision;
  private emit() { this.revision++; this.listeners.forEach(listener => listener()); }
  state(groupId: string): QueryState { return this.states.get(groupId) ?? idle; }
  image(id: string) { return this.images.get(id) ?? null; }
  hasImageAttempt(id: string) { return this.imageAttempts.has(id); }
  selection(groupId: string) { return this.selections.get(groupId) ?? null; }
  get busy() { return this.active !== null; }
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
    if (this.active) {
      clearTimeout(this.active.timer);
      this.active.controller.abort();
      if (!this.active.media) this.states.set(this.active.groupId, { status: 'cancelled' });
      this.active = null;
      this.emit();
    }
  }
  revoke() { this.cancel(); this.consent = false; this.states.clear(); this.selections.clear(); this.images.clear(); this.imageAttempts.clear(); this.emit(); }
  dispose() { this.revoke(); this.attempts = 0; this.blocked = null; }
  async queryImage(id: string): Promise<void> {
    if (!this.consent || this.busy || this.unavailable || this.imageAttempts.has(id)) return;
    this.imageAttempts.add(id);
    const generation = ++this.generation, controller = new AbortController();
    this.attempts++;
    const timer = setTimeout(() => {
      if (generation !== this.generation) return;
      this.generation++; controller.abort(); this.active = null; this.emit();
    }, REQUEST_TIMEOUT_MS);
    this.active = { groupId: '', controller, timer, media: true }; this.emit();
    try {
      const image = await this.imageLookup(id, this.key, controller.signal);
      if (generation === this.generation) this.images.set(id, image);
    } catch (error) {
      if (generation === this.generation && error instanceof LandmarkFailure && (error.code === 'AUTH' || error.code === 'RATE_LIMIT')) this.blocked = error.code;
    } finally {
      clearTimeout(timer);
      if (generation === this.generation) { this.active = null; this.emit(); }
    }
  }
  async query(group: ObservationGroup): Promise<void> {
    const previous = this.state(group.groupId);
    if (!this.consent || this.active || previous.status === 'success' || previous.status === 'empty') return;
    if (this.unavailable) { this.states.set(group.groupId, { status: 'error', code: this.unavailable }); this.emit(); return; }
    const generation = ++this.generation;
    const controller = new AbortController();
    this.attempts++;
    this.states.set(group.groupId, { status: 'loading' });
    const timer = setTimeout(() => {
      if (generation !== this.generation) return;
      this.generation++; controller.abort(); this.active = null;
      this.states.set(group.groupId, { status: 'error', code: 'TIMEOUT' }); this.emit();
    }, REQUEST_TIMEOUT_MS);
    this.active = { groupId: group.groupId, controller, timer };
    this.emit();
    try {
      const candidates = await this.lookup(group.representative.coordinate, this.key, controller.signal);
      if (generation !== this.generation) return;
      this.states.set(group.groupId, { status: candidates.length ? 'success' : 'empty', candidates, fetchedAt: Date.now() });
    } catch (error) {
      if (generation !== this.generation) return;
      const code = error instanceof LandmarkFailure ? error.code : 'NETWORK';
      if (code === 'AUTH' || code === 'RATE_LIMIT') this.blocked = code;
      this.states.set(group.groupId, { status: 'error', code });
    } finally {
      clearTimeout(timer);
      if (generation === this.generation) { this.active = null; this.emit(); }
    }
  }
}
