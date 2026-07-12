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

test('logError should use console.error by default and delegate after logger setup', async () => {
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const warnModule = await import('./warn.js');
  const logError = (warnModule as typeof warnModule & { logError?: (message: string) => void })
    .logError;

  expect(logError).toBeTypeOf('function');
  logError?.('default error');
  expect(errorSpy).toHaveBeenCalledWith('default error');

  const logger = { warn: vi.fn(), error: vi.fn() };
  warnModule.setWarnLogger(logger);
  logError?.('custom error');
  expect(logger.error).toHaveBeenCalledWith('custom error');
});
