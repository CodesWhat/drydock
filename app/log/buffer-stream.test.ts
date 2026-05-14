import { beforeEach, describe, expect, test, vi } from 'vitest';

const { mockGetLogLevel, mockGetLogFormat, mockGetLogBufferEnabled } = vi.hoisted(() => ({
  mockGetLogLevel: vi.fn(() => 'info'),
  mockGetLogFormat: vi.fn(() => 'json'),
  mockGetLogBufferEnabled: vi.fn(() => true),
}));

vi.mock('../configuration', () => ({
  getLogLevel: mockGetLogLevel,
  getLogFormat: mockGetLogFormat,
  getLogBufferEnabled: mockGetLogBufferEnabled,
}));

/**
 * Tests for the bufferStream Writable defined in log/index.ts.
 * We import the logger module to trigger creation of the Writable,
 * then exercise it by logging through pino, which writes to the stream.
 */
describe('Logger bufferStream integration', () => {
  async function createLoggerAndBuffer() {
    vi.resetModules();
    var [{ default: logger }, { getEntries }] = await Promise.all([
      import('./index.js'),
      import('./buffer.js'),
    ]);
    return { logger, getEntries };
  }

  async function findBufferedEntry(
    getEntries: (options: { tail: number }) => Array<Record<string, unknown>>,
    predicate: (entry: Record<string, unknown>) => boolean,
  ) {
    let found: Record<string, unknown> | undefined;
    await vi.waitFor(() => {
      found = getEntries({ tail: 1000 }).find(predicate);
      expect(found).toBeDefined();
    });
    return found;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetLogLevel.mockReturnValue('info');
    mockGetLogFormat.mockReturnValue('json');
    mockGetLogBufferEnabled.mockReturnValue(true);
  });

  test('should buffer log entries when logger writes', async () => {
    var { logger, getEntries } = await createLoggerAndBuffer();

    // Fill some entries so we can look for a unique message
    var marker = `test-marker-${Date.now()}`;
    logger.info({ component: 'test-comp' }, marker);

    var found = await findBufferedEntry(getEntries, (e) => e.msg === marker);
    expect(found.component).toBe('test-comp');
    expect(found.level).toBe('info');
  });

  test('should default component to logger name when component is not set', async () => {
    var { logger, getEntries } = await createLoggerAndBuffer();
    var marker = `no-comp-${Date.now()}`;
    logger.warn(marker);

    var found = await findBufferedEntry(getEntries, (e) => e.msg === marker);
    // Should fall back to the logger name 'drydock'
    expect(found.component).toBe('drydock');
  });

  test('should map pino numeric levels to labels', async () => {
    var { logger, getEntries } = await createLoggerAndBuffer();
    var marker = `level-test-${Date.now()}`;
    logger.error(marker);

    var found = await findBufferedEntry(getEntries, (e) => e.msg === marker);
    expect(found.level).toBe('error');
  });

  test('should handle entries with empty msg', async () => {
    var { logger, getEntries } = await createLoggerAndBuffer();
    // Logging with only metadata, no message string
    logger.info({ component: 'empty-msg' }, '');

    var found = await findBufferedEntry(getEntries, (e) => e.component === 'empty-msg');
    expect(found.msg).toBe('');
  });

  test('should not buffer log entries when log buffer is disabled', async () => {
    mockGetLogBufferEnabled.mockReturnValue(false);
    var { logger, getEntries } = await createLoggerAndBuffer();
    var marker = `disabled-marker-${Date.now()}`;
    logger.info({ component: 'disabled-comp' }, marker);

    var entries = getEntries({ tail: 1000 });
    expect(entries.find((e) => e.msg === marker)).toBeUndefined();
  });
});
