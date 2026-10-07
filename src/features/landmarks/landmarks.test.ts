import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Observation } from '../../domain/timeline';
import { groupObservations } from './groups';
import { fetchCandidates, normalizeImage, geoapifyUrl, LandmarkFailure, normalizeCandidates } from './geoapify';
import { LandmarkSession, REQUEST_TIMEOUT_MS } from './session';
import { buildTrip, trips } from '../../fixtures/travel';
import { parseTimeline } from '../../parser';

const point = (id: number, longitude = 0, ms = id * 60_000): Observation => ({ id: `observation:${id}`, coordinate: { latitude: 0, longitude }, time: { epochMs: ms, sourceText: new Date(ms).toISOString() } });
const group = (id = 0) => groupObservations('dataset:test', [point(id)])[0]!;
const feature = (id: string, name: unknown = '가상 박물관', coordinates: unknown = [0, 0]) => ({ properties: { place_id: id, name, categories: ['entertainment.museum'] }, geometry: { type: 'Point', coordinates } });
const body = { features: [feature('one')] };
const candidates = normalizeCandidates(body, point(0).coordinate);
afterEach(() => vi.useRealTimers());

describe('표시용 관측 묶기', () => {
  it('고정 기준점·재방문·공백을 구분하고 원본을 전부 보존한다', () => {
    const points = [point(0), point(1, .0007), point(2, .0014), point(3), point(4, 0, 123 * 60_000), point(5, 0, 244 * 60_000)];
    const before = structuredClone(points);
    const groups = groupObservations('dataset:test', points);
    expect(groups.map(item => item.observationCount)).toEqual([2, 1, 2, 1]);
    expect(groups.flatMap(item => item.sourceObservationIds)).toEqual(points.map(item => item.id));
    expect(points).toEqual(before);
    expect(groups[0]!.representative).toBe(points[0]);
    expect(groups[2]!.end).toBe(points[4]!.time);
  });
  it('빈 입력·0 좌표·거리와 시간 경계·동일 시각 순서를 처리한다', () => {
    expect(groupObservations('dataset:test', [])).toEqual([]);
    const degrees100m = 100 / 6371008.8 * 180 / Math.PI;
    expect(groupObservations('dataset:test', [point(3, 0, 0), point(1, degrees100m - 1e-12, 7_200_000)])).toHaveLength(1);
    expect(groupObservations('dataset:test', [point(3, 0, 0), point(1, degrees100m + 1e-12, 0)])).toHaveLength(2);
    expect(groupObservations('dataset:test', [point(3, 0, 0), point(1, 0, 7_200_001)])).toHaveLength(2);
    expect(groupObservations('dataset:test', [point(3, 0, 0), point(1, 0, 0)])[0]!.sourceObservationIds).toEqual(['observation:3', 'observation:1']);
  });
  it('좌표·배열 표시 순서 대신 데이터셋과 원본 구성원으로 identity를 유지한다', () => {
    const points = [point(0), point(1), point(2)];
    const a = groupObservations('dataset:test', points)[0]!;
    expect(groupObservations('dataset:test', structuredClone(points))[0]!.groupId).toBe(a.groupId);
    expect(groupObservations('dataset:other', points)[0]!.groupId).not.toBe(a.groupId);
    expect(groupObservations('dataset:test', [points[0]!, points[2]!])[0]!.groupId).not.toBe(a.groupId);
  });
  it.each(trips.map(trip => trip.id))('%s 합성 여행의 원본 ID와 시각 순서를 보존한다', async id => {
    const parsed = await parseTimeline(JSON.stringify(buildTrip(id).timeline), 'dataset:travel');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const groups = groupObservations(parsed.data.datasetId, parsed.data.observations);
    expect(groups.flatMap(item => item.sourceObservationIds)).toEqual(parsed.data.observations.map(item => item.id));
    expect(groups.length).toBeLessThan(parsed.data.observations.length);
  });
});

