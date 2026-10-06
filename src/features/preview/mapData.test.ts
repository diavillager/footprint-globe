import { describe, expect, it } from 'vitest';
import { mapConnections, mapPoints } from './mapData';
import { connectAll } from './analysis';
import type { Observation } from '../../domain/timeline';
const point = (id: number, latitude: number, longitude: number): Observation => ({ id: `observation:${id}`, coordinate: { latitude, longitude }, time: { epochMs: id * 3600000, sourceText: 'PRIVATE_TIME' } });
describe('상세 지도 표시 데이터', () => {
  it('0 좌표와 동일 좌표의 별도 ID를 보존하고 시각을 GeoJSON에 포함하지 않는다', () => {
    const data = mapPoints([point(0, 0, 0), point(1, 0, 0)]);
    expect(data.features.map(feature => feature.properties?.observationId)).toEqual(['observation:0', 'observation:1']);
    expect(data.features[0]?.geometry.coordinates).toEqual([0, 0]);
    expect(JSON.stringify(data)).not.toContain('PRIVATE_TIME');
  });
  it('날짜변경선 연결을 반대편으로 길게 돌아가지 않도록 보간한다', () => {
    const data = mapConnections(connectAll([point(0, 0, 179), point(1, 0, -179)]), true, 60);
    const coords = data.features[0]!.geometry.coordinates;
    expect(coords[0]![0]).toBeCloseTo(179);
    expect(coords.at(-1)![0]).toBeCloseTo(181);
    expect(data.features[0]!.properties?.gap).toBe(true);
  });
  it('실선 모드와 임계값 경계를 구별하며 원본을 변경하지 않는다', () => {
    const points = [point(0, 90, 0), point(1, -90, 0)];
    const before = JSON.stringify(points);
    expect(mapConnections(connectAll(points), true, 3600).features[0]!.properties?.gap).toBe(false);
    expect(mapConnections(connectAll(points), false, 0).features[0]!.properties?.gap).toBe(false);
    expect(JSON.stringify(points)).toBe(before);
  });
});
