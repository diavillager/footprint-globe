// Geoapify category hierarchy: https://apidocs.geoapify.com/docs/places/#categories
const labels: Record<string, string> = {
  tourism: '관광 장소', 'tourism.attraction': '관광 명소', 'tourism.sights': '볼거리',
  'tourism.attraction.artwork': '공공 미술', 'tourism.attraction.artwork.mural': '벽화',
  'tourism.attraction.artwork.sculpture': '조각 작품', 'tourism.attraction.artwork.statue': '동상',
  'tourism.attraction.clock': '시계 명소', 'tourism.attraction.fountain': '분수', 'tourism.attraction.viewpoint': '전망 명소',
  'tourism.sights.archaeological_site': '고고학 유적', 'tourism.sights.battlefield': '전적지',
  'tourism.sights.building': '건축 명소', 'tourism.sights.bridge': '다리', 'tourism.sights.castle': '성',
  'tourism.sights.city_gate': '성문', 'tourism.sights.city_hall': '시청', 'tourism.sights.conference_centre': '회의장',
  'tourism.sights.fort': '요새', 'tourism.sights.lighthouse': '등대', 'tourism.sights.manor': '저택',
  'tourism.sights.memorial': '기념물', 'tourism.sights.memorial.monument': '기념비',
  'tourism.sights.memorial.tomb': '묘소', 'tourism.sights.memorial.tumulus': '고분',
  'tourism.sights.memorial.necropolis': '역사 묘역', 'tourism.sights.memorial.boundary_stone': '경계석',
  'tourism.sights.memorial.milestone': '이정표', 'tourism.sights.memorial.aircraft': '항공기 기념물',
  'tourism.sights.memorial.locomotive': '기관차 기념물', 'tourism.sights.memorial.railway_car': '철도 차량 기념물',
  'tourism.sights.memorial.ship': '선박 기념물', 'tourism.sights.memorial.tank': '전차 기념물',
  'tourism.sights.memorial.pillory': '역사 형벌대', 'tourism.sights.memorial.wayside_cross': '길가 십자가',
  'tourism.sights.mine': '광산 유적', 'tourism.sights.monastery': '수도원',
  'tourism.sights.place_of_worship': '종교 시설', 'tourism.sights.place_of_worship.cathedral': '대성당',
  'tourism.sights.place_of_worship.chapel': '예배당', 'tourism.sights.place_of_worship.church': '교회',
  'tourism.sights.place_of_worship.mosque': '모스크', 'tourism.sights.place_of_worship.shrine': '성소',
  'tourism.sights.place_of_worship.synagogue': '유대교 회당', 'tourism.sights.place_of_worship.temple': '사원',
  'tourism.sights.ruines': '폐허 유적', 'tourism.sights.tower': '탑', 'tourism.sights.windmill': '풍차',
  'tourism.sights.wreck': '난파선·잔해', 'entertainment.museum': '박물관', 'entertainment': '문화·여가 시설',
};
/** Prefer the most specific known label; unknown descendants fall back to a known parent. */
export function categoryLabel(categories: readonly string[]): string {
  const resolved = categories.flatMap(category => {
    let key = category;
    while (key) {
      if (Object.hasOwn(labels, key)) return [key];
      key = key.includes('.') ? key.slice(0, key.lastIndexOf('.')) : '';
    }
    return [];
  });
  const unique = [...new Set(resolved)];
  return unique.filter(key => !unique.some(other => other.startsWith(key + '.')))
    .map(key => labels[key]).join(' · ') || '장소';
}