describe('Geoapify 어댑터', () => {
  it('좌표 순서·최소 요청 필드·고정 제공자를 유지한다', () => {
    const url = geoapifyUrl({ latitude: 1, longitude: 2 }, 'synthetic-key');
    expect(url.origin).toBe('https://api.geoapify.com');
    expect(url.searchParams.get('filter')).toBe('circle:2,1,300');
    expect([...url.searchParams.keys()].sort()).toEqual(['apiKey', 'bias', 'categories', 'filter', 'lang', 'limit']);
    expect(() => geoapifyUrl({ latitude: 91, longitude: 0 }, 'key')).toThrow('RESPONSE_INVALID');
    expect(() => geoapifyUrl(point(0).coordinate, '')).toThrow('CONFIGURATION');
  });
  it('누락·비정상 응답·중복 ID·의미 없는 이름·먼 후보를 제외하고 HTML은 텍스트로 유지한다', () => {
    const normalized = normalizeCandidates({ features: [null, feature('one'), feature('one'), feature('dash', '-'), feature('missing', null), feature('bad', 'bad', [0, 91]), feature('far', 'far', [1, 1]), feature('html', '<img src=x onerror=alert(1)>'), feature('jp', '美術館', [.001, 0])] }, point(0).coordinate);
    expect(normalized.map(item => item.providerPlaceId)).toEqual(['one', 'html', 'jp']);
    expect(normalized[0]!.distanceMeters).toBe(0);
    expect(normalized[1]!.name).toContain('<img');
    expect(() => normalizeCandidates({}, point(0).coordinate)).toThrow('RESPONSE_INVALID');
    expect(normalizeCandidates({ features: [] }, point(0).coordinate)).toEqual([]);
  });
  it.each([[401, 'AUTH'], [403, 'AUTH'], [429, 'RATE_LIMIT'], [500, 'PROVIDER_FAILURE']] as const)('%i는 원문 없는 고정 코드로 처리한다', async (status, code) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('PRIVATE ERROR', { status }));
    await expect(fetchCandidates(point(0).coordinate, 'key', new AbortController().signal, fetcher)).rejects.toMatchObject({ code, message: code });
  });
  it('GET 요청에 쿠키·캐시·리다이렉트를 사용하지 않는다', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(body));
    await expect(fetchCandidates(point(0).coordinate, 'key', new AbortController().signal, fetcher)).resolves.toEqual(candidates);
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'strict-origin' });
    const failing = vi.fn<typeof fetch>().mockRejectedValue(new Error('PRIVATE URL'));
    await expect(fetchCandidates(point(0).coordinate, 'key', new AbortController().signal, failing)).rejects.toThrow('NETWORK');
  });
});

