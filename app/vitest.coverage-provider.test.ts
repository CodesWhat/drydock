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

  test('should retry coverage file reads when the file is temporarily missing', async () => {
    readFileMock
      .mockRejectedValueOnce(Object.assign(new Error('missing file'), { code: 'ENOENT' }))
      .mockResolvedValueOnce('{"result":[]}');

    const { readCoverageFileWithRetry } = await import('./vitest.coverage-provider.shared.js');

    await expect(readCoverageFileWithRetry('/tmp/coverage/in.json')).resolves.toBe('{"result":[]}');
    expect(readFileMock).toHaveBeenCalledTimes(2);
  });

  test('should throw when coverage file writes exhaust all retries', async () => {
    writeFileMock.mockRejectedValue(
      Object.assign(new Error('missing directory'), { code: 'ENOENT' }),
    );
    mkdirMock.mockResolvedValue(undefined);

    const { writeCoverageFileWithRetry } = await import('./vitest.coverage-provider.shared.js');

    await expect(writeCoverageFileWithRetry('/tmp/coverage/out.json', '{}')).rejects.toThrow(
      'missing directory',
    );
  });

  test('should throw when coverage file reads exhaust all retries', async () => {
    readFileMock.mockRejectedValue(Object.assign(new Error('missing file'), { code: 'ENOENT' }));

    const { readCoverageFileWithRetry } = await import('./vitest.coverage-provider.shared.js');

    await expect(readCoverageFileWithRetry('/tmp/coverage/in.json')).rejects.toThrow(
      'missing file',
    );
  });

  test('should keep waiting when new writes appear during the settle window', async () => {
    const { waitForPendingWrites } = await import('./vitest.coverage-provider.shared.js');
    const provider = {
      pendingPromises: [Promise.resolve()] as Promise<unknown>[],
    };

    setTimeout(() => {
      provider.pendingPromises.push(Promise.resolve());
    }, 0);

    await waitForPendingWrites(provider);

    expect(provider.pendingPromises).toHaveLength(0);
  });

  test('should create the coverage directory when no base clean callback is provided', async () => {
    const { resetCoverageProvider } = await import('./vitest.coverage-provider.shared.js');
    const provider = {
      pendingPromises: [],
      coverageFiles: new Map([['app', { node: { 'suite.test.ts': '/tmp/coverage/out.json' } }]]),
      coverageFilesDirectory: '/tmp/coverage/.tmp',
      options: {
        processingConcurrency: 1,
      },
    } as any;
    const onReset = vi.fn();

    await resetCoverageProvider(provider, undefined, true, onReset);

    expect(onReset).toHaveBeenCalledTimes(1);
    expect(mkdirMock).toHaveBeenCalledWith(
      expect.stringMatching(/^\/tmp\/coverage\/\.tmp-\d+-\d+-[a-f0-9]+$/),
      { recursive: true },
    );
    expect(provider.coverageFiles.size).toBe(0);
    expect(provider.pendingPromises).toHaveLength(0);
  });

  test('should delegate to the base clean callback when one is provided', async () => {
    const { resetCoverageProvider } = await import('./vitest.coverage-provider.shared.js');
    const provider = {
      pendingPromises: [],
      coverageFiles: new Map(),
      coverageFilesDirectory: '/tmp/coverage/.tmp',
      options: {
        processingConcurrency: 1,
      },
    } as any;
    const originalClean = vi.fn().mockResolvedValue(undefined);
    const onReset = vi.fn();

    await resetCoverageProvider(provider, originalClean, true, onReset);

    expect(onReset).toHaveBeenCalledTimes(1);
    expect(originalClean).toHaveBeenCalledWith(true);
    expect(mkdirMock).not.toHaveBeenCalled();
  });

  test('should reset coverage state without recreating a directory when none is configured', async () => {
    const { resetCoverageProvider } = await import('./vitest.coverage-provider.shared.js');
    const provider = {
      pendingPromises: [Promise.resolve()],
      coverageFiles: new Map([['app', { node: { 'suite.test.ts': '/tmp/coverage/out.json' } }]]),
      options: {
        processingConcurrency: 1,
      },
    } as any;
    const onReset = vi.fn();

    await resetCoverageProvider(provider, undefined, true, onReset);

    expect(onReset).toHaveBeenCalledTimes(1);
    expect(mkdirMock).not.toHaveBeenCalled();
    expect(provider.coverageFiles.size).toBe(0);
    expect(provider.pendingPromises).toHaveLength(0);
  });

  test('should skip recording when suite coverage is missing', async () => {
    const { createCoverageAfterSuiteRunHandler } = await import(
      './vitest.coverage-provider.shared.js'
    );
    const provider = {
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
    } as any;
    const writeErrors: unknown[] = [];
    const coveragePayloads = new Map<string, string>();

    const handler = createCoverageAfterSuiteRunHandler(
      provider,
      writeErrors,
      coveragePayloads,
      () => '/tmp/coverage/.tmp/coverage-0.json',
    );

    handler({
      coverage: undefined,
      environment: 'node',
      projectName: 'app',
      testFiles: ['suite.test.ts'],
    });

    expect(provider.coverageFiles.size).toBe(0);
    expect(coveragePayloads.size).toBe(0);
    expect(writeErrors).toHaveLength(0);
  });

  test('should record write failures from coverage persistence', async () => {
    writeFileMock.mockRejectedValueOnce(new Error('write failed'));
    mkdirMock.mockResolvedValue(undefined);

    const { createCoverageAfterSuiteRunHandler } = await import(
      './vitest.coverage-provider.shared.js'
    );
    const provider = {
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
    } as any;
    const writeErrors: unknown[] = [];
    const coveragePayloads = new Map<string, string>();

    const handler = createCoverageAfterSuiteRunHandler(
      provider,
      writeErrors,
      coveragePayloads,
      () => '/tmp/coverage/.tmp/coverage-0.json',
    );

    handler({
      coverage: { result: [] },
      environment: 'node',
      projectName: 'app',
      testFiles: ['suite.test.ts'],
    });

    await Promise.all(provider.pendingPromises);

    expect(writeErrors).toHaveLength(1);
    expect(writeErrors[0]).toBeInstanceOf(Error);
    expect((writeErrors[0] as Error).message).toBe('write failed');
  });

  test('should throw accumulated write errors before reading coverage files', async () => {
    const { createCoverageReadFilesHandler } = await import('./vitest.coverage-provider.shared.js');
    const provider = {
      pendingPromises: [],
      coverageFiles: new Map([
        [
          'app',
          {
            node: {
              'suite.test.ts': '/tmp/coverage/.tmp/coverage-0.json',
            },
          },
        ],
      ]),
      ctx: {
        getProjectByName: vi.fn(),
      },
      options: {
        processingConcurrency: 1,
      },
      toSlices: (filenames: string[]) => filenames.map((filename) => [filename]),
    } as any;
    const readCoverageFile = vi.fn();
    const handler = createCoverageReadFilesHandler(
      provider,
      [new Error('write failed')],
      readCoverageFile,
    );

    await expect(
      handler({
        onFileRead: vi.fn(),
        onFinished: vi.fn(async () => {}),
        onDebug: (() => {}) as ((message: string) => void) & { enabled?: boolean },
      }),
    ).rejects.toThrow('write failed');
    expect(readCoverageFile).not.toHaveBeenCalled();
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
