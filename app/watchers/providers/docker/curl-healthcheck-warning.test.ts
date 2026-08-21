const mockGetCurlHealthcheckOverrideStartupWarning = vi.hoisted(() => vi.fn());

vi.mock('../../../compatibility/curl-healthcheck.js', () => ({
  getCurlHealthcheckOverrideStartupWarning: mockGetCurlHealthcheckOverrideStartupWarning,
}));

import { warnIfCurlHealthcheckOverride } from './curl-healthcheck-warning.js';

describe('warnIfCurlHealthcheckOverride', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('logs the warning when a curl healthcheck override is detected', async () => {
    mockGetCurlHealthcheckOverrideStartupWarning.mockResolvedValue(
      "Container 'drydock-self' has a HEALTHCHECK override that shells out to curl.",
    );
    const log = { warn: vi.fn() };

    await warnIfCurlHealthcheckOverride(log);

    expect(log.warn).toHaveBeenCalledWith(
      "Container 'drydock-self' has a HEALTHCHECK override that shells out to curl.",
    );
  });

  test('does not log when no curl healthcheck override is detected', async () => {
    mockGetCurlHealthcheckOverrideStartupWarning.mockResolvedValue(undefined);
    const log = { warn: vi.fn() };

    await warnIfCurlHealthcheckOverride(log);

    expect(log.warn).not.toHaveBeenCalled();
  });
});
