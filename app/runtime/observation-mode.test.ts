import { enableObservationMode, isObservationMode } from './observation-mode.js';

describe('observation mode', () => {
  test('is off until enabled', () => {
    expect(isObservationMode()).toBe(false);
    enableObservationMode();
    expect(isObservationMode()).toBe(true);
  });
});
