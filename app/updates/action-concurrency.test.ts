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
  test('defaults to 1 when DD_UPDATE_CONCURRENCY is unset', () => {
    // Module under test was loaded with no env var set, so the module-level
    // default applies.
    expect(getGlobalUpdateConcurrency()).toBe(1);
  });

  test('reflects DD_UPDATE_CONCURRENCY after a dynamic import with it set', async () => {
    const prev = process.env.DD_UPDATE_CONCURRENCY;
    process.env.DD_UPDATE_CONCURRENCY = '5';
    vi.resetModules();
    try {
      const mod = await import('./action-concurrency.js?concurrency5');
      expect(mod.getGlobalUpdateConcurrency()).toBe(5);
    } finally {
      if (prev === undefined) {
        delete process.env.DD_UPDATE_CONCURRENCY;
      } else {
        process.env.DD_UPDATE_CONCURRENCY = prev;
      }
      vi.resetModules();
    }
  });

  test('fails fast at import time for an invalid DD_UPDATE_CONCURRENCY', async () => {
    const prev = process.env.DD_UPDATE_CONCURRENCY;
    process.env.DD_UPDATE_CONCURRENCY = '0';
    vi.resetModules();
    try {
      await expect(import('./action-concurrency.js?concurrency-invalid')).rejects.toThrow(
        'DD_UPDATE_CONCURRENCY must be a positive integer (got "0")',
      );
    } finally {
      if (prev === undefined) {
        delete process.env.DD_UPDATE_CONCURRENCY;
      } else {
        process.env.DD_UPDATE_CONCURRENCY = prev;
      }
      vi.resetModules();
    }
  });
});

describe('resolveActionConcurrency', () => {
  test('falls back to the global default when no per-action override is configured', () => {
    expect(resolveActionConcurrency({})).toBe(getGlobalUpdateConcurrency());
    expect(resolveActionConcurrency({ concurrency: undefined })).toBe(getGlobalUpdateConcurrency());
  });

  test('the per-action override wins over the global default', async () => {
    const prev = process.env.DD_UPDATE_CONCURRENCY;
    process.env.DD_UPDATE_CONCURRENCY = '1';
    vi.resetModules();
    try {
      const mod = await import('./action-concurrency.js?override-wins');
      expect(mod.getGlobalUpdateConcurrency()).toBe(1);
      expect(mod.resolveActionConcurrency({ concurrency: 7 })).toBe(7);
    } finally {
      if (prev === undefined) {
        delete process.env.DD_UPDATE_CONCURRENCY;
      } else {
        process.env.DD_UPDATE_CONCURRENCY = prev;
      }
      vi.resetModules();
    }
  });
});
