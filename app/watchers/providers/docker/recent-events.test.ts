import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import Docker from './Docker.js';

const mockDdEnvVars = vi.hoisted(() => ({}) as Record<string, string | undefined>);
const mockLogger = vi.hoisted(() => ({
  child: vi.fn(() => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  })),
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../../../configuration/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../configuration/index.js')>()),
  ddEnvVars: mockDdEnvVars,
}));

vi.mock('../../../event/index.js', () => ({
  emitContainerReport: vi.fn(),
  emitContainerReports: vi.fn(),
  emitWatcherStart: vi.fn(),
  emitWatcherStop: vi.fn(),
}));

vi.mock('../../../log/index.js', () => ({
  default: mockLogger,
}));

vi.mock('../../../prometheus/watcher.js', () => ({
  getLoggerInitFailureCounter: vi.fn(() => undefined),
  getMaintenanceSkipCounter: vi.fn(() => undefined),
  getWatchContainerGauge: vi.fn(() => undefined),
}));

vi.mock('../../../registry/index.js', () => ({
  getState: vi.fn(() => ({
    agent: {},
    authentication: {},
    registry: {},
    trigger: {},
    watcher: {},
  })),
}));

vi.mock('../../../store/container.js', () => ({
  deleteContainer: vi.fn(),
  getContainer: vi.fn(),
  getContainers: vi.fn(() => []),
  getContainersRaw: vi.fn(() => []),
  insertContainer: vi.fn((container: unknown) => container),
  updateContainer: vi.fn((container: unknown) => container),
}));

vi.mock('just-debounce', () => ({
  default: vi.fn((fn: (...args: unknown[]) => unknown) => fn),
}));

vi.mock('node-cron', () => ({
  default: { schedule: vi.fn() },
  schedule: vi.fn(),
}));

vi.mock('parse-docker-image-name', () => ({
  default: vi.fn(),
}));

