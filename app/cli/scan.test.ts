import type { Container, ContainerReport } from '../model/container.js';

const mockStoreInit = vi.hoisted(() => vi.fn());
const mockInitObservationOnly = vi.hoisted(() => vi.fn());
const mockDeregisterObservationOnly = vi.hoisted(() => vi.fn());
const mockGetState = vi.hoisted(() => vi.fn());

vi.mock('../store/index.js', () => ({ init: mockStoreInit }));
vi.mock('../registry/index.js', () => ({
  initObservationOnly: mockInitObservationOnly,
  deregisterObservationOnly: mockDeregisterObservationOnly,
  getState: mockGetState,
}));

import { runScanCommand, SCAN_EXIT_TIMEOUT } from './scan.js';

function makeContainer(overrides: Record<string, unknown> = {}): Container {
  return {
    id: 'id-1',
    name: 'web',
    status: 'running',
    watcher: 'local',
    image: {
      registry: { name: 'hub' },
      name: 'library/nginx',
      tag: { value: '1.0.0' },
    },
    updateAvailable: false,
    updateKind: { kind: 'unknown' },
    ...overrides,
  } as unknown as Container;
}

function updateContainer(name: string, watcher = 'local'): Container {
  return makeContainer({
    name,
    watcher,
    updateAvailable: true,
    updateKind: { kind: 'tag', semverDiff: 'minor', localValue: '1.0.0', remoteValue: '1.1.0' },
    result: { tag: '1.1.0', digest: 'sha256:abc' },
  });
}

function reports(...containers: Container[]): ContainerReport[] {
  return containers.map((container) => ({ container, changed: false }));
}

function setWatchers(...watchers: Record<string, unknown>[]) {
  mockGetState.mockReturnValue({
    watcher: Object.fromEntries(watchers.map((watcher, index) => [`w${index}`, watcher])),
  });
}

function makeIo() {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (m: string) => out.push(m), err: (m: string) => err.push(m) }, out, err };
}

const FIXED_NOW = () => new Date('2026-11-17T10:00:00.000Z');

