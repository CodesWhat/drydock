const { getProviderMock, readFileMock, mkdirMock, writeFileMock } = vi.hoisted(() => ({
  getProviderMock: vi.fn(),
  readFileMock: vi.fn(),
  mkdirMock: vi.fn(),
  writeFileMock: vi.fn(),
}));

vi.mock('@vitest/coverage-v8', () => ({
  default: {
    getProvider: getProviderMock,
  },
}));

vi.mock('node:fs/promises', () => ({
  readFile: readFileMock,
  mkdir: mkdirMock,
  writeFile: writeFileMock,
}));

describe('vitest coverage provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
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

  test('should retry coverage file writes when the temp directory disappears', async () => {
    writeFileMock
      .mockRejectedValueOnce(Object.assign(new Error('missing directory'), { code: 'ENOENT' }))
      .mockResolvedValueOnce(undefined);
    mkdirMock.mockResolvedValue(undefined);

    getProviderMock.mockResolvedValue({
      pendingPromises: [],
      coverageFiles: new Map(),
      coverageFilesDirectory: '/tmp/coverage/.tmp',
      ctx: {
        getProjectByName: vi.fn(),
      },
      options: {
        processingConcurrency: 1,
      },
      toSlices: (filenames: string[]) => filenames.map((filename) => [filename]),
    });

    const coverageProvider = await import('./vitest.coverage-provider.js');
    const provider = await coverageProvider.default.getProvider();

    provider.onAfterSuiteRun({
      coverage: { result: [] },
      environment: 'node',
      projectName: '',
      testFiles: ['suite.test.ts'],
    });

    await Promise.all(provider.pendingPromises);

    expect(mkdirMock).toHaveBeenCalledWith(
      expect.stringMatching(/^\/tmp\/coverage\/\.tmp-\d+-\d+-[a-f0-9]+$/),
      { recursive: true },
    );
    expect(writeFileMock).toHaveBeenCalledTimes(2);
    expect(writeFileMock).toHaveBeenCalledWith(
      expect.stringMatching(/^\/tmp\/coverage\/\.tmp-\d+-\d+-[a-f0-9]+\/coverage-\d+\.json$/),
      JSON.stringify({ result: [] }),
      'utf-8',
    );
    const projectEntry = provider.coverageFiles.get(Symbol.for('default-project'));
    expect(projectEntry?.node?.['suite.test.ts']).toEqual(
      expect.stringMatching(/^\/tmp\/coverage\/\.tmp-\d+-\d+-[a-f0-9]+\/coverage-\d+\.json$/),
    );
  });

  test('should isolate coverage temp files per provider instance', async () => {
    getProviderMock.mockResolvedValue({
      pendingPromises: [],
      coverageFiles: new Map(),
      coverageFilesDirectory: '/tmp/coverage/.tmp',
      ctx: {
        getProjectByName: vi.fn(),
      },
      options: {
        reportsDirectory: '/tmp/coverage',
        processingConcurrency: 1,
      },
      toSlices: (filenames: string[]) => filenames.map((filename) => [filename]),
    });

    const coverageProvider = await import('./vitest.coverage-provider.js');
    const provider = await coverageProvider.default.getProvider();

    expect(provider.coverageFilesDirectory).toEqual(
      expect.stringMatching(/^\/tmp\/coverage\/\.tmp-\d+-\d+-[a-f0-9]+$/),
    );
  });

  test('should isolate coverage temp files even when reportsDirectory is unset', async () => {
    getProviderMock.mockResolvedValue({
      pendingPromises: [],
      coverageFiles: new Map(),
      coverageFilesDirectory: '/tmp/coverage/.tmp',
      ctx: {
        getProjectByName: vi.fn(),
      },
      options: {
        processingConcurrency: 1,
      },
      toSlices: (filenames: string[]) => filenames.map((filename) => [filename]),
    });

    const coverageProvider = await import('./vitest.coverage-provider.js');
    const provider = await coverageProvider.default.getProvider();

    expect(provider.coverageFilesDirectory).toEqual(
      expect.stringMatching(/^\/tmp\/coverage\/\.tmp-\d+-\d+-[a-f0-9]+$/),
    );
  });

  test('should read coverage from in-memory fallback when temp file disappears', async () => {
    writeFileMock.mockResolvedValue(undefined);
    mkdirMock.mockResolvedValue(undefined);
    readFileMock.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const project = { name: 'app' };
    const onFinished = vi.fn(async () => {});
    const onFileRead = vi.fn();
    const onDebug = (() => {}) as ((message: string) => void) & { enabled?: boolean };

    getProviderMock.mockResolvedValue({
      pendingPromises: [],
      coverageFiles: new Map(),
      coverageFilesDirectory: '/tmp/coverage/.tmp',
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

    provider.onAfterSuiteRun({
      coverage: { result: [{ url: 'file:///app.ts' }] },
      environment: 'node',
      projectName: 'app',
      testFiles: ['app.test.ts'],
    });

    await Promise.all(provider.pendingPromises);

    await provider.readCoverageFiles({ onFileRead, onFinished, onDebug });

    expect(onFileRead).toHaveBeenCalledWith({ result: [{ url: 'file:///app.ts' }] });
    expect(readFileMock).not.toHaveBeenCalled();
    expect(onFinished).toHaveBeenCalledWith(project, 'node');
  });

  test('clean should re-isolate the temp directory before delegating to the base provider', async () => {
    const cleanMock = vi.fn(async () => {});
    getProviderMock.mockResolvedValue({
      pendingPromises: [],
      coverageFiles: new Map(),
      coverageFilesDirectory: '/tmp/coverage/.tmp',
      clean: cleanMock,
      ctx: {
        getProjectByName: vi.fn(),
      },
      options: {
        reportsDirectory: '/tmp/coverage',
        processingConcurrency: 1,
      },
      toSlices: (filenames: string[]) => filenames.map((filename) => [filename]),
    });

    const coverageProvider = await import('./vitest.coverage-provider.js');
    const provider = await coverageProvider.default.getProvider();
    const firstCoverageDirectory = provider.coverageFilesDirectory;

    await provider.clean(true);

    expect(cleanMock).toHaveBeenCalledWith(true);
    expect(provider.coverageFilesDirectory).not.toBe(firstCoverageDirectory);
    expect(provider.coverageFilesDirectory).toEqual(
      expect.stringMatching(/^\/tmp\/coverage\/\.tmp-\d+-\d+-[a-f0-9]+$/),
    );
  });
});