describe('Docker recent-event helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-18T12:30:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createDocker() {
    return new Docker();
  }

  test('records numeric event timestamps and ignores non-object input', () => {
    const docker = createDocker();

    (docker as any).recordRecentDockerEvent(null);
    expect(docker.recentDockerEvents).toEqual([]);

    (docker as any).recordRecentDockerEvent({
      Actor: { ID: 'actor-1' },
      Action: 'start',
      Type: 'container',
      id: 'container-1',
      time: 1_700_000_000,
    });
    (docker as any).recordRecentDockerEvent({
      time: 1_700_000_123,
    });
    (docker as any).recordRecentDockerEvent({
      timeNano: 1_700_000_123_456_789_000,
    });

    expect(docker.recentDockerEvents).toEqual([
      {
        actorId: 'actor-1',
        action: 'start',
        id: 'container-1',
        timestamp: new Date(1_700_000_000_000).toISOString(),
        type: 'container',
      },
      {
        actorId: undefined,
        action: undefined,
        id: undefined,
        timestamp: new Date(1_700_000_123_000).toISOString(),
        type: undefined,
      },
      {
        actorId: undefined,
        action: undefined,
        id: undefined,
        timestamp: new Date(1_700_000_123_456).toISOString(),
        type: undefined,
      },
    ]);
  });

  test('defers trimming until array exceeds 2x the configured max', () => {
    const docker = createDocker();
    const history = [{ value: 1 }, { value: 2 }];

    (docker as any).appendBoundedHistoryEntry(history, { value: 3 }, 2);
    expect(history).toHaveLength(3);

    (docker as any).appendBoundedHistoryEntry(history, { value: 4 }, 2);
    expect(history).toHaveLength(4);

    // At 2x+1 the splice fires, trimming back to maxEntries
    (docker as any).appendBoundedHistoryEntry(history, { value: 5 }, 2);
    expect(history).toEqual([{ value: 4 }, { value: 5 }]);
  });

  test('returns all recent docker events when no sinceMs filter is provided', () => {
    const docker = createDocker();
    docker.recentDockerEvents = [
      {
        actorId: undefined,
        action: 'old',
        id: 'old',
        timestamp: '2026-03-18T12:00:00.000Z',
        type: 'container',
      },
      {
        actorId: undefined,
        action: 'invalid',
        id: 'invalid',
        timestamp: 'not-a-date',
        type: 'container',
      },
      {
        actorId: undefined,
        action: 'new',
        id: 'new',
        timestamp: '2026-03-18T12:45:00.000Z',
        type: 'container',
      },
    ];

    expect(docker.getRecentDockerEvents({ limit: Number.POSITIVE_INFINITY })).toEqual(
      docker.recentDockerEvents,
    );
  });

  test('filters invalid docker event timestamps and honors zero limit', () => {
    const docker = createDocker();
    const sinceMs = Date.parse('2026-03-18T12:15:00.000Z');
    docker.recentDockerEvents = [
      {
        actorId: undefined,
        action: 'old',
        id: 'old',
        timestamp: '2026-03-18T12:00:00.000Z',
        type: 'container',
      },
      {
        actorId: undefined,
        action: 'invalid',
        id: 'invalid',
        timestamp: 'not-a-date',
        type: 'container',
      },
      {
        actorId: undefined,
        action: 'new',
        id: 'new',
        timestamp: '2026-03-18T12:45:00.000Z',
        type: 'container',
      },
    ];

    expect(docker.getRecentDockerEvents({ limit: 0, sinceMs })).toEqual([
      {
        actorId: undefined,
        action: 'new',
        id: 'new',
        timestamp: '2026-03-18T12:45:00.000Z',
        type: 'container',
      },
    ]);
  });

  test('returns only the requested number of docker events when limit is positive', () => {
    const docker = createDocker();
    docker.recentDockerEvents = [
      {
        actorId: undefined,
        action: 'first',
        id: 'first',
        timestamp: '2026-03-18T12:00:00.000Z',
        type: 'container',
      },
      {
        actorId: undefined,
        action: 'second',
        id: 'second',
        timestamp: '2026-03-18T12:01:00.000Z',
        type: 'container',
      },
    ];

    expect(docker.getRecentDockerEvents({ limit: 1 })).toEqual([
      {
        actorId: undefined,
        action: 'second',
        id: 'second',
        timestamp: '2026-03-18T12:01:00.000Z',
        type: 'container',
      },
    ]);
  });

  test('returns all alias filter decisions when no sinceMs filter is provided', () => {
    const docker = createDocker();
    docker.recentAliasFilterDecisions = [
      {
        containerId: 'old',
        containerName: 'old',
        decision: 'allowed',
        reason: 'not-recreated-alias',
        timestamp: '2026-03-18T12:00:00.000Z',
      },
      {
        containerId: 'invalid',
        containerName: 'invalid',
        decision: 'skipped',
        reason: 'fresh-recreated-alias',
        timestamp: 'not-a-date',
      },
      {
        baseName: 'new',
        containerId: 'new',
        containerName: 'new',
        decision: 'allowed',
        reason: 'alias-allowed-no-collision',
        timestamp: '2026-03-18T12:45:00.000Z',
      },
    ];

    expect(docker.getRecentAliasFilterDecisions({ limit: Number.POSITIVE_INFINITY })).toEqual(
      docker.recentAliasFilterDecisions,
    );
  });

  test('filters invalid alias decision timestamps and honors zero limit', () => {
    const docker = createDocker();
    const sinceMs = Date.parse('2026-03-18T12:15:00.000Z');
    docker.recentAliasFilterDecisions = [
      {
        containerId: 'old',
        containerName: 'old',
        decision: 'allowed',
        reason: 'not-recreated-alias',
        timestamp: '2026-03-18T12:00:00.000Z',
      },
      {
        containerId: 'invalid',
        containerName: 'invalid',
        decision: 'skipped',
        reason: 'fresh-recreated-alias',
        timestamp: 'not-a-date',
      },
      {
        baseName: 'new',
        containerId: 'new',
        containerName: 'new',
        decision: 'allowed',
        reason: 'alias-allowed-no-collision',
        timestamp: '2026-03-18T12:45:00.000Z',
      },
    ];

    expect(docker.getRecentAliasFilterDecisions({ limit: 0, sinceMs })).toEqual([
      {
        baseName: 'new',
        containerId: 'new',
        containerName: 'new',
        decision: 'allowed',
        reason: 'alias-allowed-no-collision',
        timestamp: '2026-03-18T12:45:00.000Z',
      },
    ]);
  });

  test('returns only the requested number of alias decisions when limit is positive', () => {
    const docker = createDocker();
    docker.recentAliasFilterDecisions = [
      {
        containerId: 'first',
        containerName: 'first',
        decision: 'allowed',
        reason: 'not-recreated-alias',
        timestamp: '2026-03-18T12:00:00.000Z',
      },
      {
        containerId: 'second',
        containerName: 'second',
        decision: 'allowed',
        reason: 'alias-allowed-no-collision',
        timestamp: '2026-03-18T12:01:00.000Z',
      },
    ];

    expect(docker.getRecentAliasFilterDecisions({ limit: 1 })).toEqual([
      {
        containerId: 'second',
        containerName: 'second',
        decision: 'allowed',
        reason: 'alias-allowed-no-collision',
        timestamp: '2026-03-18T12:01:00.000Z',
      },
    ]);
  });
});
