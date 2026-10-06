'use strict';
// Entirely authored synthetic data; never copied from a user's export.
function rawSignals() {
  return { rawSignals: [
    { wifiScan: { deliveryTime: '2022-03-01T09:00:00+09:00', devices: [{ mac: 'FICTIONAL_MAC', ssid: 'FICTIONAL_SSID' }] } },
    { position: { LatLng: '11.2500000°, 42.5000000°', timestamp: '2022-03-01T09:00:00.123+09:00', accuracyMeters: 22,
      altitudeMeters: 123.45, speedMetersPerSecond: 6.78, source: 'FICTIONAL_SOURCE' } },
    { activityRecord: { timestamp: '2022-03-01T09:00:01.123+09:00', probableActivities: [{ type: 'FICTIONAL_ACTIVITY', confidence: 98 }] } },
    { position: { LatLng: '12.7500000°, 43.2500000°', timestamp: '2022-03-01T09:03:00.123+09:00', accuracyMeters: 33 } },
    { position: { LatLng: '11.2500000°, 42.5000000°', timestamp: '2022-03-01T09:04:00.123+09:00' } }
  ], userLocationProfile: { frequentPlaces: [{ name: 'FICTIONAL_HOME', placeId: 'FICTIONAL_ID', location: '11.2500000°, 42.5000000°' }] } };
}
module.exports = { rawSignals };
