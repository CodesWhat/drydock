import type { Mocked } from 'vitest';
import * as event from '../../../event/index.js';
import { fullName } from '../../../model/container.js';
import * as registry from '../../../registry/index.js';
import * as storeContainer from '../../../store/container.js';
import { mockConstructor } from '../../../test/mock-constructor.js';
import {
  _resetControllerLocalContainerIdsForTests,
  findControllerLocalWatcherClaimingContainerId,
} from '../../controller-local-container-ids.js';
import {
  _resetRegistryWebhookFreshStateForTests,
  markContainerFreshForScheduledPollSkip,
} from '../../registry-webhook-fresh.js';
import Docker from './Docker.js';

const mockDdEnvVars = vi.hoisted(() => ({}) as Record<string, string | undefined>);
const mockDetectSourceRepoFromImageMetadata = vi.hoisted(() => vi.fn());
const mockResolveSourceRepoForContainer = vi.hoisted(() => vi.fn());
const mockGetFullReleaseNotesForContainer = vi.hoisted(() => vi.fn());
const mockToContainerReleaseNotes = vi.hoisted(() => vi.fn((notes) => notes));
vi.mock('../../../configuration/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../configuration/index.js')>()),
  ddEnvVars: mockDdEnvVars,
}));
vi.mock('../../../release-notes/index.js', () => ({
  detectSourceRepoFromImageMetadata: (...args: unknown[]) =>
    mockDetectSourceRepoFromImageMetadata(...args),
  resolveSourceRepoForContainer: (...args: unknown[]) => mockResolveSourceRepoForContainer(...args),
  getFullReleaseNotesForContainer: (...args: unknown[]) =>
    mockGetFullReleaseNotesForContainer(...args),
  toContainerReleaseNotes: (...args: unknown[]) => mockToContainerReleaseNotes(...args),
}));

// Mock all dependencies
vi.mock('dockerode');
vi.mock('node-cron');
vi.mock('just-debounce');
vi.mock('../../../event');
vi.mock('../../../store/container');
vi.mock('../../../registry');
vi.mock('../../../model/container');
vi.mock('../../../tag');
vi.mock('../../../prometheus/watcher');
vi.mock('parse-docker-image-name');
vi.mock('node:fs');
vi.mock('axios');
// Partial: isScanGatedByMaintenanceWindow stays real so the maintenancewindowscope
// branches are exercised rather than restated here.
vi.mock('./maintenance.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./maintenance.js')>()),
  isInMaintenanceWindow: vi.fn(() => true),
  getNextMaintenanceWindow: vi.fn(() => undefined),
  hasNarrowMinuteField: vi.fn(() => false),
}));

import axios from 'axios';
import mockDockerode from 'dockerode';
import mockDebounce from 'just-debounce';
import mockCron from 'node-cron';
import mockParse from 'parse-docker-image-name';
import * as mockPrometheus from '../../../prometheus/watcher.js';
import * as mockTag from '../../../tag/index.js';
import * as dockerHelpers from './docker-helpers.js';
import * as maintenance from './maintenance.js';

const mockAxios = axios as Mocked<typeof axios>;

// --- Shared factory functions to reduce test duplication ---

/** Creates a mock log object with commonly needed methods. */
function createMockLog(methods = ['info', 'warn', 'debug', 'error']) {
  const log = {};
  for (const m of methods) {
    log[m] = vi.fn();
  }
  return log;
}

function createConcurrencyProbe<T, R>(resolveValue: (input: T) => R) {
  let active = 0;
  let maxActive = 0;
  let started = 0;
  const blockers = new Set<() => void>();

  return {
    get maxActive() {
      return maxActive;
    },
    get started() {
      return started;
    },
    releaseAll() {
      for (const release of Array.from(blockers)) {
        release();
      }
    },
    async run(input: T) {
      active += 1;
      started += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => {
        const release = () => {
          blockers.delete(release);
          active -= 1;
          resolve();
        };
        blockers.add(release);
      });
      return resolveValue(input);
    },
  };
}

let mockImage;