describe('파일별 조회 수명', () => {
  it('세션은 동의 전 요청을 막고 호출 결과 캐시·선택·철회를 관리한다', async () => {
    const lookup = vi.fn().mockResolvedValue(candidates);
    const session = new LandmarkSession('key', lookup), item = group();
    await session.query(item); expect(lookup).not.toHaveBeenCalled();
    session.allow(); expect(lookup).not.toHaveBeenCalled();
    await session.query(item); await session.query(item);
    expect(lookup).toHaveBeenCalledTimes(1); expect(session.attempts).toBe(1);
    session.select(item.groupId, 'one'); expect(session.selection(item.groupId)).toBe('one');
    session.select(item.groupId, null); expect(session.selection(item.groupId)).toBeNull();
    session.revoke(); expect(session.state(item.groupId).status).toBe('idle'); expect(session.consent).toBe(false); expect(session.attempts).toBe(1);
  });
  it('빈 결과도 재사용하며 이전 32회 제한 이후에도 전체 지점을 조회한다', async () => {
    const lookup = vi.fn().mockResolvedValue([]), session = new LandmarkSession('key', lookup);
    session.allow();
    await session.query(group()); await session.query(group());
    expect(lookup).toHaveBeenCalledTimes(1); expect(session.state(group().groupId).status).toBe('empty');
    for (let i = 1; i <= 40; i++) await session.query(group(i));
    expect(lookup).toHaveBeenCalledTimes(41);
    expect(session.state(group(40).groupId).status).toBe('empty');
  });
  it('단일 동시 요청·취소·파일 교체 뒤 늦은 응답을 차단한다', async () => {
    let resolve!: (value: typeof candidates) => void;
    const lookup = vi.fn((_coordinate, _key, _signal) => new Promise<typeof candidates>(done => { resolve = done; }));
    const session = new LandmarkSession('key', lookup); session.allow();
    const pending = session.query(group());
    await session.query(group()); await session.query(group(1)); expect(lookup).toHaveBeenCalledTimes(1);
    const signal = lookup.mock.calls[0]![2] as AbortSignal;
    session.dispose(); expect(signal.aborted).toBe(true);
    resolve(candidates); await pending;
    expect(session.state(group().groupId).status).toBe('idle'); expect(session.consent).toBe(false);
  });
  it('10초 제한 뒤 늦은 응답을 무시하고 자체적으로 재시도하지 않는다', async () => {
    vi.useFakeTimers();
    let resolve!: (value: typeof candidates) => void;
    const lookup = vi.fn(() => new Promise<typeof candidates>(done => { resolve = done; }));
    const session = new LandmarkSession('key', lookup); session.allow();
    const pending = session.query(group());
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    expect(session.state(group().groupId)).toEqual({ status: 'error', code: 'TIMEOUT' });
    resolve(candidates); await pending;
    expect(session.state(group().groupId)).toEqual({ status: 'error', code: 'TIMEOUT' });
    expect(lookup).toHaveBeenCalledTimes(1); expect(session.busy).toBe(false);
  });
  it.each(['AUTH', 'RATE_LIMIT'] as const)('%s 후 추가 요청을 막고 실패도 한도에 포함한다', async code => {
    const lookup = vi.fn().mockRejectedValue(new LandmarkFailure(code)), session = new LandmarkSession('key', lookup); session.allow();
    await session.query(group()); await session.query(group(1));
    expect(lookup).toHaveBeenCalledTimes(1); expect(session.attempts).toBe(1);
    expect(session.state(group(1).groupId)).toEqual({ status: 'error', code });
  });
});

describe('랜드마크 사진', () => {
  it('Geoapify 이미지가 없거나 임의 호스트·실행 가능한 형식이면 텍스트로 남긴다', () => {
    const wrap = (image: string) => ({ features: [{ properties: { wiki_and_media: { image } } }] });
    expect(normalizeImage({ features: [] })).toBeNull();
    for (const url of ['http://upload.wikimedia.org/x.jpg', 'https://localhost/x.png', 'https://upload.wikimedia.org.evil.test/x.jpg', 'https://upload.wikimedia.org/x.svg', 'javascript:alert(1)']) expect(normalizeImage(wrap(url))).toBeNull();
    expect(normalizeImage(wrap('https://upload.wikimedia.org/wikipedia/commons/a/ab/Test.jpg'))).toEqual({ url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Test.jpg', source: 'https://commons.wikimedia.org/wiki/File:Test.jpg' });
  });
  it('사진 상세 요청도 직렬화·캐시하고 파일 교체 후 늦은 응답을 무시한다', async () => {
    let finish!: (value: { url: string; source: string }) => void;
    const lookup = vi.fn(() => new Promise<{ url: string; source: string }>(resolve => { finish = resolve; }));
    const session = new LandmarkSession('key', vi.fn().mockResolvedValue([]), lookup);
    await session.queryImage('one'); expect(lookup).not.toHaveBeenCalled();
    session.allow(); const pending = session.queryImage('one');
    await session.query(group()); await session.queryImage('two');
    expect(session.attempts).toBe(1); expect(lookup).toHaveBeenCalledTimes(1);
    session.dispose(); finish({ url: 'test', source: 'test' }); await pending;
    expect(session.image('one')).toBeNull(); expect(session.hasImageAttempt('one')).toBe(false);
  });
});
