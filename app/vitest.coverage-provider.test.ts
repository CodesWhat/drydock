const { getProviderMock, readFileMock } = vi.hoisted(() => ({
  getProviderMock: vi.fn(),
  readFileMock: vi.fn(),
}));

vi.mock('@vitest/coverage-v8', () => ({
  default: {
    getProvider: getProviderMock,
  },
}));

vi.mock('node:fs/promises', () => ({
  readFile: readFileMock,
}));

describe('vitest coverage provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('should reset debug read progress per environment', async () => {
    readFileMock.mockImplementation(async (filename: string) =>
      JSON.stringify({ result: { filename } }),
    );

    const project = { name: 'app' };
    const onFinished = vi.fn(async () => {});
    const onFileRead = vi.fn();
    const debugMessages: string[] = [];
    const onDebug = ((message: string) => {
      debugMessages.push(message);
    }) as ((message: string) => void) & { enabled?: boolean };
    onDebug.enabled = true;

    getProviderMock.mockResolvedValue({
      pendingPromises: [],
      coverageFiles: new Map([
        [
          'app',
          {
            node: { 'node.test.ts': '/tmp/node-coverage.json' },
            browser: { 'browser.test.ts': '/tmp/browser-coverage.json' },
          },
        ],
      ]),
      ctx: {
        getProjectByName: vi.fn(() => project),
      },
      options: {
        processingConcurrency: 1,
      },
      toSlices: (filenames: string[]) => filenames.map((filename) => [filename]),
    });

    const coverageProvider = await import('./vitest.coverage-provider.js');
    const provider = await coverageProvider.default.getProvider();

    await provider.readCoverageFiles({
      onFileRead,
      onFinished,
      onDebug,
    });

    expect(debugMessages).toEqual(['Reading coverage results 1/1', 'Reading coverage results 1/1']);
    expect(onFinished).toHaveBeenNthCalledWith(1, project, 'node');
    expect(onFinished).toHaveBeenNthCalledWith(2, project, 'browser');
    expect(onFileRead).toHaveBeenCalledTimes(2);
  });
});
