const { mockDdEnvVars } = vi.hoisted(() => ({
  mockDdEnvVars: {} as Record<string, string | undefined>,
}));

vi.mock('../configuration/index.js', () => ({
  ddEnvVars: mockDdEnvVars,
}));

import {
  getGlobalUpdateConcurrency,
  parseUpdateConcurrencyEnv,
  resolveActionConcurrency,
} from './action-concurrency.js';

describe('parseUpdateConcurrencyEnv', () => {
  test('returns undefined when unset', () => {
    expect(parseUpdateConcurrencyEnv(undefined, 'DD_UPDATE_CONCURRENCY')).toBeUndefined();
  });

  test('returns undefined for an empty string', () => {
    expect(parseUpdateConcurrencyEnv('', 'DD_UPDATE_CONCURRENCY')).toBeUndefined();
  });

  test('parses a valid positive integer', () => {
    expect(parseUpdateConcurrencyEnv('4', 'DD_UPDATE_CONCURRENCY')).toBe(4);
  });

  test('throws for "0" (no unlimited spelling for this knob)', () => {
    expect(() => parseUpdateConcurrencyEnv('0', 'DD_UPDATE_CONCURRENCY')).toThrow(
      'DD_UPDATE_CONCURRENCY must be a positive integer (got "0")',
    );
  });

  test('throws for a negative value', () => {
    expect(() => parseUpdateConcurrencyEnv('-1', 'DD_UPDATE_CONCURRENCY')).toThrow(
      'DD_UPDATE_CONCURRENCY must be a non-negative integer',
    );
  });

  test('throws for a non-integer value', () => {
    expect(() => parseUpdateConcurrencyEnv('abc', 'DD_UPDATE_CONCURRENCY')).toThrow(
      'DD_UPDATE_CONCURRENCY must be a non-negative integer',
    );
  });
});

describe('getGlobalUpdateConcurrency', () => {
  afterEach(() => {
    delete mockDdEnvVars.DD_UPDATE_CONCURRENCY;
  });

  test('defaults to 1 when DD_UPDATE_CONCURRENCY is unset', () => {
    delete mockDdEnvVars.DD_UPDATE_CONCURRENCY;
    expect(getGlobalUpdateConcurrency()).toBe(1);
  });

  test('reflects DD_UPDATE_CONCURRENCY when set', () => {
    mockDdEnvVars.DD_UPDATE_CONCURRENCY = '5';
    expect(getGlobalUpdateConcurrency()).toBe(5);
  });

  test('fails fast for an invalid DD_UPDATE_CONCURRENCY', () => {
    mockDdEnvVars.DD_UPDATE_CONCURRENCY = '0';
    expect(() => getGlobalUpdateConcurrency()).toThrow(
      'DD_UPDATE_CONCURRENCY must be a positive integer (got "0")',
    );
  });

  test('reads ddEnvVars lazily on each call, not a value cached at module load', () => {
    delete mockDdEnvVars.DD_UPDATE_CONCURRENCY;
    expect(getGlobalUpdateConcurrency()).toBe(1);
    mockDdEnvVars.DD_UPDATE_CONCURRENCY = '3';
    expect(getGlobalUpdateConcurrency()).toBe(3);
  });
});

describe('resolveActionConcurrency', () => {
  afterEach(() => {
    delete mockDdEnvVars.DD_UPDATE_CONCURRENCY;
  });

  test('falls back to the global default when no per-action override is configured', () => {
    delete mockDdEnvVars.DD_UPDATE_CONCURRENCY;
    expect(resolveActionConcurrency({})).toBe(getGlobalUpdateConcurrency());
    expect(resolveActionConcurrency({ concurrency: undefined })).toBe(getGlobalUpdateConcurrency());
  });

  test('the per-action override wins over the global default', () => {
    mockDdEnvVars.DD_UPDATE_CONCURRENCY = '1';
    expect(getGlobalUpdateConcurrency()).toBe(1);
    expect(resolveActionConcurrency({ concurrency: 7 })).toBe(7);
  });
});
