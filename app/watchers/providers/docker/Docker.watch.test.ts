import type { Mocked } from 'vitest';
import * as event from '../../../event/index.js';
import { fullName } from '../../../model/container.js';
import * as registry from '../../../registry/index.js';
import * as storeContainer from '../../../store/container.js';
import { mockConstructor } from '../../../test/mock-constructor.js';
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
vi.mock('./maintenance.js', () => ({
  isInMaintenanceWindow: vi.fn(() => true),
  getNextMaintenanceWindow: vi.fn(() => undefined),
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

let mockImage;

describe('Docker Watcher', () => {
  let docker;
  let mockDockerApi;
  let mockSchedule;
  let mockContainer;

  beforeEach(async () => {
    vi.clearAllMocks();
    _resetRegistryWebhookFreshStateForTests();

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

    test('should execute queued watch when maintenance window opens', async () => {
      vi.useFakeTimers();
      try {
        maintenance.isInMaintenanceWindow.mockReturnValue(false);

        await docker.register('watcher', 'docker', 'test', {
          cron: '0 * * * *',
          maintenancewindow: '0 2 * * *',
          maintenancewindowtz: 'UTC',
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

    test('should clear queued maintenance watch when normal cron runs inside window', async () => {
      vi.useFakeTimers();
      try {
        maintenance.isInMaintenanceWindow.mockReturnValue(false);

        await docker.register('watcher', 'docker', 'test', {
          cron: '0 * * * *',
          maintenancewindow: '0 2 * * *',
          maintenancewindowtz: 'UTC',
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

      expect(docker.getMetadata()).toStrictEqual({ lastRunAt: undefined });

      await docker.watch();

      expect(docker.getMetadata().lastRunAt).toBeDefined();
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
        watcher: { type: docker.type, name: docker.name },
        containers: result.map((report) => report.container),
      });
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
      expect(docker.watchContainer).toHaveBeenCalledWith(regularContainer);
      expect(result).toHaveLength(1);
      expect(docker.log.debug).toHaveBeenCalledWith(
        expect.stringContaining('Skipping scheduled poll'),
      );
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
        expect(result).toEqual([{ message: '' }]);
      } finally {
        getErrorMessageSpy.mockRestore();
      }
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
