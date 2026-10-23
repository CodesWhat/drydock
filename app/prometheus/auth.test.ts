import * as auth from './auth.js';

beforeEach(() => {
  auth._resetAuthPrometheusStateForTests();
});

test('auth prometheus metrics should be properly configured', () => {
  auth.init();

  const loginCounter = auth.getAuthLoginCounter();
  const loginDuration = auth.getAuthLoginDurationHistogram();
  const usernameMismatchCounter = auth.getAuthUsernameMismatchCounter();
  const apiKeyFailureCounter = auth.getAuthApiKeyFailureCounter();
  const accountLockedGauge = auth.getAuthAccountLockedGauge();
  const ipLockedGauge = auth.getAuthIpLockedGauge();

  expect(loginCounter?.name).toBe('drydock_auth_login_total');
  expect(loginCounter?.labelNames).toEqual(['outcome', 'provider']);

  expect(loginDuration?.name).toBe('drydock_auth_login_duration_seconds');
  expect(loginDuration?.labelNames).toEqual(['outcome', 'provider']);

  expect(usernameMismatchCounter?.name).toBe('drydock_auth_username_mismatch_total');
  expect(usernameMismatchCounter?.labelNames).toEqual([]);

  expect(apiKeyFailureCounter?.name).toBe('drydock_auth_api_key_failure_total');
  expect(apiKeyFailureCounter?.labelNames).toEqual([]);

  expect(accountLockedGauge?.name).toBe('drydock_auth_account_locked_total');
  expect(accountLockedGauge?.labelNames).toEqual([]);

  expect(ipLockedGauge?.name).toBe('drydock_auth_ip_locked_total');
  expect(ipLockedGauge?.labelNames).toEqual([]);

  expect(auth.getAuthAccountLockoutCounter()?.name).toBe('drydock_auth_account_lockout_total');
  expect(auth.getAuthAccountLockoutCounter()?.labelNames).toEqual(['provider']);
  expect(auth.getAuthIpLockoutCounter()?.name).toBe('drydock_auth_ip_lockout_total');
  expect(auth.getAuthIpLockoutCounter()?.labelNames).toEqual(['provider']);
});

test('helpers should no-op before metrics initialization', () => {
  expect(() => auth.recordAuthLogin('invalid', 'basic')).not.toThrow();
  expect(() => auth.observeAuthLoginDuration('invalid', 'basic', 0.123)).not.toThrow();
  expect(() => auth.recordAuthUsernameMismatch()).not.toThrow();
  expect(() => auth.recordAuthApiKeyFailure()).not.toThrow();
  expect(() => auth.setAuthAccountLockedTotal(1)).not.toThrow();
  expect(() => auth.setAuthIpLockedTotal(2)).not.toThrow();
  expect(() => auth.recordAuthAccountLockout('basic')).not.toThrow();
  expect(() => auth.recordAuthIpLockout('basic')).not.toThrow();
});

test('lockout helpers should increment the labelled counters', () => {
  auth.init();

  const accountSpy = vi.spyOn(
    auth.getAuthAccountLockoutCounter() as { inc: (labels: unknown) => void },
    'inc',
  );
  const ipSpy = vi.spyOn(
    auth.getAuthIpLockoutCounter() as { inc: (labels: unknown) => void },
    'inc',
  );

  auth.recordAuthAccountLockout('basic');
  auth.recordAuthIpLockout('basic');

  expect(accountSpy).toHaveBeenCalledWith({ provider: 'basic' });
  expect(ipSpy).toHaveBeenCalledWith({ provider: 'basic' });
});

test('helpers should record values after initialization', () => {
  auth.init();

  const loginCounter = auth.getAuthLoginCounter();
  const loginDuration = auth.getAuthLoginDurationHistogram();
  const usernameMismatchCounter = auth.getAuthUsernameMismatchCounter();
  const apiKeyFailureCounter = auth.getAuthApiKeyFailureCounter();
  const accountLockedGauge = auth.getAuthAccountLockedGauge();
  const ipLockedGauge = auth.getAuthIpLockedGauge();

  const loginCounterIncSpy = vi.spyOn(loginCounter as { inc: (labels: unknown) => void }, 'inc');
  const loginDurationObserveSpy = vi.spyOn(
    loginDuration as { observe: (labels: unknown, value: number) => void },
    'observe',
  );
  const usernameMismatchCounterIncSpy = vi.spyOn(
    usernameMismatchCounter as { inc: () => void },
    'inc',
  );
  const apiKeyFailureCounterIncSpy = vi.spyOn(apiKeyFailureCounter as { inc: () => void }, 'inc');
  const accountLockedGaugeSetSpy = vi.spyOn(
    accountLockedGauge as { set: (value: number) => void },
    'set',
  );
  const ipLockedGaugeSetSpy = vi.spyOn(ipLockedGauge as { set: (value: number) => void }, 'set');

  auth.recordAuthLogin('success', 'basic');
  auth.observeAuthLoginDuration('success', 'basic', 0.042);
  auth.recordAuthUsernameMismatch();
  auth.recordAuthApiKeyFailure();
  auth.setAuthAccountLockedTotal(3);
  auth.setAuthIpLockedTotal(5);

  expect(loginCounterIncSpy).toHaveBeenCalledWith({ outcome: 'success', provider: 'basic' });
  expect(loginDurationObserveSpy).toHaveBeenCalledWith(
    { outcome: 'success', provider: 'basic' },
    0.042,
  );
  expect(usernameMismatchCounterIncSpy).toHaveBeenCalledTimes(1);
  expect(apiKeyFailureCounterIncSpy).toHaveBeenCalledTimes(1);
  expect(accountLockedGaugeSetSpy).toHaveBeenCalledWith(3);
  expect(ipLockedGaugeSetSpy).toHaveBeenCalledWith(5);
});

test('init should replace existing auth metrics when called twice', () => {
  auth.init();

  const firstLoginCounter = auth.getAuthLoginCounter();
  const firstLoginDuration = auth.getAuthLoginDurationHistogram();
  const firstUsernameMismatchCounter = auth.getAuthUsernameMismatchCounter();
  const firstApiKeyFailureCounter = auth.getAuthApiKeyFailureCounter();
  const firstAccountLockedGauge = auth.getAuthAccountLockedGauge();
  const firstIpLockedGauge = auth.getAuthIpLockedGauge();
  const firstAccountLockoutCounter = auth.getAuthAccountLockoutCounter();
  const firstIpLockoutCounter = auth.getAuthIpLockoutCounter();

  auth.init();

  expect(auth.getAuthLoginCounter()).toBeDefined();
  expect(auth.getAuthLoginCounter()).not.toBe(firstLoginCounter);
  expect(auth.getAuthLoginDurationHistogram()).not.toBe(firstLoginDuration);
  expect(auth.getAuthUsernameMismatchCounter()).not.toBe(firstUsernameMismatchCounter);
  expect(auth.getAuthApiKeyFailureCounter()).not.toBe(firstApiKeyFailureCounter);
  expect(auth.getAuthAccountLockedGauge()).not.toBe(firstAccountLockedGauge);
  expect(auth.getAuthIpLockedGauge()).not.toBe(firstIpLockedGauge);
  expect(auth.getAuthAccountLockoutCounter()).not.toBe(firstAccountLockoutCounter);
  expect(auth.getAuthIpLockoutCounter()).not.toBe(firstIpLockoutCounter);
});
