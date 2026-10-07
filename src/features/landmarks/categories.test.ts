import { expect, it } from 'vitest';
import { categoryLabel } from './categories';
it('계층 중복 없이 가장 구체적인 분류를 한국어로 표시한다', () => {
  expect(categoryLabel(['tourism', 'tourism.sights', 'tourism.sights.memorial'])).toBe('기념물');
  expect(categoryLabel(['tourism.sights.memorial', 'tourism.sights.memorial.monument'])).toBe('기념비');
  expect(categoryLabel(['entertainment.museum', 'entertainment.museum'])).toBe('박물관');
});
it('모르는 세부 분류는 알려진 상위 분류로, 미지원 값은 일반 명칭으로 처리한다', () => {
  expect(categoryLabel(['tourism.sights.memorial.unknown'])).toBe('기념물');
  expect(categoryLabel(['details.wiki_and_media', '<script>', 'constructor', '__proto__'])).toBe('장소');
  expect(categoryLabel([])).toBe('장소');
});
