const { mockRecordAuditEvent, mockListActiveOperations, mockGetState, mockExecute } = vi.hoisted(
  () => ({
    mockRecordAuditEvent: vi.fn(),
    mockListActiveOperations: vi.fn(),
    mockGetState: vi.fn(),
    mockExecute: vi.fn(),
  }),
);

vi.mock('../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}));
vi.mock('../api/audit-events.js', () => ({ recordAuditEvent: mockRecordAuditEvent }));
vi.mock('../store/update-operation.js', () => ({ listActiveOperations: mockListActiveOperations }));
vi.mock('../registry/index.js', () => ({ getState: mockGetState }));
vi.mock('./engine.js', () => ({ executeCleanup: mockExecute }));

import { makeApi, makeHost, makePolicy } from './cleanup.test.helpers.js';
import {
  _resetCleanupStateForTesting,
  getLastCleanupRuns,
  hasActiveUpdate,
  isCleanupDockerApi,
  isHostBusy,
  resolvePolicyHosts,
  runCleanupOnHost,
} from './run.js';

const { api } = makeApi();
const host = makeHost(api);
const policy = makePolicy({ types: { danglingImages: true } as never });
const completed = {
  types: {
    danglingImages: { candidates: 2, removed: 2, reclaimedBytes: 60, skipped: 0, errors: [] },
  },
  totalReclaimedBytes: 60,
};

describe('cleanup run', () => {
  beforeEach(() => {
    _resetCleanupStateForTesting();
    mockRecordAuditEvent.mockReset();
    mockListActiveOperations.mockReset().mockReturnValue([]);
    mockGetState.mockReset();
    mockExecute.mockReset().mockResolvedValue(completed);
  });

  test('isCleanupDockerApi requires every Docker method', () => {
    expect(isCleanupDockerApi(api)).toBe(true);
    expect(isCleanupDockerApi({ listImages: () => undefined })).toBe(false);
    expect(isCleanupDockerApi(undefined)).toBe(false);
  });

  describe('resolvePolicyHosts', () => {
    const agentApi = makeApi().api;
    const watchers = {
      'docker.local': { type: 'docker', name: 'local', dockerApi: api },
      'edge.docker.remote': { type: 'docker', name: 'remote', agent: 'edge', dockerApi: agentApi },
      'edge.docker.noapi': { type: 'docker', name: 'noapi', agent: 'edge' },
      'docker.partial': {
        type: 'docker',
        name: 'partial',
        dockerApi: {
          listImages: vi.fn(),
          listContainers: vi.fn(),
          pruneImages: vi.fn(),
        },
      },
    };

    test('covers local and agent hosts and flags the ones that cannot run cleanup', () => {
      mockGetState.mockReturnValue({ watcher: watchers });
      const resolved = resolvePolicyHosts(makePolicy());
      expect(resolved.map((entry) => entry.id)).toEqual([
        'docker.local',
        'docker.partial',
        'edge.docker.noapi',
        'edge.docker.remote',
      ]);
      expect(resolved.find((entry) => entry.id === 'edge.docker.remote')?.host).toMatchObject({
        name: 'remote',
        agent: 'edge',
      });
      expect(resolved.find((entry) => entry.id === 'docker.local')?.host).not.toHaveProperty(
        'agent',
      );
      expect(resolved.find((entry) => entry.id === 'docker.partial')?.host).toBeUndefined();
    });

    test('honours the policy host list', () => {
      mockGetState.mockReturnValue({ watcher: watchers });
      const resolved = resolvePolicyHosts(makePolicy({ hosts: ['edge.docker.remote'] }));
      expect(resolved.map((entry) => entry.id)).toEqual(['edge.docker.remote']);
    });
  });

  describe('hasActiveUpdate', () => {
    const agentHost = makeHost(api, { id: 'edge.docker.remote', name: 'remote', agent: 'edge' });

    test('matches an active operation on the same watcher and agent', () => {
      mockListActiveOperations.mockReturnValue([{ watcher: 'local' }]);
      expect(hasActiveUpdate(host)).toBe(true);
      expect(hasActiveUpdate(agentHost)).toBe(false);
      mockListActiveOperations.mockReturnValue([{ watcher: 'remote', agent: 'edge' }]);
      expect(hasActiveUpdate(agentHost)).toBe(true);
      expect(hasActiveUpdate(host)).toBe(false);
    });

    test('an operation with no watcher blocks every host', () => {
      mockListActiveOperations.mockReturnValue([{}]);
      expect(hasActiveUpdate(host)).toBe(true);
    });

    test('other hosts and no operations do not block', () => {
      mockListActiveOperations.mockReturnValue([{ watcher: 'elsewhere' }]);
      expect(hasActiveUpdate(host)).toBe(false);
      mockListActiveOperations.mockReturnValue([]);
      expect(isHostBusy(host)).toBe(false);
    });
  });

  test('runs a policy, records the result and audits it', async () => {
    const result = await runCleanupOnHost({ id: host.id, host }, policy, 'schedule');
    expect(mockExecute).toHaveBeenCalledWith(host, policy, { dryRun: false });
    expect(result).toMatchObject({
      policy: 'nightly',
      host: 'docker.local',
      trigger: 'schedule',
      status: 'completed',
      totalReclaimedBytes: 60,
    });
    expect(getLastCleanupRuns()).toEqual([result]);
    expect(mockRecordAuditEvent).toHaveBeenCalledWith({
      action: 'cleanup',
      status: 'success',
      containerName: 'docker.local',
      details: 'nightly (schedule): danglingImages 2/2 removed, 60 bytes; 60 bytes total',
    });
  });

  test('a dry run override reaches the engine and is audited as info', async () => {
    await runCleanupOnHost({ id: host.id, host }, policy, 'manual', true);
    expect(mockExecute).toHaveBeenCalledWith(host, policy, { dryRun: true });
    expect(mockRecordAuditEvent.mock.calls[0][0]).toMatchObject({ status: 'info' });
    expect(mockRecordAuditEvent.mock.calls[0][0].details).toContain('manual, dry run');
  });

  test('the policy dryRun flag applies when there is no override', async () => {
    await runCleanupOnHost(
      { id: host.id, host },
      makePolicy({ ...policy, dryRun: true }),
      'schedule',
    );
    expect(mockExecute).toHaveBeenCalledWith(host, expect.anything(), { dryRun: true });
  });

  test('type errors mark the audit entry as an error', async () => {
    mockExecute.mockResolvedValue({
      types: {
        networks: { candidates: 1, removed: 0, reclaimedBytes: 0, skipped: 1, errors: ['x'] },
      },
      totalReclaimedBytes: 0,
    });
    await runCleanupOnHost({ id: host.id, host }, policy, 'schedule');
    expect(mockRecordAuditEvent.mock.calls[0][0]).toMatchObject({ status: 'error' });
    expect(mockRecordAuditEvent.mock.calls[0][0].details).toContain('1 errors');
  });

  test('skips without running while an update is in progress on the host', async () => {
    mockListActiveOperations.mockReturnValue([{ watcher: 'local' }]);
    const result = await runCleanupOnHost({ id: host.id, host }, policy, 'schedule');
    expect(mockExecute).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'skipped', reason: 'update-in-progress' });
    expect(mockRecordAuditEvent).toHaveBeenCalledWith({
      action: 'cleanup',
      status: 'info',
      containerName: 'docker.local',
      details: 'nightly (schedule): skipped, update-in-progress',
    });
  });

  test('skips an unsupported host', async () => {
    const result = await runCleanupOnHost({ id: 'edge.docker.noapi' }, policy, 'manual');
    expect(result).toMatchObject({ status: 'skipped', reason: 'unsupported-host' });
  });

  test('skips a host that is already being cleaned', async () => {
    let release: (value: unknown) => void = () => undefined;
    mockExecute.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const first = runCleanupOnHost({ id: host.id, host }, policy, 'schedule');
    expect(isHostBusy(host)).toBe(true);
    const second = await runCleanupOnHost({ id: host.id, host }, policy, 'manual');
    expect(second).toMatchObject({ status: 'skipped', reason: 'already-running' });
    release(completed);
    await first;
    expect(isHostBusy(host)).toBe(false);
  });

  test('an engine failure becomes an error result and frees the host', async () => {
    mockExecute.mockRejectedValue(new Error('boom'));
    const result = await runCleanupOnHost({ id: host.id, host }, policy, 'schedule');
    expect(result).toMatchObject({ status: 'error', error: 'boom' });
    expect(mockRecordAuditEvent.mock.calls[0][0]).toMatchObject({
      status: 'error',
      details: 'nightly (schedule): boom',
    });
    expect(isHostBusy(host)).toBe(false);
  });

  test('lists the latest results newest first', async () => {
    await runCleanupOnHost({ id: 'a', host: makeHost(api, { id: 'a' }) }, policy, 'schedule');
    await new Promise((resolve) => setTimeout(resolve, 3));
    await runCleanupOnHost({ id: 'b', host: makeHost(api, { id: 'b' }) }, policy, 'schedule');
    expect(getLastCleanupRuns().map((run) => run.host)).toEqual(['b', 'a']);
  });
});