describe('scan command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStoreInit.mockResolvedValue(undefined);
    mockInitObservationOnly.mockResolvedValue(undefined);
    mockDeregisterObservationOnly.mockResolvedValue(undefined);
  });

  describe('arguments', () => {
    test('--help prints usage and exits 0 without scanning', async () => {
      const { io, out } = makeIo();

      expect(await runScanCommand(['--help'], { io })).toBe(0);

      expect(out.join('\n')).toContain('Usage: node dist/index.js scan');
      expect(out.join('\n')).toContain('Exit codes');
      expect(mockStoreInit).not.toHaveBeenCalled();
    });

    test.each([
      [['--bogus'], 'Unknown argument: --bogus'],
      [['--format'], '--format requires'],
      [['--format', 'xml'], '--format requires'],
      [['--timeout'], '--timeout requires'],
      [['--timeout', '0'], '--timeout requires'],
      [['--timeout', 'soon'], '--timeout requires'],
      [['--notify'], 'observation-only'],
      [['--update'], 'observation-only'],
    ])('rejects %j with exit 2 and touches nothing', async (args, message) => {
      const { io, err, out } = makeIo();

      expect(await runScanCommand(args, { io })).toBe(2);

      expect(err[0]).toContain(message);
      expect(out.join('\n')).toContain('Usage:');
      expect(mockStoreInit).not.toHaveBeenCalled();
      expect(mockDeregisterObservationOnly).not.toHaveBeenCalled();
    });
  });

  describe('outcomes', () => {
    test('no updates: exit 0, a single JSON document with stable fields', async () => {
      setWatchers({ name: 'local', watch: vi.fn().mockResolvedValue(reports(makeContainer())) });
      const { io, out, err } = makeIo();

      expect(await runScanCommand([], { io, now: FIXED_NOW })).toBe(0);

      expect(err).toEqual([]);
      expect(out).toHaveLength(1);
      const document = JSON.parse(out[0]);
      expect(Object.keys(document)).toEqual([
        'schemaVersion',
        'status',
        'scannedAt',
        'summary',
        'containers',
        'errors',
      ]);
      expect(document).toMatchObject({
        schemaVersion: 1,
        status: 'ok',
        scannedAt: '2026-11-17T10:00:00.000Z',
        summary: { scanned: 1, updates: 0, errors: 0 },
        errors: [],
      });
      expect(Object.keys(document.containers[0])).toEqual([
        'watcher',
        'name',
        'id',
        'status',
        'image',
        'updateAvailable',
        'updateKind',
        'result',
        'error',
      ]);
      expect(document.containers[0]).toMatchObject({
        image: { registry: 'hub', name: 'library/nginx', tag: '1.0.0' },
        updateKind: { kind: 'unknown', semverDiff: null, local: null, remote: null },
        result: { tag: null, digest: null },
        error: null,
      });
    });

    test('tolerates a container with no update fields and keeps equal names in input order', async () => {
      setWatchers({
        name: 'local',
        watch: vi
          .fn()
          .mockResolvedValue(
            reports(
              makeContainer({ id: 'one', updateKind: undefined, updateAvailable: undefined }),
              makeContainer({ id: 'two', updateKind: undefined, updateAvailable: undefined }),
            ),
          ),
      });
      const { io, out } = makeIo();

      expect(await runScanCommand([], { io })).toBe(0);

      const document = JSON.parse(out[0]);
      expect(document.containers.map((c: { id: string }) => c.id)).toEqual(['one', 'two']);
      expect(document.containers[0]).toMatchObject({
        updateAvailable: false,
        updateKind: { kind: 'unknown', semverDiff: null, local: null, remote: null },
      });
    });

    test('runs against an in-memory store and registers only observation components', async () => {
      setWatchers({ name: 'local', watch: vi.fn().mockResolvedValue([]) });
      const { io } = makeIo();

      await runScanCommand([], { io });

      expect(mockStoreInit).toHaveBeenCalledWith({ memory: true });
      expect(mockInitObservationOnly).toHaveBeenCalledTimes(1);
    });

    test('updates found: exit 3, sorted by watcher then name, full update detail', async () => {
      setWatchers(
        {
          name: 'remote',
          watch: vi.fn().mockResolvedValue(reports(updateContainer('alpha', 'remote'))),
        },
        {
          name: 'local',
          watch: vi
            .fn()
            .mockResolvedValue(
              reports(
                updateContainer('zeta'),
                makeContainer({ name: 'mid' }),
                updateContainer('beta'),
              ),
            ),
        },
      );
      const { io, out } = makeIo();

      expect(await runScanCommand([], { io })).toBe(3);

      const document = JSON.parse(out[0]);
      expect(document.status).toBe('updates');
      expect(document.summary).toEqual({ scanned: 4, updates: 3, errors: 0 });
      expect(
        document.containers.map((c: { watcher: string; name: string }) => `${c.watcher}/${c.name}`),
      ).toEqual(['local/beta', 'local/mid', 'local/zeta', 'remote/alpha']);
      expect(document.containers[0]).toMatchObject({
        updateAvailable: true,
        updateKind: { kind: 'tag', semverDiff: 'minor', local: '1.0.0', remote: '1.1.0' },
        result: { tag: '1.1.0', digest: 'sha256:abc' },
      });
    });

    test('--updates-only filters the list but the summary still counts everything scanned', async () => {
      setWatchers({
        name: 'local',
        watch: vi
          .fn()
          .mockResolvedValue(reports(makeContainer({ name: 'mid' }), updateContainer('beta'))),
      });
      const { io, out } = makeIo();

      expect(await runScanCommand(['--updates-only'], { io })).toBe(3);

      const document = JSON.parse(out[0]);
      expect(document.containers.map((c: { name: string }) => c.name)).toEqual(['beta']);
      expect(document.summary.scanned).toBe(2);
    });

    test('--format ndjson prints one JSON line per container and nothing else', async () => {
      setWatchers({
        name: 'local',
        watch: vi
          .fn()
          .mockResolvedValue(reports(updateContainer('beta'), makeContainer({ name: 'alpha' }))),
      });
      const { io, out } = makeIo();

      expect(await runScanCommand(['--format', 'ndjson'], { io })).toBe(3);

      expect(out).toHaveLength(2);
      expect(out.map((line) => JSON.parse(line).name)).toEqual(['alpha', 'beta']);
      expect(out.every((line) => !line.includes('\n'))).toBe(true);
    });

    test('ndjson with --updates-only and no updates prints nothing and exits 0', async () => {
      setWatchers({ name: 'local', watch: vi.fn().mockResolvedValue(reports(makeContainer())) });
      const { io, out } = makeIo();

      expect(await runScanCommand(['--format', 'ndjson', '--updates-only'], { io })).toBe(0);

      expect(out).toEqual([]);
    });

    test('a registry failure on a container is a technical failure even when an update was found', async () => {
      setWatchers({
        name: 'local',
        watch: vi
          .fn()
          .mockResolvedValue(
            reports(
              updateContainer('beta'),
              makeContainer({ name: 'broken', error: { message: 'registry 503' } }),
            ),
          ),
      });
      const { io, out } = makeIo();

      expect(await runScanCommand([], { io })).toBe(1);

      const document = JSON.parse(out[0]);
      expect(document.status).toBe('error');
      expect(document.summary.errors).toBe(1);
      expect(document.containers.find((c: { name: string }) => c.name === 'broken').error).toBe(
        'registry 503',
      );
    });

    test('a watcher that throws is a technical failure reported on stderr and in the document', async () => {
      setWatchers(
        { name: 'bad', watch: vi.fn().mockRejectedValue(new Error('socket gone')) },
        { name: 'good', watch: vi.fn().mockResolvedValue(reports(makeContainer())) },
      );
      const { io, out, err } = makeIo();

      expect(await runScanCommand([], { io })).toBe(1);

      expect(err).toEqual(['Error: watcher bad: socket gone']);
      const document = JSON.parse(out[0]);
      expect(document.errors).toEqual(['watcher bad: socket gone']);
      expect(document.summary).toEqual({ scanned: 1, updates: 0, errors: 1 });
    });

    test('a watcher whose container list was incomplete is a technical failure', async () => {
      setWatchers({
        name: 'local',
        lastScanIncomplete: true,
        watch: vi.fn().mockResolvedValue([]),
      });
      const { io, err } = makeIo();

      expect(await runScanCommand([], { io })).toBe(1);

      expect(err[0]).toContain('watcher local: the container list was incomplete');
    });

    test('no registered watcher is a technical failure', async () => {
      setWatchers();
      const { io, err, out } = makeIo();

      expect(await runScanCommand([], { io })).toBe(1);

      expect(err[0]).toContain('no watcher is registered');
      expect(out).toEqual([]);
    });

    test('a store or registry failure is a technical failure with nothing on stdout', async () => {
      mockStoreInit.mockRejectedValue(new Error('no memory db'));
      const { io, err, out } = makeIo();

      expect(await runScanCommand([], { io })).toBe(1);

      expect(err).toEqual(['Error: no memory db']);
      expect(out).toEqual([]);
      expect(mockDeregisterObservationOnly).toHaveBeenCalledTimes(1);
    });
  });

  describe('timeout and cleanup', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    test('a scan that outlives --timeout exits 4 and still prints a timeout document', async () => {
      vi.useFakeTimers();
      setWatchers({ name: 'local', watch: vi.fn(() => new Promise<ContainerReport[]>(() => {})) });
      const { io, out, err } = makeIo();

      const run = runScanCommand(['--timeout', '5'], { io, now: FIXED_NOW });
      await vi.advanceTimersByTimeAsync(5000);

      expect(await run).toBe(SCAN_EXIT_TIMEOUT);
      expect(SCAN_EXIT_TIMEOUT).toBe(4);
      expect(err[0]).toContain('did not finish within 5 seconds');
      const document = JSON.parse(out[0]);
      expect(document).toMatchObject({ status: 'timeout', containers: [] });
      expect(document.errors).toEqual(['the scan did not finish within 5 seconds']);
      expect(mockDeregisterObservationOnly).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    });

    test('a timed-out ndjson scan prints nothing on stdout', async () => {
      vi.useFakeTimers();
      setWatchers({ name: 'local', watch: vi.fn(() => new Promise<ContainerReport[]>(() => {})) });
      const { io, out } = makeIo();

      const run = runScanCommand(['--format', 'ndjson', '--timeout', '1'], { io });
      await vi.advanceTimersByTimeAsync(1000);

      expect(await run).toBe(4);
      expect(out).toEqual([]);
    });

    test('a finished scan leaves no timer behind and tears everything down', async () => {
      vi.useFakeTimers();
      setWatchers({
        name: 'local',
        watch: vi.fn().mockResolvedValue(reports(updateContainer('a'))),
      });
      const { io } = makeIo();

      expect(await runScanCommand([], { io })).toBe(3);

      expect(vi.getTimerCount()).toBe(0);
      expect(mockDeregisterObservationOnly).toHaveBeenCalledTimes(1);
    });

    test('teardown still runs when the scan throws unexpectedly', async () => {
      mockInitObservationOnly.mockRejectedValue(new Error('registry boom'));
      const { io } = makeIo();

      expect(await runScanCommand([], { io })).toBe(1);

      expect(mockDeregisterObservationOnly).toHaveBeenCalledTimes(1);
    });
  });

  describe('default io', () => {
    test('writes output to stdout and errors to stderr with a trailing newline', async () => {
      setWatchers({ name: 'local', watch: vi.fn().mockRejectedValue(new Error('x')) });
      const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      try {
        await runScanCommand(['--updates-only']);

        expect(stderr).toHaveBeenCalledWith('Error: watcher local: x\n');
        expect(String(stdout.mock.calls[0][0])).toMatch(/\n$/);
        expect(JSON.parse(String(stdout.mock.calls[0][0])).status).toBe('error');
      } finally {
        stdout.mockRestore();
        stderr.mockRestore();
      }
    });
  });
});