describe('Docker Watcher', () => {
  let docker;
  let mockDockerApi;
  let mockSchedule;
  let mockContainer;

  beforeEach(async () => {
    vi.clearAllMocks();
    _resetRegistryWebhookFreshStateForTests();
    _resetControllerLocalContainerIdsForTests();

    // Setup dockerode mock
    mockDockerApi = {
      listContainers: vi.fn(),
      getContainer: vi.fn(),
      getEvents: vi.fn(),
      getImage: vi.fn(),
      getService: vi.fn(),
      modem: {
        headers: {},
      },
    };
    mockDockerode.mockImplementation(mockConstructor(mockDockerApi));

    // Setup cron mock
    mockSchedule = {
      stop: vi.fn(),
    };
    mockCron.schedule.mockReturnValue(mockSchedule);

    // Setup debounce mock
    mockDebounce.mockImplementation((fn) => fn);

    // Setup container mock
    mockContainer = {
      inspect: vi.fn(),
    };
    mockDockerApi.getContainer.mockReturnValue(mockContainer);

    // Setup image mock
    mockImage = {
      inspect: vi.fn(),
    };
    mockDockerApi.getImage.mockReturnValue(mockImage);

    // Setup store mock
    storeContainer.getContainers.mockReturnValue([]);
    storeContainer.getContainer.mockReturnValue(undefined);
    storeContainer.insertContainer.mockImplementation((c) => c);
    storeContainer.updateContainer.mockImplementation((c) => c);
    storeContainer.deleteContainer.mockImplementation(() => {});

    // Setup registry mock
    registry.getState.mockReturnValue({ registry: {} });

    // Setup event mock
    event.emitWatcherStart.mockImplementation(() => {});
    event.emitWatcherStop.mockImplementation(() => {});
    event.emitContainerReport.mockImplementation(() => {});
    event.emitContainerReports.mockImplementation(() => {});
    event.emitWatcherSnapshot.mockImplementation(() => {});

    // Setup tag mock
    mockTag.parse.mockReturnValue({ major: 1, minor: 0, patch: 0 });
    mockTag.isGreater.mockReturnValue(false);
    mockTag.transform.mockImplementation((transform, tag) => tag);

    // Setup prometheus mock
    const mockGauge = { set: vi.fn() };
    mockPrometheus.getWatchContainerGauge.mockReturnValue(mockGauge);
    mockPrometheus.getMaintenanceSkipCounter.mockReturnValue({
      labels: vi.fn().mockReturnValue({ inc: vi.fn() }),
    });
    mockPrometheus.getLoggerInitFailureCounter.mockReturnValue({
      labels: vi.fn().mockReturnValue({ inc: vi.fn() }),
    });

    // Setup maintenance helpers
    maintenance.isInMaintenanceWindow.mockReturnValue(true);
    maintenance.getNextMaintenanceWindow.mockReturnValue(undefined);

    // Setup parse mock
    mockParse.mockReturnValue({
      domain: 'docker.io',
      path: 'library/nginx',
      tag: '1.0.0',
    });

    mockAxios.post.mockResolvedValue({
      data: {
        access_token: 'oidc-token',
        expires_in: 300,
      },
    } as any);

    // Setup fullName mock
    fullName.mockReturnValue('test_container');

    docker = new Docker();
    // Default discovery settling off for this suite (#156): these tests
    // assert getContainers()/watchFromCron() enrich/return freshly-discovered
    // containers synchronously within a single call and predate the settling
    // window.
    const originalRegister = docker.register.bind(docker);
    docker.register = ((
      kind: string,
      type: string,
      name: string,
      configuration: Record<string, unknown> = {},
      agent?: string,
    ) =>
      originalRegister(
        kind,
        type,
        name,
        { discoverysettlems: 0, ...configuration },
        agent,
      )) as typeof docker.register;
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (docker) {
      await docker.deregisterComponent();
    }
  });

  describe('Container Watching', () => {
    test('should watch containers from cron', async () => {
      await docker.register('watcher', 'docker', 'test', {
        cron: '0 * * * *',
      });
      const mockLog = createMockLog(['info']);
      docker.log = mockLog;
      docker.watch = vi.fn().mockResolvedValue([]);

      await docker.watchFromCron();

      expect(docker.watch).toHaveBeenCalled();
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('Cron started'));
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('Cron finished'));
    });

    test('names the scan trigger in the started log line via the reason field', async () => {
      await docker.register('watcher', 'docker', 'test', {
        cron: '0 * * * *',
      });
      const mockLog = createMockLog(['info']);
      docker.log = mockLog;
      docker.watch = vi.fn().mockResolvedValue([]);

      await docker.watchFromCron({ reason: 'docker-event' });

      expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('reason: docker-event'));
    });

    // Single-flight coalescing (#972): a full scan on a large fleet can take
    // minutes, and the cron schedule, the docker-events debounce, the
    // discovery-settle timer and the startup timer can all ask for a scan
    // while one is already running. Without a guard each overlapping call
    // ran its own watch(), and a tag first seen mid-burst passed the
    // once=true history check in every one of them before any of them
    // recorded it, firing the same trigger once per overlapping scan.
    test('coalesces overlapping watchFromCron calls into a single follow-up scan', async () => {
      await docker.register('watcher', 'docker', 'test', {
        cron: '0 * * * *',
      });
      const mockLog = createMockLog(['info']);
      docker.log = mockLog;

      let resolveFirstWatch: (value: unknown[]) => void = () => undefined;
      const firstWatch = new Promise<unknown[]>((resolve) => {
        resolveFirstWatch = resolve;
      });
      const watchMock = vi
        .fn()
        .mockImplementationOnce(() => firstWatch)
        .mockResolvedValue([]);
      docker.watch = watchMock;

      // Three overlapping requests while the first watch() is still pending.
      const call1 = docker.watchFromCron({ reason: 'schedule' });
      const call2 = docker.watchFromCron({ reason: 'docker-event' });
      const call3 = docker.watchFromCron({ reason: 'discovery-settle' });

      // Let the coalesced calls register synchronously before resolving.
      await Promise.resolve();
      await Promise.resolve();
      expect(watchMock).toHaveBeenCalledTimes(1);
      expect(mockLog.info).toHaveBeenCalledWith(
        expect.stringContaining('Cron scan requested (docker-event) while one is already running'),
      );
      expect(mockLog.info).toHaveBeenCalledWith(
        expect.stringContaining(
          'Cron scan requested (discovery-settle) while one is already running',
        ),
      );

      const firstReports = [{ container: { updateAvailable: false, error: undefined } }];
      resolveFirstWatch(firstReports);

      // All three coalesced callers receive the SAME running scan's result.
      const [result1, result2, result3] = await Promise.all([call1, call2, call3]);
      expect(result1).toBe(firstReports);
      expect(result2).toBe(firstReports);
      expect(result3).toBe(firstReports);

      // Exactly one follow-up scan runs after the running scan finishes,
      // even though three callers asked for a rescan.
      await vi.waitFor(() => expect(watchMock).toHaveBeenCalledTimes(2));

      // vi.waitFor() resolves the instant the count reaches 2 and would not
      // fail if a second (unwanted) follow-up also fired - flush pending
      // promises and recheck to catch that case.
      await Promise.resolve();
      await Promise.resolve();
      expect(watchMock).toHaveBeenCalledTimes(2);
    });

    // #979: a scan that was in flight when the watcher was deregistered used
    // to start a brand-new full scan (via the coalesced follow-up) on a
    // torn-down watcher once it finally settled, emitting a watcher snapshot
    // - the authoritative prune list - for a watcher no longer registered.
    test('drops the coalesced follow-up scan once the watcher is deregistered while the scan was running', async () => {
      await docker.register('watcher', 'docker', 'test', {
        cron: '0 * * * *',
      });
      docker.log = createMockLog(['info', 'debug']);

      let resolveFirstWatch: (value: unknown[]) => void = () => undefined;
      const firstWatch = new Promise<unknown[]>((resolve) => {
        resolveFirstWatch = resolve;
      });
      const watchMock = vi
        .fn()
        .mockImplementationOnce(() => firstWatch)
        .mockResolvedValue([]);
      docker.watch = watchMock;

      const call1 = docker.watchFromCron({ reason: 'schedule' });
      const call2 = docker.watchFromCron({ reason: 'docker-event' });
      await Promise.resolve();
      await Promise.resolve();
      expect(docker.cronWatchRescanRequested).toBe(true);

      await docker.deregisterComponent();
      expect(docker.cronWatchRescanRequested).toBe(false);
      expect(docker.cronWatchInFlight).toBeUndefined();

      resolveFirstWatch([]);
      await Promise.all([call1, call2]);

      await Promise.resolve();
      await Promise.resolve();
      expect(watchMock).toHaveBeenCalledTimes(1);
    });

    test('coalesces a request silently when logging is unavailable', async () => {
      await docker.register('watcher', 'docker', 'test', {
        cron: '0 * * * *',
      });
      docker.log = {}; // no info(), must not throw while coalescing

      let resolveFirstWatch: (value: unknown[]) => void = () => undefined;
      const firstWatch = new Promise<unknown[]>((resolve) => {
        resolveFirstWatch = resolve;
      });
      docker.watch = vi
        .fn()
        .mockImplementationOnce(() => firstWatch)
        .mockResolvedValue([]);

      const call1 = docker.watchFromCron();
      const call2 = docker.watchFromCron();

      resolveFirstWatch([]);
      await expect(Promise.all([call1, call2])).resolves.toBeDefined();
    });

    test('swallows a rejection from the fire-and-forget follow-up scan', async () => {
      await docker.register('watcher', 'docker', 'test', {
        cron: '0 * * * *',
      });
      docker.log = createMockLog(['info']);

      let resolveFirstWatch: (value: unknown[]) => void = () => undefined;
      const firstWatch = new Promise<unknown[]>((resolve) => {
        resolveFirstWatch = resolve;
      });
      const watchMock = vi
        .fn()
        .mockImplementationOnce(() => firstWatch)
        .mockImplementationOnce(() => Promise.reject(new Error('follow-up watch failed')));
      docker.watch = watchMock;

      // call2 requests a rescan; the follow-up it triggers after call1's
      // scan finishes is fire-and-forget and must not surface as an
      // unhandled rejection when its own watch() call fails.
      const call1 = docker.watchFromCron();
      const call2 = docker.watchFromCron();

      resolveFirstWatch([]);
      await Promise.all([call1, call2]);

      await vi.waitFor(() => expect(watchMock).toHaveBeenCalledTimes(2));

      // vi.waitFor() resolves the instant the count reaches 2 and would not
      // fail if a second (unwanted) follow-up also fired - flush pending
      // promises and recheck to catch that case.
      await Promise.resolve();
      await Promise.resolve();
      expect(watchMock).toHaveBeenCalledTimes(2);
    });

    test('should report container statistics', async () => {
      await docker.register('watcher', 'docker', 'test', {
        cron: '0 * * * *',
      });
      const mockLog = createMockLog(['info']);
      docker.log = mockLog;
      const containerReports = [
        { container: { updateAvailable: true, error: undefined } },
        {
          container: {
            updateAvailable: false,
            error: { message: 'error' },
          },
        },
      ];
      docker.watch = vi.fn().mockResolvedValue(containerReports);

      await docker.watchFromCron();

      expect(mockLog.info).toHaveBeenCalledWith(
        expect.stringContaining('2 containers watched, 1 errors, 1 available updates'),
      );
    });

    test('should queue watch when outside maintenance window', async () => {
      const maintenanceInc = vi.fn();
      mockPrometheus.getMaintenanceSkipCounter.mockReturnValue({
        labels: vi.fn().mockReturnValue({ inc: maintenanceInc }),
      });
      maintenance.isInMaintenanceWindow.mockReturnValue(false);

      await docker.register('watcher', 'docker', 'test', {
        cron: '0 * * * *',
        maintenancewindow: '0 2 * * *',
        maintenancewindowtz: 'UTC',
        maintenancewindowscope: 'scan',
      });
      docker.log = createMockLog(['info']);
      docker.watch = vi.fn().mockResolvedValue([]);

      const result = await docker.watchFromCron();

      expect(result).toEqual([]);
      expect(docker.watch).not.toHaveBeenCalled();
      expect(docker.maintenanceWindowWatchQueued).toBe(true);
      expect(docker.maintenanceWindowQueueTimeout).toBeDefined();
      expect(maintenanceInc).toHaveBeenCalledTimes(1);
      docker.clearMaintenanceWindowQueue();
    });

    test('should run the scan outside the window under the default install scope', async () => {
      const maintenanceInc = vi.fn();
      mockPrometheus.getMaintenanceSkipCounter.mockReturnValue({
        labels: vi.fn().mockReturnValue({ inc: maintenanceInc }),
      });
      maintenance.isInMaintenanceWindow.mockReturnValue(false);

      await docker.register('watcher', 'docker', 'test', {
        cron: '0 * * * *',
        maintenancewindow: '0 2 * * *',
        maintenancewindowtz: 'UTC',
      });
      docker.log = createMockLog(['info']);
      docker.watch = vi.fn().mockResolvedValue([]);

      await docker.watchFromCron();

      expect(docker.configuration.maintenancewindowscope).toBe('install');
      expect(docker.watch).toHaveBeenCalledTimes(1);
      expect(docker.maintenanceWindowWatchQueued).toBe(false);
      expect(maintenanceInc).not.toHaveBeenCalled();
    });

    // #946 finding 2: the arm a digest flush takes lands hours after the scan that produced
    // the reports, so it is only ever seen by a LATER cron tick. That tick used to clear it
    // unconditionally, which under the install scope meant nothing was left to apply the
    // deferred install when the window opened, every day, forever.
    test('an ordinary tick outside the window keeps a catch-up armed by a digest flush', async () => {
      maintenance.isInMaintenanceWindow.mockReturnValue(false);

      await docker.register('watcher', 'docker', 'test', {
        cron: '0 */6 * * *',
        maintenancewindow: '* 2-3 * * *',
        maintenancewindowtz: 'UTC',
      });
      docker.log = createMockLog(['info']);
      docker.watch = vi.fn().mockResolvedValue([]);

      // 08:00 digest flush: Trigger.deferAutoUpdateForMaintenanceWindow arms the catch-up.
      docker.queueMaintenanceWindowWatch();
      expect(docker.maintenanceWindowWatchQueued).toBe(true);

      // 12:00 ordinary cron tick, window still closed.
      await docker.watchFromCron();

      expect(docker.watch).toHaveBeenCalledTimes(1);
      expect(docker.maintenanceWindowWatchQueued).toBe(true);
      expect(docker.maintenanceWindowQueueTimeout).toBeDefined();
      expect(event.emitMaintenanceWindowOpened).not.toHaveBeenCalled();
      docker.clearMaintenanceWindowQueue();
    });

    // #946 D1: this tick is the one that consumes the arm, and consuming it cancels the
    // 60s poll that used to be the only announcer, so the tick has to announce or the
    // digest trigger's deferred install waits for the next digest cron.
    test('a tick inside an open window clears a catch-up armed by a webhook scan', async () => {
      maintenance.isInMaintenanceWindow.mockReturnValue(true);

      await docker.register('watcher', 'docker', 'test', {
        cron: '0 */6 * * *',
        maintenancewindow: '* 2-3 * * *',
        maintenancewindowtz: 'UTC',
      });
      docker.log = createMockLog(['info']);
      docker.watch = vi.fn().mockResolvedValue([]);

      docker.queueMaintenanceWindowWatch();
      await docker.watchFromCron();

      expect(docker.maintenanceWindowWatchQueued).toBe(false);
      expect(docker.maintenanceWindowQueueTimeout).toBeUndefined();
      expect(event.emitMaintenanceWindowOpened).toHaveBeenCalledWith({ watcherId: 'docker.test' });
    });

    test('a failed announcement is logged and does not fail the scan', async () => {
      maintenance.isInMaintenanceWindow.mockReturnValue(true);

      await docker.register('watcher', 'docker', 'test', {
        cron: '0 */6 * * *',
        maintenancewindow: '* 2-3 * * *',
        maintenancewindowtz: 'UTC',
      });
      docker.log = createMockLog(['info', 'warn']);
      docker.watch = vi.fn().mockResolvedValue([]);
      event.emitMaintenanceWindowOpened.mockRejectedValue(new Error('handler exploded'));

      docker.queueMaintenanceWindowWatch();

      await expect(docker.watchFromCron()).resolves.toEqual([]);
      expect(docker.log.warn).toHaveBeenCalledWith(
        expect.stringContaining('Unable to announce the maintenance window opening'),
      );
    });

    test('a failed announcement on a logger with no warn still does not fail the scan', async () => {
      maintenance.isInMaintenanceWindow.mockReturnValue(true);

      await docker.register('watcher', 'docker', 'test', {
        cron: '0 */6 * * *',
        maintenancewindow: '* 2-3 * * *',
        maintenancewindowtz: 'UTC',
      });
      docker.log = createMockLog(['info']);
      docker.watch = vi.fn().mockResolvedValue([]);
      event.emitMaintenanceWindowOpened.mockRejectedValue(new Error('handler exploded'));

      docker.queueMaintenanceWindowWatch();

      await expect(docker.watchFromCron()).resolves.toEqual([]);
      expect(docker.log.warn).toBeUndefined();
    });

    test('should report the next cron run as nextRunAt under the install scope', async () => {
      maintenance.isInMaintenanceWindow.mockReturnValue(false);
      maintenance.getNextMaintenanceWindow.mockReturnValue(new Date('2026-02-13T04:00:00.000Z'));
      mockCron.createTask.mockReturnValue({
        destroy: vi.fn(),
        timeMatcher: {
          getNextMatch: vi.fn(() => new Date('2026-02-13T03:00:00.000Z')),
        },
      });

      await docker.register('watcher', 'docker', 'test', {
        cron: '0 * * * *',
        maintenancewindow: '0 4 * * *',
        maintenancewindowtz: 'UTC',
      });
      // Even with a catch-up queued for a deferred install, the scan itself is on its cron.
      docker.maintenanceWindowWatchQueued = true;

      expect(docker.getMetadata().nextRunAt).toBe('2026-02-13T03:00:00.000Z');
    });

    test('should execute queued watch when maintenance window opens', async () => {
      vi.useFakeTimers();
      try {
        maintenance.isInMaintenanceWindow.mockReturnValue(false);

        await docker.register('watcher', 'docker', 'test', {
          cron: '0 * * * *',
          maintenancewindow: '0 2 * * *',
          maintenancewindowtz: 'UTC',
          maintenancewindowscope: 'scan',
        });
        docker.log = createMockLog(['info', 'warn']);
        docker.watch = vi.fn().mockResolvedValue([]);

        await docker.watchFromCron();
        expect(docker.maintenanceWindowWatchQueued).toBe(true);

        maintenance.isInMaintenanceWindow.mockReturnValue(true);
        await vi.advanceTimersByTimeAsync(60 * 1000);

        expect(docker.watch).toHaveBeenCalledTimes(1);
        expect(docker.maintenanceWindowWatchQueued).toBe(false);
        expect(docker.maintenanceWindowQueueTimeout).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });

    // #946 finding 3: the catch-up scan re-buffers for a digest trigger and nothing else,
    // so the watcher announces the opening and the trigger flushes what it deferred.
    test('announces the window opening after the catch-up scan has run', async () => {
      await docker.register('watcher', 'docker', 'test', {
        cron: '0 */6 * * *',
        maintenancewindow: '* 2-3 * * *',
        maintenancewindowtz: 'UTC',
      });
      docker.log = createMockLog(['info', 'warn']);
      const order: string[] = [];
      docker.watch = vi.fn().mockImplementation(async () => {
        order.push('watch');
        return [];
      });
      event.emitMaintenanceWindowOpened.mockImplementation(async () => {
        order.push('emit');
      });

      // Armed by a deferral, then the window opens under the 60s poll.
      docker.maintenanceWindowWatchQueued = true;
      maintenance.isInMaintenanceWindow.mockReturnValue(true);
      await docker.checkQueuedMaintenanceWindowWatch();

      expect(event.emitMaintenanceWindowOpened).toHaveBeenCalledWith({ watcherId: 'docker.test' });
      // Announced only after the scan, so the deferred containers are back in the store with
      // fresh state before any trigger flushes on them.
      expect(order).toEqual(['watch', 'emit']);
    });

    test('does not announce a window opening when the catch-up scan throws', async () => {
      await docker.register('watcher', 'docker', 'test', {
        cron: '0 */6 * * *',
        maintenancewindow: '* 2-3 * * *',
        maintenancewindowtz: 'UTC',
      });
      docker.log = createMockLog(['info', 'warn']);
      docker.watch = vi.fn().mockRejectedValue(new Error('socket gone'));

      docker.maintenanceWindowWatchQueued = true;
      maintenance.isInMaintenanceWindow.mockReturnValue(true);
      await docker.checkQueuedMaintenanceWindowWatch();

      expect(event.emitMaintenanceWindowOpened).not.toHaveBeenCalled();
      expect(docker.log.warn).toHaveBeenCalledWith(
        expect.stringContaining('Unable to run queued maintenance watch'),
      );
    });

    test('should clear queued maintenance watch when normal cron runs inside window', async () => {
      vi.useFakeTimers();
      try {
        maintenance.isInMaintenanceWindow.mockReturnValue(false);

        await docker.register('watcher', 'docker', 'test', {
          cron: '0 * * * *',
          maintenancewindow: '0 2 * * *',
          maintenancewindowtz: 'UTC',
          maintenancewindowscope: 'scan',
        });
        docker.log = createMockLog(['info']);
        docker.watch = vi.fn().mockResolvedValue([]);

        await docker.watchFromCron();
        expect(docker.maintenanceWindowWatchQueued).toBe(true);
        expect(docker.maintenanceWindowQueueTimeout).toBeDefined();

        maintenance.isInMaintenanceWindow.mockReturnValue(true);
        await docker.watchFromCron();

        expect(docker.watch).toHaveBeenCalledTimes(1);
        expect(docker.maintenanceWindowWatchQueued).toBe(false);
        expect(docker.maintenanceWindowQueueTimeout).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });

    test('should expose maintenance runtime state in masked configuration', async () => {
      maintenance.isInMaintenanceWindow.mockReturnValue(false);
      maintenance.getNextMaintenanceWindow.mockReturnValue(new Date('2026-02-13T02:00:00.000Z'));

      await docker.register('watcher', 'docker', 'test', {
        cron: '0 * * * *',
        maintenancewindow: '0 2 * * *',
        maintenancewindowtz: 'UTC',
      });
      docker.maintenanceWindowWatchQueued = true;

      const maskedConfiguration = docker.maskConfiguration();
      expect(maskedConfiguration.maintenancewindowopen).toBe(false);
      expect(maskedConfiguration.maintenancewindowqueued).toBe(true);
      expect(maskedConfiguration.maintenancenextwindow).toBe('2026-02-13T02:00:00.000Z');
    });

    test('should emit watcher events during watch', async () => {
      docker.getContainers = vi.fn().mockResolvedValue([]);

      await docker.watch();

      expect(event.emitWatcherStart).toHaveBeenCalledWith(docker);
      expect(event.emitWatcherStop).toHaveBeenCalledWith(docker);
    });

    test('should emit watcher snapshot when container enumeration succeeds', async () => {
      docker.getContainers = vi.fn().mockResolvedValue([]);

      await docker.watch();

      expect(event.emitWatcherSnapshot).toHaveBeenCalledTimes(1);
      expect(event.emitWatcherSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({ containers: [] }),
      );
    });

    test('should NOT emit watcher snapshot when container enumeration fails (issue #362)', async () => {
      docker.log = createMockLog(['warn']);
      docker.getContainers = vi.fn().mockRejectedValue(new Error('Docker unavailable'));

      await docker.watch();

      // Empty snapshot would prune every container for this agent on the
      // controller side; emission is suppressed so the controller keeps its
      // last-known state until the next clean cycle.
      expect(event.emitWatcherSnapshot).not.toHaveBeenCalled();
    });

    test('should NOT emit watcher snapshot when per-container enrichment drops containers (issue #386)', async () => {
      docker.log = createMockLog(['warn']);
      docker.getContainers = vi.fn().mockImplementation(async (diagnostics) => {
        if (diagnostics) {
          diagnostics.enrichmentErrors = 2;
        }
        return [];
      });

      await docker.watch();

      // A short or empty list caused by transient enrichment failures is just
      // as dangerous as a full enumeration failure: the controller prunes every
      // container not present in the snapshot, wiping the agent's view. Suppress
      // the snapshot so the controller keeps its last-known state until the next
      // fully clean cycle (per-container reports still emit above).
      expect(event.emitWatcherSnapshot).not.toHaveBeenCalled();
      expect(docker.log.warn).toHaveBeenCalledWith(
        expect.stringContaining('Container enumeration degraded'),
      );
    });

    test('should emit watcher snapshot when enrichment reports zero errors via diagnostics out-param', async () => {
      docker.getContainers = vi.fn().mockImplementation(async (diagnostics) => {
        if (diagnostics) {
          diagnostics.enrichmentErrors = 0;
        }
        return [];
      });

      await docker.watch();

      // Zero enrichment errors with the diagnostics out-param populated proves
      // the `=== 0` branch: the snapshot is emitted normally.
      expect(event.emitWatcherSnapshot).toHaveBeenCalledTimes(1);
    });

    test('should set lastRunAt after watch completes', async () => {
      docker.getContainers = vi.fn().mockResolvedValue([]);
      expect(docker.lastRunAt).toBeUndefined();

      await docker.watch();

      expect(docker.lastRunAt).toBeDefined();
      expect(new Date(docker.lastRunAt).toISOString()).toBe(docker.lastRunAt);
    });

    test('should set lastRunAt even when watch encounters errors', async () => {
      docker.log = createMockLog(['warn']);
      docker.getContainers = vi.fn().mockRejectedValue(new Error('Docker unavailable'));

      await docker.watch();

      expect(docker.lastRunAt).toBeDefined();
    });

    test('should expose lastRunAt via getMetadata', async () => {
      docker.getContainers = vi.fn().mockResolvedValue([]);

      expect(docker.getMetadata()).toStrictEqual({
        lastRunAt: undefined,
        nextRunAt: undefined,
      });

      await docker.watch();

      expect(docker.getMetadata().lastRunAt).toBeDefined();
    });

    test('should expose nextRunAt via getMetadata when cron is scheduled', async () => {
      mockCron.createTask.mockReturnValue({
        destroy: vi.fn(),
        timeMatcher: {
          getNextMatch: vi.fn(() => new Date('2026-02-13T03:00:00.000Z')),
        },
      });

      await docker.register('watcher', 'docker', 'test', {
        cron: '0 * * * *',
      });

      expect(docker.getMetadata().nextRunAt).toBe('2026-02-13T03:00:00.000Z');
    });

    test('should expose queued maintenance window as the next run', async () => {
      maintenance.getNextMaintenanceWindow.mockReturnValue(new Date('2026-02-13T04:00:00.000Z'));
      mockCron.createTask.mockReturnValue({
        destroy: vi.fn(),
        timeMatcher: {
          getNextMatch: vi.fn(() => new Date('2026-02-13T03:00:00.000Z')),
        },
      });

      await docker.register('watcher', 'docker', 'test', {
        cron: '0 * * * *',
        maintenancewindow: '0 4 * * *',
        maintenancewindowtz: 'UTC',
        maintenancewindowscope: 'scan',
      });
      docker.maintenanceWindowWatchQueued = true;

      expect(docker.getMetadata().nextRunAt).toBe('2026-02-13T04:00:00.000Z');
    });

    test('should expose the next maintenance window when the next cron falls outside it', async () => {
      maintenance.isInMaintenanceWindow.mockImplementation(
        (_cronExpression, _tz, atDate) =>
          !(atDate instanceof Date && atDate.toISOString() === '2026-02-13T03:00:00.000Z'),
      );
      maintenance.getNextMaintenanceWindow.mockReturnValue(new Date('2026-02-13T04:00:00.000Z'));
      mockCron.createTask.mockReturnValue({
        destroy: vi.fn(),
        timeMatcher: {
          getNextMatch: vi.fn(() => new Date('2026-02-13T03:00:00.000Z')),
        },
      });

      await docker.register('watcher', 'docker', 'test', {
        cron: '0 * * * *',
        maintenancewindow: '0 4 * * *',
        maintenancewindowtz: 'UTC',
        maintenancewindowscope: 'scan',
      });

      expect(docker.getMetadata().nextRunAt).toBe('2026-02-13T04:00:00.000Z');
    });

    test('should start and end digest cache poll cycle for cache-aware registries', async () => {
      const startDigestCachePollCycle = vi.fn();
      const endDigestCachePollCycle = vi.fn();
      registry.getState.mockReturnValue({
        registry: {
          hub: {
            startDigestCachePollCycle,
            endDigestCachePollCycle,
          },
        },
      });
      docker.getContainers = vi.fn().mockResolvedValue([]);

      await docker.watch();

      expect(startDigestCachePollCycle).toHaveBeenCalledTimes(1);
      expect(endDigestCachePollCycle).toHaveBeenCalledTimes(1);
    });

    test('should opt bulk container lookups into the registry poll cache', async () => {
      const container = { id: 'poll-container', name: 'poll-container' };
      docker.getContainers = vi.fn().mockResolvedValue([container]);
      docker.watchContainer = vi.fn().mockResolvedValue({ container, changed: false });

      await docker.watch();

      expect(docker.watchContainer).toHaveBeenCalledWith(container, {
        useRegistryPollCache: true,
      });
    });

    test('should end digest cache poll cycle even when watch throws while listing containers', async () => {
      const startDigestCachePollCycle = vi.fn();
      const endDigestCachePollCycle = vi.fn();
      registry.getState.mockReturnValue({
        registry: {
          hub: {
            startDigestCachePollCycle,
            endDigestCachePollCycle,
          },
        },
      });
      const mockLog = createMockLog(['warn']);
      docker.log = mockLog;
      docker.getContainers = vi.fn().mockRejectedValue(new Error('Docker unavailable'));

      await docker.watch();

      expect(startDigestCachePollCycle).toHaveBeenCalledTimes(1);
      expect(endDigestCachePollCycle).toHaveBeenCalledTimes(1);
    });

    test('should limit concurrent container processing during watch', async () => {
      const containers = Array.from({ length: 12 }, (_unused, index) => ({ id: `c${index}` }));
      const concurrencyProbe = createConcurrencyProbe((container: { id: string }) => ({
        container,
        changed: false,
      }));
      docker.log = createMockLog(['warn', 'debug']);
      docker.getContainers = vi.fn().mockResolvedValue(containers);
      docker.watchContainer = vi.fn((container) => concurrencyProbe.run(container));

      const watchPromise = docker.watch();

      try {
        await vi.waitFor(() => expect(concurrencyProbe.started).toBeGreaterThan(0));
        await Promise.resolve();

        expect(concurrencyProbe.maxActive).toBeLessThanOrEqual(10);
        expect(concurrencyProbe.started).toBeLessThan(containers.length);

        concurrencyProbe.releaseAll();
        await vi.waitFor(() => expect(concurrencyProbe.started).toBe(containers.length));
        concurrencyProbe.releaseAll();
        await expect(watchPromise).resolves.toHaveLength(containers.length);
      } finally {
        concurrencyProbe.releaseAll();
      }
    });

    test('should handle error getting containers', async () => {
      const mockLog = createMockLog(['warn']);
      docker.log = mockLog;
      docker.getContainers = vi.fn().mockRejectedValue(new Error('Docker unavailable'));

      await docker.watch();

      expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('Docker unavailable'));
    });

    test('should handle error processing containers', async () => {
      const mockLog = createMockLog(['warn']);
      docker.log = mockLog;
      docker.getContainers = vi.fn().mockResolvedValue([{ id: 'test' }]);
      docker.watchContainer = vi.fn().mockRejectedValue(new Error('Processing failed'));

      const result = await docker.watch();

      expect(result).toEqual([
        {
          container: {
            id: 'test',
            error: { message: 'Processing failed' },
            updateAvailable: false,
            updateKind: { kind: 'unknown' },
          },
          changed: false,
        },
      ]);
      expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('Processing failed'));
    });

    test('should continue processing when one container fails during watch', async () => {
      const mockLog = createMockLog(['warn']);
      docker.log = mockLog;
      docker.getContainers = vi.fn().mockResolvedValue([{ id: 'failed' }, { id: 'ok' }]);
      docker.watchContainer = vi
        .fn()
        .mockRejectedValueOnce(new Error('failed to process'))
        .mockResolvedValueOnce({
          container: { id: 'ok', updateAvailable: false },
          changed: false,
        });

      const result = await docker.watch();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        container: {
          id: 'failed',
          error: { message: 'failed to process' },
          updateAvailable: false,
          updateKind: { kind: 'unknown' },
        },
        changed: false,
      });
      expect(result[1]).toEqual({
        container: { id: 'ok', updateAvailable: false },
        changed: false,
      });
      expect(event.emitContainerReports).toHaveBeenCalledWith(result);
      expect(event.emitWatcherSnapshot).toHaveBeenCalledWith({
        watcher: expect.objectContaining({
          type: docker.type,
          name: docker.name,
          configuration: expect.any(Object),
          metadata: expect.objectContaining({ lastRunAt: expect.any(String) }),
        }),
        containers: result.map((report) => report.container),
      });
    });

    test('should await async fallback, batch, and snapshot emitters during watch', async () => {
      docker.log = createMockLog(['warn']);
      docker.getContainers = vi.fn().mockResolvedValue([{ id: 'failed' }]);
      docker.watchContainer = vi.fn().mockRejectedValue(new Error('Processing failed'));

      let resolveFallbackEmit;
      let resolveBatchEmit;
      let resolveSnapshotEmit;
      const fallbackEmitPromise = new Promise<void>((resolve) => {
        resolveFallbackEmit = resolve;
      });
      const batchEmitPromise = new Promise<void>((resolve) => {
        resolveBatchEmit = resolve;
      });
      const snapshotEmitPromise = new Promise<void>((resolve) => {
        resolveSnapshotEmit = resolve;
      });

      event.emitContainerReport.mockReturnValueOnce(fallbackEmitPromise);
      event.emitContainerReports.mockReturnValueOnce(batchEmitPromise);
      event.emitWatcherSnapshot.mockReturnValueOnce(snapshotEmitPromise);

      let resolved = false;
      const watchPromise = docker.watch().then((result) => {
        resolved = true;
        return result;
      });

      await vi.waitFor(() =>
        expect(event.emitContainerReport).toHaveBeenCalledWith(
          expect.objectContaining({
            container: expect.objectContaining({ id: 'failed' }),
            changed: false,
          }),
        ),
      );
      expect(event.emitContainerReports).not.toHaveBeenCalled();
      expect(event.emitWatcherSnapshot).not.toHaveBeenCalled();
      expect(resolved).toBe(false);

      resolveFallbackEmit();
      await vi.waitFor(() => expect(event.emitContainerReports).toHaveBeenCalledTimes(1));
      expect(event.emitWatcherSnapshot).not.toHaveBeenCalled();
      expect(resolved).toBe(false);

      resolveBatchEmit();
      await vi.waitFor(() => expect(event.emitWatcherSnapshot).toHaveBeenCalledTimes(1));
      expect(resolved).toBe(false);

      resolveSnapshotEmit();
      await watchPromise;
      expect(resolved).toBe(true);
    });

    test('should surface async container report batch emitter failures during watch', async () => {
      docker.getContainers = vi.fn().mockResolvedValue([]);
      event.emitContainerReports.mockRejectedValueOnce(new Error('batch emit failed'));

      await expect(docker.watch()).rejects.toThrow('batch emit failed');
      expect(event.emitWatcherSnapshot).not.toHaveBeenCalled();
      expect(event.emitWatcherStop).toHaveBeenCalledWith(docker);
    });

    test('should skip containers refreshed by registry webhooks on the next scheduled poll', async () => {
      const freshContainer = {
        id: 'fresh-id',
        name: 'fresh-container',
        watcher: 'test',
      };
      const regularContainer = {
        id: 'regular-id',
        name: 'regular-container',
        watcher: 'test',
      };
      docker.log = createMockLog(['warn', 'info', 'debug']);
      docker.getContainers = vi.fn().mockResolvedValue([freshContainer, regularContainer]);
      docker.watchContainer = vi.fn().mockImplementation(async (container) => ({
        container: { ...container, updateAvailable: false },
        changed: false,
      }));
      markContainerFreshForScheduledPollSkip('fresh-id');

      const result = await docker.watchFromCron();

      expect(docker.watchContainer).toHaveBeenCalledTimes(1);
      expect(docker.watchContainer).toHaveBeenCalledWith(regularContainer, {
        useRegistryPollCache: true,
      });
      expect(result).toHaveLength(1);
      expect(docker.log.debug).toHaveBeenCalledWith(
        expect.stringContaining('Skipping scheduled poll'),
      );
    });
  });

  describe('controller-local enumerated container ids (DR-106)', () => {
    // The agent ingestion gate decides ownership of a no-record container id
    // on what the controller's own watchers are enumerating, because watcher
    // names collide by default: a controller with no DD_WATCHER_* and an
    // agent following the quickstart are both called `local`.

    test('records every id listContainers returned, replacing the set each cycle', async () => {
      mockDockerApi.listContainers.mockResolvedValue([
        { Id: 'id-a', Labels: {}, Names: ['/a'] },
        { Id: 'id-b', Labels: {}, Names: ['/b'] },
      ]);
      await docker.register('watcher', 'docker', 'local', { watchbydefault: false });
      docker.log = createMockLog();

      await docker.getContainers();

      // Recorded straight off listContainers(), before the watch filter and
      // the discovery settle window, which is the window the gate closes.
      expect(findControllerLocalWatcherClaimingContainerId('id-a')).toBe('docker.local');
      expect(findControllerLocalWatcherClaimingContainerId('id-b')).toBe('docker.local');

      mockDockerApi.listContainers.mockResolvedValue([{ Id: 'id-b', Labels: {}, Names: ['/b'] }]);
      await docker.getContainers();

      expect(findControllerLocalWatcherClaimingContainerId('id-a')).toBeUndefined();
      expect(findControllerLocalWatcherClaimingContainerId('id-b')).toBe('docker.local');
    });

    test('records nothing for a controller-Docker-transport agent watcher', async () => {
      // This watcher runs in the controller process but enumerates the agent's
      // daemon, so recording its ids would make that agent collide with itself.
      mockDockerApi.listContainers.mockResolvedValue([
        { Id: 'agent-id', Labels: {}, Names: ['/x'] },
      ]);
      await docker.register('watcher', 'docker', 'local', { watchbydefault: false }, 'remote1');
      docker.log = createMockLog();

      await docker.getContainers();

      expect(findControllerLocalWatcherClaimingContainerId('agent-id')).toBeUndefined();
    });

    test('deregistering the watcher clears the ids it was claiming', async () => {
      mockDockerApi.listContainers.mockResolvedValue([{ Id: 'id-a', Labels: {}, Names: ['/a'] }]);
      await docker.register('watcher', 'docker', 'local', { watchbydefault: false });
      docker.log = createMockLog();
      await docker.getContainers();
      expect(findControllerLocalWatcherClaimingContainerId('id-a')).toBe('docker.local');

      await docker.deregisterComponent();

      expect(findControllerLocalWatcherClaimingContainerId('id-a')).toBeUndefined();
    });

    test('seeds the id set during init(), before the first startup cron tick fires', async () => {
      // register() awaits init(), and the startup watch is only *scheduled*
      // there (START_WATCHER_DELAY_MS later). Fake timers with no advance
      // proves the claim exists the moment init() resolves, not because the
      // scheduled tick already ran.
      vi.useFakeTimers();
      mockDockerApi.listContainers.mockResolvedValue([
        { Id: 'startup-id', Labels: {}, Names: ['/a'] },
      ]);

      await docker.register('watcher', 'docker', 'local', { watchbydefault: false });

      expect(findControllerLocalWatcherClaimingContainerId('startup-id')).toBe('docker.local');
      // listContainers() ran exactly once: the seed, not a cron tick.
      expect(mockDockerApi.listContainers).toHaveBeenCalledTimes(1);
    });
  });

  describe('Additional Coverage - watchFromCron and getContainers', () => {
    test('should return empty when log is missing', async () => {
      await docker.register('watcher', 'docker', 'test', { cron: '0 * * * *' });
      docker.log = null;
      expect(await docker.watchFromCron()).toEqual([]);
    });

    test('should filter out containers when addImageDetailsToContainer throws', async () => {
      mockDockerApi.listContainers.mockResolvedValue([
        { Id: '1', Labels: { 'dd.watch': 'true' }, Names: ['/test1'] },
      ]);
      docker.addImageDetailsToContainer = vi
        .fn()
        .mockRejectedValue(new Error('Image inspect failed'));
      await docker.register('watcher', 'docker', 'test', { watchbydefault: true });
      docker.log = createMockLog(['warn', 'info', 'debug']);
      const result = await docker.getContainers();
      expect(docker.log.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to fetch image detail'),
      );
      expect(result).toHaveLength(0);
    });

    test('should write dropped-container count into diagnostics when enrichment throws (issue #386)', async () => {
      mockDockerApi.listContainers.mockResolvedValue([
        { Id: '1', Labels: { 'dd.watch': 'true' }, Names: ['/test1'] },
        { Id: '2', Labels: { 'dd.watch': 'true' }, Names: ['/test2'] },
      ]);
      docker.addImageDetailsToContainer = vi
        .fn()
        .mockRejectedValue(new Error('Image inspect failed'));
      await docker.register('watcher', 'docker', 'test', { watchbydefault: true });
      docker.log = createMockLog(['warn', 'info', 'debug']);

      const diagnostics = { enrichmentErrors: 0 };
      const result = await docker.getContainers(diagnostics);

      // Both containers failed enrichment — result is empty and diagnostics
      // reflects the count so watch() can suppress the authoritative snapshot.
      expect(result).toHaveLength(0);
      expect(diagnostics.enrichmentErrors).toBe(2);
    });

    test('should fallback to stringified error when image detail fetch error has empty message', async () => {
      const getErrorMessageSpy = vi.spyOn(dockerHelpers, 'getErrorMessage').mockReturnValue('');
      try {
        mockDockerApi.listContainers.mockResolvedValue([
          { Id: '1', Labels: { 'dd.watch': 'true' }, Names: ['/test1'] },
        ]);
        docker.addImageDetailsToContainer = vi.fn().mockRejectedValue({ message: '' });
        await docker.register('watcher', 'docker', 'test', { watchbydefault: true });
        docker.log = createMockLog(['warn', 'info', 'debug']);

        const result = await docker.getContainers();

        expect(docker.log.warn).toHaveBeenCalledWith(
          expect.stringContaining('test1: Failed to fetch image detail ([object Object])'),
        );
        // Non-Error thrown value is wrapped into an Error and excluded from result
        expect(result).toEqual([]);
      } finally {
        getErrorMessageSpy.mockRestore();
      }
    });

    test('should count non-Error rejection as enrichment error and exclude it from containers', async () => {
      mockDockerApi.listContainers.mockResolvedValue([
        { Id: '1', Labels: { 'dd.watch': 'true' }, Names: ['/test1'] },
      ]);
      docker.addImageDetailsToContainer = vi.fn().mockRejectedValue('socket timeout');
      await docker.register('watcher', 'docker', 'test', { watchbydefault: true });
      docker.log = createMockLog(['warn', 'info', 'debug']);

      const diagnostics = { enrichmentErrors: 0 };
      const result = await docker.getContainers(diagnostics);

      expect(docker.log.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to fetch image detail'),
      );
      // String rejection is wrapped to an Error — counted as error, not a container
      expect(result).toHaveLength(0);
      expect(diagnostics.enrichmentErrors).toBe(1);
    });

    test('should use container id fallback in image-detail warning when docker names are missing', async () => {
      mockDockerApi.listContainers.mockResolvedValue([
        {
          Id: '1234567890abcdef',
          Labels: { 'dd.watch': 'true' },
          Names: undefined,
        },
      ]);
      docker.addImageDetailsToContainer = vi
        .fn()
        .mockRejectedValue(new Error('Image inspect failed'));
      await docker.register('watcher', 'docker', 'test', { watchbydefault: true });
      docker.log = createMockLog(['warn', 'info', 'debug']);

      const result = await docker.getContainers();

      expect(docker.log.warn).toHaveBeenCalledWith(
        expect.stringContaining('1234567890ab: Failed to fetch image detail'),
      );
      expect(result).toHaveLength(0);
    });

    test('should limit concurrent effective label resolution during getContainers', async () => {
      const rawContainers = Array.from({ length: 12 }, (_unused, index) => ({
        Id: `container-${index}`,
        Labels: { 'dd.watch': 'true' },
        Names: [`/container-${index}`],
      }));
      const concurrencyProbe = createConcurrencyProbe(
        (container: { Labels: Record<string, string> }) => ({
          ...container.Labels,
        }),
      );
      mockDockerApi.listContainers.mockResolvedValue(rawContainers);
      docker.getEffectiveContainerLabels = vi.fn((container) => concurrencyProbe.run(container));
      docker.addImageDetailsToContainer = vi.fn((container) =>
        Promise.resolve({ id: container.Id, name: container.Names[0].slice(1) }),
      );
      await docker.register('watcher', 'docker', 'test', { watchbydefault: true });
      docker.log = createMockLog(['warn', 'info', 'debug']);

      const getContainersPromise = docker.getContainers();

      try {
        await vi.waitFor(() => expect(concurrencyProbe.started).toBeGreaterThan(0));
        await Promise.resolve();

        expect(concurrencyProbe.maxActive).toBeLessThanOrEqual(10);
        expect(concurrencyProbe.started).toBeLessThan(rawContainers.length);

        concurrencyProbe.releaseAll();
        await vi.waitFor(() => expect(concurrencyProbe.started).toBe(rawContainers.length));
        concurrencyProbe.releaseAll();
        await expect(getContainersPromise).resolves.toHaveLength(rawContainers.length);
      } finally {
        concurrencyProbe.releaseAll();
      }
    });

    test('should limit concurrent image-detail enrichment during getContainers', async () => {
      const rawContainers = Array.from({ length: 12 }, (_unused, index) => ({
        Id: `container-${index}`,
        Labels: { 'dd.watch': 'true' },
        Names: [`/container-${index}`],
      }));
      const concurrencyProbe = createConcurrencyProbe(
        (container: { Id: string; Names: string[] }) => ({
          id: container.Id,
          name: container.Names[0].slice(1),
        }),
      );
      mockDockerApi.listContainers.mockResolvedValue(rawContainers);
      docker.getEffectiveContainerLabels = vi.fn((container) => Promise.resolve(container.Labels));
      docker.addImageDetailsToContainer = vi.fn((container) => concurrencyProbe.run(container));
      await docker.register('watcher', 'docker', 'test', { watchbydefault: true });
      docker.log = createMockLog(['warn', 'info', 'debug']);

      const getContainersPromise = docker.getContainers();

      try {
        await vi.waitFor(() => expect(concurrencyProbe.started).toBeGreaterThan(0));
        await Promise.resolve();

        expect(concurrencyProbe.maxActive).toBeLessThanOrEqual(10);
        expect(concurrencyProbe.started).toBeLessThan(rawContainers.length);

        concurrencyProbe.releaseAll();
        await vi.waitFor(() => expect(concurrencyProbe.started).toBe(rawContainers.length));
        concurrencyProbe.releaseAll();
        await expect(getContainersPromise).resolves.toHaveLength(rawContainers.length);
      } finally {
        concurrencyProbe.releaseAll();
      }
    });

    test('should skip maintenance counter increment when counter is unavailable', async () => {
      await docker.register('watcher', 'docker', 'test', {
        cron: '0 * * * *',
        maintenancewindow: '0 2 * * *',
      });
      docker.log = createMockLog(['info', 'warn', 'debug']);
      maintenance.isInMaintenanceWindow.mockReturnValue(false);
      mockPrometheus.getMaintenanceSkipCounter.mockReturnValue(undefined);

      const result = await docker.watchFromCron();
      expect(result).toEqual([]);
    });

    test('should complete cron when info logger is removed before final summary', async () => {
      await docker.register('watcher', 'docker', 'test', { cron: '0 * * * *' });
      docker.log = createMockLog(['info', 'warn', 'debug']);
      docker.watch = vi.fn().mockImplementation(async () => {
        delete docker.log.info;
        return [];
      });

      const result = await docker.watchFromCron();
      expect(result).toEqual([]);
    });
  });

  describe('Agent mode - Prometheus gauge not initialized', () => {
    test('should not crash when getWatchContainerGauge returns undefined', async () => {
      mockPrometheus.getWatchContainerGauge.mockReturnValue(undefined);
      mockDockerApi.listContainers.mockResolvedValue([]);
      storeContainer.getContainers.mockReturnValue([]);
      await docker.register('watcher', 'docker', 'test', { watchbydefault: true });
      docker.log = createMockLog(['warn', 'info', 'debug']);
      const result = await docker.getContainers();
      expect(result).toHaveLength(0);
    });
  });

  describe('Additional Coverage - watchFromCron ensureLogger guard', () => {
    test('should return empty array when ensureLogger produces non-functional log', async () => {
      await docker.register('watcher', 'docker', 'test', { cron: '0 * * * *' });
      docker.ensureLogger = () => {
        docker.log = {};
      };
      const result = await docker.watchFromCron();
      expect(result).toEqual([]);
    });
  });

  describe('Additional Coverage - maintenance queue internals', () => {
    test('should consider maintenance window open and next date undefined when no window is configured', () => {
      docker.configuration.maintenancewindow = undefined;
      expect(docker.isMaintenanceWindowOpen()).toBe(true);
      expect(docker.getNextMaintenanceWindowDate()).toBeUndefined();
    });

    test('queueMaintenanceWindowWatch should not schedule twice when queue timeout already exists', () => {
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
      docker.maintenanceWindowQueueTimeout = { existing: true } as any;

      docker.queueMaintenanceWindowWatch();

      expect(docker.maintenanceWindowWatchQueued).toBe(true);
      expect(setTimeoutSpy).not.toHaveBeenCalled();
      setTimeoutSpy.mockRestore();
      docker.maintenanceWindowQueueTimeout = undefined;
    });

    test('checkQueuedMaintenanceWindowWatch should clear queue when no maintenance window is configured', async () => {
      docker.configuration.maintenancewindow = undefined;
      docker.maintenanceWindowWatchQueued = true;
      const clearSpy = vi.spyOn(docker, 'clearMaintenanceWindowQueue');

      await docker.checkQueuedMaintenanceWindowWatch();

      expect(clearSpy).toHaveBeenCalled();
    });

    test('checkQueuedMaintenanceWindowWatch should requeue when maintenance window remains closed', async () => {
      docker.configuration.maintenancewindow = '0 2 * * *';
      docker.maintenanceWindowWatchQueued = true;
      maintenance.isInMaintenanceWindow.mockReturnValue(false);
      const queueSpy = vi.spyOn(docker, 'queueMaintenanceWindowWatch');

      await docker.checkQueuedMaintenanceWindowWatch();

      expect(queueSpy).toHaveBeenCalled();
    });

    test('checkQueuedMaintenanceWindowWatch should warn when queued execution fails', async () => {
      docker.configuration.maintenancewindow = '0 2 * * *';
      docker.maintenanceWindowWatchQueued = true;
      maintenance.isInMaintenanceWindow.mockReturnValue(true);
      docker.log = createMockLog(['info', 'warn']);
      docker.watchFromCron = vi.fn().mockRejectedValue(new Error('queued-failure'));

      await docker.checkQueuedMaintenanceWindowWatch();

      expect(docker.log.warn).toHaveBeenCalledWith(
        expect.stringContaining('Unable to run queued maintenance watch (queued-failure)'),
      );
    });

    test('queueMaintenanceWindowWatch should execute scheduled callback when timer fires', async () => {
      vi.useFakeTimers();
      try {
        const checkSpy = vi
          .spyOn(docker, 'checkQueuedMaintenanceWindowWatch')
          .mockResolvedValue(undefined);
        docker.maintenanceWindowQueueTimeout = undefined;

        docker.queueMaintenanceWindowWatch();
        await vi.runOnlyPendingTimersAsync();

        expect(checkSpy).toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    test('checkQueuedMaintenanceWindowWatch should proceed without logging when info method is missing', async () => {
      docker.configuration.maintenancewindow = '0 2 * * *';
      docker.maintenanceWindowWatchQueued = true;
      maintenance.isInMaintenanceWindow.mockReturnValue(true);
      docker.log = createMockLog(['warn']);
      docker.watchFromCron = vi.fn().mockResolvedValue([]);

      await docker.checkQueuedMaintenanceWindowWatch();

      expect(docker.watchFromCron).toHaveBeenCalledWith({
        ignoreMaintenanceWindow: true,
        reason: 'maintenance-window',
      });
    });

    test('checkQueuedMaintenanceWindowWatch should swallow queued errors when warn method is missing', async () => {
      docker.configuration.maintenancewindow = '0 2 * * *';
      docker.maintenanceWindowWatchQueued = true;
      maintenance.isInMaintenanceWindow.mockReturnValue(true);
      docker.log = createMockLog(['info']);
      docker.watchFromCron = vi.fn().mockRejectedValue(new Error('queued-failure'));

      await expect(docker.checkQueuedMaintenanceWindowWatch()).resolves.toBeUndefined();
    });
  });
});
