import {
  getAvailabilityTopic,
  HASS_AVAILABILITY_OFFLINE,
  HASS_AVAILABILITY_ONLINE,
} from './topics.js';

describe('availability topic', () => {
  test('hangs a status topic off the base topic', () => {
    expect(getAvailabilityTopic('dd/container')).toBe('dd/container/status');
  });

  test('uses the online and offline payloads', () => {
    expect(HASS_AVAILABILITY_ONLINE).toBe('online');
    expect(HASS_AVAILABILITY_OFFLINE).toBe('offline');
  });
});
