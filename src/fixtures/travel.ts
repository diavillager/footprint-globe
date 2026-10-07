/** Authored fictional observations. Dates/regions are user-specified, not personal GPS.
 * Coordinates are approximate public-area anchors, NOT verified landmark entrances.
 * No network, source files, real exports, or route API responses are used. */
type Coord = readonly [number, number];
type City = 'vienna' | 'salzburg' | 'annecy' | 'chamonix' | 'bolzano' | 'milan' | 'fukuoka' | 'saga' | 'kumamoto';
type Event = { minute: number; coordinate: Coord; label: string };
export const areas: Record<City, readonly [Coord, Coord, Coord, Coord]> = {
  vienna: [[48.203, 16.365], [48.2083, 16.3738], [48.2065, 16.3652], [48.1915, 16.3809]],
  salzburg: [[47.805, 13.043], [47.8055, 13.0417], [47.798, 13.046], [47.795, 13.047]],
  annecy: [[45.901, 6.124], [45.8992, 6.1292], [45.8984, 6.1268], [45.899, 6.133]],
  chamonix: [[45.922, 6.871], [45.9237, 6.8698], [45.9186, 6.8706], [45.9251, 6.8768]],
  bolzano: [[46.496, 11.356], [46.4983, 11.3548], [46.4992, 11.35], [46.502, 11.358]],
  milan: [[45.467, 9.188], [45.4642, 9.19], [45.47, 9.18], [45.4725, 9.177]],
  // Inland anchor: the former northern anchor made straight synthetic transfers cross the harbor.
  fukuoka: [[33.59, 130.42], [33.593, 130.411], [33.589, 130.41], [33.5838, 130.4005]],
  saga: [[33.265, 130.299], [33.25, 130.3], [33.245, 130.301], [33.252, 130.294]],
  kumamoto: [[32.789, 130.706], [32.806, 130.706], [32.802, 130.705], [32.791, 130.734]],
};
const routes = {
  viennaSalzburg: [[48.205, 15.624], [48.306, 14.286], [48.16, 14.03], [47.95, 13.6]],
  annecyChamonix: [[46.067, 6.41], [46.06, 6.58], [45.935, 6.7]],
  chamonixBolzano: [[45.817, 6.969], [45.737, 7.32], [45.467, 7.88], [45.47, 9.18], [45.44, 10.99], [46.07, 11.12]],
  bolzanoMilan: [[46.07, 11.12], [45.44, 10.99], [45.54, 10.22]],
  fukuokaSaga: [[33.369, 130.519]],
  fukuokaKumamoto: [[33.369, 130.519], [33.312, 130.501], [33.027, 130.49]],
} satisfies Record<string, Coord[]>;
const minute = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
export function distance(a: Coord, b: Coord): number {
  const rad = Math.PI / 180;
  const h = Math.sin((b[0] - a[0]) * rad / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin((b[1] - a[1]) * rad / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
function visit(events: Event[], city: City, index: number, from: string, to: string) {
  const coordinate = areas[city][index]!;
  const label = `${city}:area-${index}`;
  events.push({ minute: minute(from), coordinate, label }, { minute: minute(to), coordinate, label });
}
function transfer(events: Event[], from: City, to: City, route: readonly Coord[], start: string, end: string) {
  const points = [areas[from][0], ...route, areas[to][0]];
  const lengths = points.slice(1).map((p, i) => distance(points[i]!, p));
  const total = lengths.reduce((a, b) => a + b, 0);
  let covered = 0;
  points.forEach((coordinate, i) => {
    if (i) covered += lengths[i - 1]!;
    events.push({ minute: minute(start) + (minute(end) - minute(start)) * covered / total, coordinate, label: `${from}-${to}:fictional-transfer` });
  });
}
function normalDay(city: City, dayIndex: number): Event[] {
  const events: Event[] = [];
  const order = dayIndex % 2 ? [2, 1, 3] : [1, 3, 2];
  visit(events, city, 0, '08:00', '08:30');
  visit(events, city, order[0]!, '09:00', '10:30');
  visit(events, city, order[1]!, '11:00', '12:00');
  visit(events, city, order[2]!, '13:30', '15:00');
  // Nearby separate stop and pass-through, to expose over-merging of consecutive points.
  const anchor = areas[city][order[2]!]!;
  const nearby: Coord = [anchor[0] + 0.00065, anchor[1]];
  events.push({ minute: 930, coordinate: nearby, label: `${city}:nearby-stop` }, { minute: 950, coordinate: nearby, label: `${city}:nearby-stop` });
  events.push({ minute: 970, coordinate: areas[city][order[0]!]!, label: `${city}:pass-through` });
  visit(events, city, 0, '17:00', '18:00');
  return events;
}
function afternoon(events: Event[], city: City) {
  visit(events, city, 1, '14:00', '15:00');
  visit(events, city, 2, '15:30', '16:30');
  visit(events, city, 0, '17:00', '18:00');
}
export const trips = [
  { id: 'austria', start: '2023-08-03', end: '2023-08-10', offset: '+02:00' },
  { id: 'france', start: '2024-07-31', end: '2024-08-06', offset: '+02:00' },
  { id: 'italy', start: '2024-08-06', end: '2024-08-14', offset: '+02:00' },
  { id: 'japan', start: '2025-10-22', end: '2025-10-29', offset: '+09:00' },
] as const;
export type TripId = typeof trips[number]['id'];
function dayPlan(id: TripId, date: string, dayIndex: number): Event[] {
  const events: Event[] = [];
  if (id === 'austria' && date === '2023-08-08') {
    visit(events, 'vienna', 0, '06:30', '07:00');
    transfer(events, 'vienna', 'salzburg', routes.viennaSalzburg, '07:00', '10:00');
    visit(events, 'salzburg', 1, '10:30', '12:00');
    visit(events, 'salzburg', 2, '13:00', '14:30');
    visit(events, 'salzburg', 3, '15:00', '16:30');
    visit(events, 'salzburg', 0, '17:00', '18:00');
    transfer(events, 'salzburg', 'vienna', [...routes.viennaSalzburg].reverse(), '18:00', '21:00');
    visit(events, 'vienna', 0, '21:00', '21:30');
  } else if (id === 'france' && date === '2024-08-03') {
    visit(events, 'annecy', 0, '08:00', '09:00');
    transfer(events, 'annecy', 'chamonix', routes.annecyChamonix, '09:00', '11:40');
    visit(events, 'chamonix', 0, '11:40', '12:30'); afternoon(events, 'chamonix');
  } else if (id === 'france' && date === '2024-08-06') {
    visit(events, 'chamonix', 0, '07:00', '08:00');
  } else if (id === 'italy' && date === '2024-08-06') {
    transfer(events, 'chamonix', 'bolzano', routes.chamonixBolzano, '08:00', '16:30');
    visit(events, 'bolzano', 0, '16:30', '18:00');
  } else if (id === 'italy' && date === '2024-08-13') {
    visit(events, 'bolzano', 0, '08:00', '09:00');
    transfer(events, 'bolzano', 'milan', routes.bolzanoMilan, '09:00', '13:00'); afternoon(events, 'milan');
  } else if (id === 'japan' && date === '2025-10-24') {
    visit(events, 'fukuoka', 0, '08:00', '09:00');
    transfer(events, 'fukuoka', 'saga', routes.fukuokaSaga, '09:00', '10:00');
    visit(events, 'saga', 1, '10:30', '12:00');
    visit(events, 'saga', 2, '13:00', '14:30');
    visit(events, 'saga', 3, '15:00', '16:30');
    visit(events, 'saga', 0, '17:00', '18:00');
    transfer(events, 'saga', 'fukuoka', [...routes.fukuokaSaga].reverse(), '18:00', '19:00');
  } else if (id === 'japan' && (date === '2025-10-25' || date === '2025-10-28')) {
    const outbound = date === '2025-10-25';
    const from = outbound ? 'fukuoka' : 'kumamoto', to = outbound ? 'kumamoto' : 'fukuoka';
    visit(events, from, 0, '08:00', '09:00');
    transfer(events, from, to, outbound ? routes.fukuokaKumamoto : [...routes.fukuokaKumamoto].reverse(), '09:00', '10:15');
    visit(events, to, 0, '10:15', '12:30'); afternoon(events, to);
  } else {
    const city: City = id === 'austria' ? 'vienna' : id === 'france' ? (date < '2024-08-03' ? 'annecy' : 'chamonix') :
      id === 'italy' ? (date < '2024-08-13' ? 'bolzano' : 'milan') : (date >= '2025-10-25' && date < '2025-10-28' ? 'kumamoto' : 'fukuoka');
    return normalDay(city, dayIndex);
  }
  return events;
}
export function buildTrip(id: TripId) {
  const trip = trips.find(item => item.id === id)!;
  let seed = trips.indexOf(trip) + 271;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const rawSignals: { position: { LatLng: string; timestamp: string } }[] = [];
  const itinerary: { date: string; events: Event[] }[] = [];
  const localStamp = (ms: number) => new Date(ms + Number(trip.offset.slice(1, 3)) * 3600000).toISOString().slice(0, 19) + trip.offset;
  function emit(ms: number, coordinate: Coord, jitter = false) {
    const previous = rawSignals.at(-1);
    if (previous && Date.parse(previous.position.timestamp) >= ms) return;
    const lat = coordinate[0] + (jitter ? (random() - .5) * .00008 : 0);
    const lon = coordinate[1] + (jitter ? (random() - .5) * .00008 : 0);
    rawSignals.push({ position: { LatLng: `${lat.toFixed(7)}°, ${lon.toFixed(7)}°`, timestamp: localStamp(ms) } });
  }
  for (let day = Date.parse(trip.start + 'T00:00:00Z'), index = 0; day <= Date.parse(trip.end + 'T00:00:00Z'); day += 86400000, index++) {
    const date = new Date(day).toISOString().slice(0, 10);
    const events = dayPlan(id, date, index);
    itinerary.push({ date, events });
    const midnight = Date.parse(`${date}T00:00:00${trip.offset}`);
    for (let i = 0; i < events.length - 1; i++) {
      const a = events[i]!, b = events[i + 1]!;
      const start = midnight + Math.round(a.minute * 60) * 1000, end = midnight + Math.round(b.minute * 60) * 1000;
      if (end < start) throw new Error('SYNTHETIC_SCHEDULE_ORDER');
      const stationary = distance(a.coordinate, b.coordinate) < .01;
      emit(start, a.coordinate);
      for (let ms = start + 120000; ms < end; ms += 120000) {
        const fraction = (ms - start) / (end - start);
        emit(ms, [a.coordinate[0] + (b.coordinate[0] - a.coordinate[0]) * fraction,
          a.coordinate[1] + (b.coordinate[1] - a.coordinate[1]) * fraction], stationary);
      }
      emit(end, b.coordinate);
    }
  }
  return { timeline: { rawSignals }, itinerary };
}
