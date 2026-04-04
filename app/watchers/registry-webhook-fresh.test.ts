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

  test('reset clears pending container freshness', () => {
    markContainerFreshForScheduledPollSkip('container-1');

    _resetRegistryWebhookFreshStateForTests();

    expect(consumeFreshContainerScheduledPollSkip('container-1')).toBe(false);
  });

  test('ignores empty container ids', () => {
    markContainerFreshForScheduledPollSkip('');

    expect(consumeFreshContainerScheduledPollSkip('')).toBe(false);
  });

  test('ignores whitespace-only container ids', () => {
    markContainerFreshForScheduledPollSkip('   ');

    expect(consumeFreshContainerScheduledPollSkip('   ')).toBe(false);
  });

  test('ignores non-string container ids without throwing', () => {
    expect(() => {
      markContainerFreshForScheduledPollSkip(123 as unknown as string);
    }).not.toThrow();
  });
});
