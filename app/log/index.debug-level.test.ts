const { mockAddEntry } = vi.hoisted(() => ({
  mockAddEntry: vi.fn(),
}));

vi.mock('../configuration', () => ({
  getLogLevel: vi.fn(() => 'debug'),
  getLogFormat: vi.fn(() => 'json'),
  getLogBufferEnabled: vi.fn(() => true),
}));

vi.mock('./buffer.js', () => ({
  addEntry: mockAddEntry,
}));

vi.mock('./warn.js', () => ({
  setWarnLogger: vi.fn(),
}));

describe('Logger with debug level', () => {
  test('should propagate debug level to multistream destinations', async () => {
    const log = (await import('./index.js')).default;

    expect(log.level).toBe('debug');

    log.debug({ component: 'test' }, 'debug-level-message');

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockAddEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'debug',
        msg: 'debug-level-message',
      }),
    );
  });

  test('should deliver info messages when level is debug', async () => {
    const log = (await import('./index.js')).default;

    log.info({ component: 'test' }, 'info-level-message');

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockAddEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'info',
        msg: 'info-level-message',
      }),
    );
  });
});
