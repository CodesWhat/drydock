import {
  _resetRegistryWebhookFreshStateForTests,
  consumeFreshContainerScheduledPollSkip,
  markContainerFreshForScheduledPollSkip,
} from './registry-webhook-fresh.js';

describe('registry-webhook-fresh state', () => {
  beforeEach(() => {
    _resetRegistryWebhookFreshStateForTests();
  });

  test('marks and consumes container freshness exactly once', () => {
    markContainerFreshForScheduledPollSkip('container-1');

    expect(consumeFreshContainerScheduledPollSkip('container-1')).toBe(true);
    expect(consumeFreshContainerScheduledPollSkip('container-1')).toBe(false);
  });

  test('ignores empty container ids', () => {
    markContainerFreshForScheduledPollSkip('');

    expect(consumeFreshContainerScheduledPollSkip('')).toBe(false);
  });
});
