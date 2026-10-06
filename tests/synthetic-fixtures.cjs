'use strict';
// These fixtures are authored from scratch. They contain no user's export.
const times = [
  '2022-03-01T09:00:00.123+09:00', '2022-03-01T10:00:00.123+09:00',
  '2022-03-01T11:00:00.123+09:00', '2022-03-01T12:00:00.123+09:00'
];
const points = ['11.250000°, 42.500000°', '12.750000°, 43.250000°'];
function modern() {
  const visit = (point, id, startTime, endTime) => ({ startTime, endTime,
    startTimeTimezoneUtcOffsetMinutes: 540, endTimeTimezoneUtcOffsetMinutes: 540,
    visit: { hierarchyLevel: 0, probability: 0.95, topCandidate: {
      placeId: id, semanticType: 'HOME', placeLocation: { latLng: point },
      name: 'FICTIONAL_PLACE_CANARY', address: 'FICTIONAL_ADDRESS_CANARY'
    } }
  });
  return { semanticSegments: [
    visit(points[0], 'FICTIONAL_ID_A', times[0], times[1]),
    { startTime: times[1], endTime: times[2], activity: {
      start: { latLng: points[0] }, end: { latLng: points[1] }, distanceMeters: 1234,
      topCandidate: { type: 'WALKING', probability: 0.9 }
    } },
    { startTime: times[1], endTime: times[2], timelinePath: [
      { point: points[0], time: times[1] }, { point: '12.000000°, 43.000000°', time: '2022-03-01T10:30:00.123+09:00' },
      { point: points[1], time: times[2] }
    ] },
    visit(points[1], 'FICTIONAL_ID_B', times[2], times[3]),
    visit(points[0], 'FICTIONAL_ID_A', times[2], times[3])
  ] };
}
function deviceArray() {
  const data = modern().semanticSegments;
  const geo = p => 'geo:' + p.replaceAll('°', '').replaceAll(' ', '');
  for (const record of data) {
    if (record.visit) record.visit.topCandidate.placeLocation = geo(record.visit.topCandidate.placeLocation.latLng);
    if (record.activity) {
      record.activity.start = geo(record.activity.start.latLng);
      record.activity.end = geo(record.activity.end.latLng);
    }
    if (record.timelinePath) record.timelinePath = record.timelinePath.map((p, i) => ({ point: geo(p.point), durationMinutesOffset: String(i * 30) }));
  }
  return data;
}
function legacy() {
  const location = (lat, lng) => ({ latitudeE7: lat * 1e7, longitudeE7: lng * 1e7,
    placeId: 'FICTIONAL_LEGACY_ID', name: 'FICTIONAL_LEGACY_PLACE', address: 'FICTIONAL_LEGACY_ADDRESS' });
  const duration = (a, b) => ({ startTimestamp: times[a], endTimestamp: times[b],
    startTimestampMs: String(Date.parse(times[a])), endTimestampMs: String(Date.parse(times[b])) });
  return { timelineObjects: [
    { placeVisit: { location: location(11.25, 42.5), duration: duration(0, 1), centerLatE7: 112500000, centerLngE7: 425000000, visitConfidence: 98 } },
    { activitySegment: { startLocation: location(11.25, 42.5), endLocation: location(12.75, 43.25), duration: duration(1, 2),
      activityType: 'WALKING', confidence: 'HIGH', distance: 1234,
      activities: [{ activityType: 'WALKING', probability: 99 }],
      waypointPath: { waypoints: [{ latE7: 112500000, lngE7: 425000000 }, { latE7: 127500000, lngE7: 432500000 }] },
      simplifiedRawPath: { points: [{ latE7: 112500000, lngE7: 425000000, timestamp: times[1] }, { latE7: 127500000, lngE7: 432500000, timestamp: times[2] }] }
    } },
    { placeVisit: { location: location(12.75, 43.25), duration: duration(2, 3) } }
  ] };
}
module.exports = { modern, deviceArray, legacy };
