/** Fully authored presentation fixture. No personal exports or network input. */
type Coordinate = readonly [number, number];
export const seoulPlaces = {
  gate: { name: '광화문', coordinate: [37.576044, 126.977019] },
  palace: { name: '경복궁', coordinate: [37.579884, 126.976800] },
  museum: { name: '국립고궁박물관', coordinate: [37.576667, 126.975278] },
  bukchon: { name: '북촌한옥마을', coordinate: [37.583056, 126.983611] },
  jogye: { name: '조계사', coordinate: [37.573914, 126.981903] },
  unhyeon: { name: '운현궁', coordinate: [37.576122, 126.987233] },
  changdeok: { name: '창덕궁', coordinate: [37.579444, 126.992778] },
  changgyeong: { name: '창경궁', coordinate: [37.578430, 126.995980] },
} as const;
type Place = keyof typeof seoulPlaces;
export const seoulDays: readonly (readonly Place[])[] = [
  ['gate', 'palace', 'bukchon'],
  ['jogye', 'unhyeon', 'changdeok'],
  ['changdeok', 'changgyeong', 'unhyeon'],
  ['gate', 'jogye', 'unhyeon'],
  ['museum', 'palace', 'gate'],
  ['bukchon', 'changdeok', 'changgyeong'],
  ['museum', 'jogye', 'gate'],
];
// Sparse authored waypoints, kept north of Cheonggyecheon. No river crossings.
// These depict a fictional outing, not surveyed paths or turn-by-turn directions.
const routes: Record<string, readonly Coordinate[]> = {
  'gate-palace': [[37.5770,126.9770],[37.5784,126.9770]],
  'palace-bukchon': [[37.5798,126.9790],[37.5813,126.9800],[37.5813,126.9836]],
  'jogye-unhyeon': [[37.5758,126.9820],[37.5758,126.9850]],
  'unhyeon-changdeok': [[37.5772,126.9877],[37.5772,126.9905],[37.5778,126.9928]],
  'changdeok-changgyeong': [[37.5793,126.9942],[37.5790,126.9953]],
  'changgyeong-unhyeon': [[37.5771,126.9960],[37.5769,126.9910],[37.5770,126.9877]],
  'gate-jogye': [[37.5758,126.9790],[37.5758,126.9820]],
  'museum-palace': [[37.5768,126.9770],[37.5784,126.9770]],
  'bukchon-changdeok': [[37.5813,126.9836],[37.5813,126.9874],[37.5772,126.9905],[37.5778,126.9928]],
  'museum-jogye': [[37.5758,126.9753],[37.5758,126.9790],[37.5758,126.9820]],
};
const offsets: readonly Coordinate[] = [[0,0],[0.000045,0.00006],[-0.00004,0.000045],[0,0]];
export function buildSeoulDemo() {
  const rawSignals: {position:{LatLng:string;timestamp:string}}[] = [];
  const visits: {day:number;place:Place;first:number;count:number}[] = [];
  const emit = (day:number, minute:number, coordinate:Coordinate) => {
    const date = `2026-10-${String(day).padStart(2,'0')}`;
    const hh = String(Math.floor(minute/60)).padStart(2,'0');
    const mm = String(minute%60).padStart(2,'0');
    rawSignals.push({position:{LatLng:`${coordinate[0].toFixed(6)}°, ${coordinate[1].toFixed(6)}°`, timestamp:`${date}T${hh}:${mm}:00+09:00`}});
  };
  seoulDays.forEach((places,index) => {
    const day=index+1;
    let minute=600;
    places.forEach((id,stop) => {
      if(stop) {
        const from=places[stop-1]!;
        const waypoints=routes[`${from}-${id}`] ?? [...routes[`${id}-${from}`]!].reverse();
        for(const point of waypoints) { minute+=8; emit(day,minute,point); }
        minute+=8;
      }
      const coordinate=seoulPlaces[id].coordinate;
      visits.push({day,place:id,first:rawSignals.length,count:offsets.length});
      offsets.forEach((offset,i) => emit(day,minute+i*10,[coordinate[0]+offset[0],coordinate[1]+offset[1]]));
      minute+=30;
    });
  });
  return {timeline:{rawSignals},visits};
}
