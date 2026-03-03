import { beforeEach, expect, test, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

test('logWarn should use console.warn by default', async () => {
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const { logWarn } = await import('./warn.js');

  logWarn('default warning');

  expect(warnSpy).toHaveBeenCalledWith('default warning');
});

test('setWarnLogger should delegate to provided logger', async () => {
  const { logWarn, setWarnLogger } = await import('./warn.js');
  const logger = { warn: vi.fn() };

  setWarnLogger(logger);
  logWarn('custom warning');

  expect(logger.warn).toHaveBeenCalledWith('custom warning');
});
