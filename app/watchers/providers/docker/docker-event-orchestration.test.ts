import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../../store/container.js', () => ({
  getContainer: vi.fn(),
}));

vi.mock('./container-event-update.js', () => ({
  processDockerEvent: vi.fn(),
}));

import * as storeContainer from '../../../store/container.js';
import { processDockerEvent as processDockerEventState } from './container-event-update.js';
import {
  invalidateDockerEventStreamOrchestration,
  listenDockerEventsOrchestration,
  onDockerEventOrchestration,
  processDockerEventOrchestration,
  processDockerEventPayloadOrchestration,
} from './docker-event-orchestration.js';

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createWatcher(overrides: Record<string, any> = {}) {
  const streamHandlers: Record<string, (...args: any[]) => unknown> = {};
  const stream = {
    on: vi.fn((eventName: string, handler: (...args: any[]) => unknown) => {
      streamHandlers[eventName] = handler;
    }),
    pause: vi.fn(),
    resume: vi.fn(),
    destroy: vi.fn(),
  };

  const watcher = {
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
    configuration: {
      watchevents: true,
    },
    dockerApi: {
      getContainer: vi.fn().mockReturnValue({
        inspect: vi.fn().mockResolvedValue({ State: { Status: 'running' } }),
      }),
      getEvents: vi.fn((_options, callback) => callback(undefined, stream)),
    },
    watchCronDebounced: vi.fn().mockResolvedValue(undefined),
    dockerEventsReconnectTimeout: undefined,
    isDockerEventsListenerActive: true,
    dockerEventsBuffer: 'stale',
    dockerEventsStream: undefined,
    ensureLogger: vi.fn(),
    ensureRemoteAuthHeaders: vi.fn().mockResolvedValue(undefined),
    scheduleDockerEventsReconnect: vi.fn(),
    cleanupDockerEventsStream: vi.fn(),
    resetDockerEventsReconnectBackoff: vi.fn(),
    onDockerEventsStreamFailure: vi.fn(),
    onDockerEvent: vi.fn().mockResolvedValue(undefined),
    processDockerEventPayload: vi.fn().mockResolvedValue(true),
    processDockerEvent: vi.fn().mockResolvedValue(undefined),
    recordRecentDockerEvent: vi.fn(),
    updateContainerFromInspect: vi.fn(),
    isRecoverableDockerEventParseError: vi.fn().mockReturnValue(false),
    ...overrides,
  };

  return { watcher, stream, streamHandlers };
}

describe('docker event orchestration helpers', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  test('listenDockerEventsOrchestration returns early when logger info is unavailable', async () => {
    const { watcher } = createWatcher({
      log: {},
    });

    await listenDockerEventsOrchestration(watcher as any);

    expect(watcher.ensureRemoteAuthHeaders).not.toHaveBeenCalled();
    expect(watcher.dockerApi.getEvents).not.toHaveBeenCalled();
  });

  test('listenDockerEventsOrchestration returns early when events are disabled or listener inactive', async () => {
    const disabledWatcher = createWatcher({
      configuration: { watchevents: false },
    }).watcher;
    const inactiveWatcher = createWatcher({
      isDockerEventsListenerActive: false,
    }).watcher;

    await listenDockerEventsOrchestration(disabledWatcher as any);
    await listenDockerEventsOrchestration(inactiveWatcher as any);

    expect(disabledWatcher.dockerApi.getEvents).not.toHaveBeenCalled();
    expect(inactiveWatcher.dockerApi.getEvents).not.toHaveBeenCalled();
  });

  test('listenDockerEventsOrchestration clears pending reconnect timeout and schedules reconnect on auth failure', async () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
    const reconnectTimeout = setTimeout(() => undefined, 60_000);
    const authError = new Error('auth failed');
    const { watcher } = createWatcher({
      dockerEventsReconnectTimeout: reconnectTimeout,
      ensureRemoteAuthHeaders: vi.fn().mockRejectedValue(authError),
    });

    await listenDockerEventsOrchestration(watcher as any);

    expect(clearTimeoutSpy).toHaveBeenCalledWith(reconnectTimeout);
    expect(watcher.dockerEventsReconnectTimeout).toBeUndefined();
    expect(watcher.log.warn).toHaveBeenCalledWith(
      'Unable to initialize remote watcher auth for docker events (auth failed)',
    );
    expect(watcher.scheduleDockerEventsReconnect).toHaveBeenCalledWith(
      'auth initialization failure',
      authError,
    );
    expect(watcher.dockerApi.getEvents).not.toHaveBeenCalled();
  });

  test('listenDockerEventsOrchestration handles non-object auth error gracefully', async () => {
    const { watcher } = createWatcher({
      ensureRemoteAuthHeaders: vi.fn().mockRejectedValue('string error'),
    });

    await listenDockerEventsOrchestration(watcher as any);

    expect(watcher.log.warn).toHaveBeenCalledWith(
      'Unable to initialize remote watcher auth for docker events (undefined)',
    );
    expect(watcher.scheduleDockerEventsReconnect).toHaveBeenCalledWith(
      'auth initialization failure',
      'string error',
    );
    expect(watcher.dockerApi.getEvents).not.toHaveBeenCalled();
  });

  test('listenDockerEventsOrchestration calls recreateDockerClient when provided', async () => {
    const recreateDockerClient = vi.fn().mockResolvedValue(undefined);
    const { watcher } = createWatcher({ recreateDockerClient });

    await listenDockerEventsOrchestration(watcher as any);

    expect(recreateDockerClient).toHaveBeenCalled();
    expect(watcher.ensureRemoteAuthHeaders).toHaveBeenCalled();
    expect(watcher.dockerApi.getEvents).toHaveBeenCalled();
  });

  test('listenDockerEventsOrchestration schedules reconnect when recreateDockerClient fails', async () => {
    const recreateError = new Error('socket reset');
    const recreateDockerClient = vi.fn().mockRejectedValue(recreateError);
    const { watcher } = createWatcher({ recreateDockerClient });

    await listenDockerEventsOrchestration(watcher as any);

    expect(watcher.log.warn).toHaveBeenCalledWith(
      'Unable to recreate Docker client during reconnect (socket reset)',
    );
    expect(watcher.scheduleDockerEventsReconnect).toHaveBeenCalledWith(
      'client recreation failure',
      recreateError,
    );
    expect(watcher.ensureRemoteAuthHeaders).not.toHaveBeenCalled();
    expect(watcher.dockerApi.getEvents).not.toHaveBeenCalled();
  });

  test('listenDockerEventsOrchestration bails out before opening a stream when the watcher is deregistered while recreateDockerClient is pending', async () => {
    const recreate = createDeferred<void>();
    const recreateDockerClient = vi.fn().mockReturnValue(recreate.promise);
    const { watcher } = createWatcher({ recreateDockerClient });

    const listening = listenDockerEventsOrchestration(watcher as any);
    await vi.waitFor(() => expect(recreateDockerClient).toHaveBeenCalled());

    // Simulates deregisterComponent(): flips the active flag and bumps the
    // generation (via cleanupDockerEventsStream(true)) while the preflight
    // await is still pending.
    watcher.isDockerEventsListenerActive = false;
    invalidateDockerEventStreamOrchestration(watcher as any);
    recreate.resolve();
    await listening;

    expect(watcher.ensureRemoteAuthHeaders).toHaveBeenCalled();
    expect(watcher.cleanupDockerEventsStream).not.toHaveBeenCalled();
    expect(watcher.dockerApi.getEvents).not.toHaveBeenCalled();
    expect(watcher.dockerEventsStream).toBeUndefined();
  });

  test('listenDockerEventsOrchestration bails out before opening a stream when the watcher is deregistered while ensureRemoteAuthHeaders is pending', async () => {
    const auth = createDeferred<void>();
    const ensureRemoteAuthHeaders = vi.fn().mockReturnValue(auth.promise);
    const { watcher } = createWatcher({ ensureRemoteAuthHeaders });

    const listening = listenDockerEventsOrchestration(watcher as any);
    await vi.waitFor(() => expect(ensureRemoteAuthHeaders).toHaveBeenCalled());

    watcher.isDockerEventsListenerActive = false;
    invalidateDockerEventStreamOrchestration(watcher as any);
    auth.resolve();
    await listening;

    expect(watcher.cleanupDockerEventsStream).not.toHaveBeenCalled();
    expect(watcher.dockerApi.getEvents).not.toHaveBeenCalled();
    expect(watcher.dockerEventsStream).toBeUndefined();
  });

  test('listenDockerEventsOrchestration bails out when superseded by a newer listen attempt even though the watcher stays active', async () => {
    const recreate = createDeferred<void>();
    const recreateDockerClient = vi.fn().mockReturnValue(recreate.promise);
    const { watcher } = createWatcher({ recreateDockerClient });

    const listening = listenDockerEventsOrchestration(watcher as any);
    await vi.waitFor(() => expect(recreateDockerClient).toHaveBeenCalled());

    // A second, faster listenDockerEventsOrchestration call reaches
    // cleanupDockerEventsStream first: the watcher stays active, only the
    // generation moves on. Neither condition implies the other, so this
    // must bail out on its own.
    invalidateDockerEventStreamOrchestration(watcher as any);
    recreate.resolve();
    await listening;

    expect(watcher.isDockerEventsListenerActive).toBe(true);
    expect(watcher.cleanupDockerEventsStream).not.toHaveBeenCalled();
    expect(watcher.dockerApi.getEvents).not.toHaveBeenCalled();
  });

  test('listenDockerEventsOrchestration does not schedule a reconnect when recreateDockerClient rejects after the watcher was deregistered', async () => {
    const recreate = createDeferred<void>();
    const recreateDockerClient = vi.fn().mockReturnValue(recreate.promise);
    const { watcher } = createWatcher({ recreateDockerClient });

    const listening = listenDockerEventsOrchestration(watcher as any);
    await vi.waitFor(() => expect(recreateDockerClient).toHaveBeenCalled());

    watcher.isDockerEventsListenerActive = false;
    recreate.reject(new Error('socket reset'));
    await listening;

    expect(watcher.scheduleDockerEventsReconnect).not.toHaveBeenCalled();
    expect(watcher.log.warn).not.toHaveBeenCalled();
  });

  test('listenDockerEventsOrchestration does not schedule a reconnect when ensureRemoteAuthHeaders rejects after the watcher was deregistered', async () => {
    const auth = createDeferred<void>();
    const ensureRemoteAuthHeaders = vi.fn().mockReturnValue(auth.promise);
    const { watcher } = createWatcher({ ensureRemoteAuthHeaders });

    const listening = listenDockerEventsOrchestration(watcher as any);
    await vi.waitFor(() => expect(ensureRemoteAuthHeaders).toHaveBeenCalled());

    watcher.isDockerEventsListenerActive = false;
    auth.reject(new Error('auth expired'));
    await listening;

    expect(watcher.scheduleDockerEventsReconnect).not.toHaveBeenCalled();
    expect(watcher.log.warn).not.toHaveBeenCalled();
  });

  test('listenDockerEventsOrchestration skips recreateDockerClient when not provided', async () => {
    const { watcher } = createWatcher();

    await listenDockerEventsOrchestration(watcher as any);

    expect(watcher.ensureRemoteAuthHeaders).toHaveBeenCalled();
    expect(watcher.dockerApi.getEvents).toHaveBeenCalled();
  });

  test('listenDockerEventsOrchestration wires stream handlers when docker events stream opens', async () => {
    const { watcher, stream, streamHandlers } = createWatcher();

    await listenDockerEventsOrchestration(watcher as any);

    expect(watcher.cleanupDockerEventsStream).toHaveBeenCalledWith(true);
    expect(watcher.dockerEventsBuffer).toBe('');
    expect(watcher.log.info).toHaveBeenCalledWith('Listening to docker events');
    expect(watcher.dockerApi.getEvents).toHaveBeenCalledWith(
      {
        filters: {
          type: ['container'],
          event: [
            'create',
            'destroy',
            'start',
            'stop',
            'pause',
            'unpause',
            'die',
            'update',
            'rename',
            'health_status',
          ],
        },
      },
      expect.any(Function),
    );
    expect(watcher.dockerEventsStream).toBe(stream);
    expect(watcher.resetDockerEventsReconnectBackoff).toHaveBeenCalledTimes(1);

    await streamHandlers.data(Buffer.from('{"Action":"start"}\n'));
    expect(watcher.onDockerEvent).toHaveBeenCalledWith(
      Buffer.from('{"Action":"start"}\n'),
      expect.any(Number),
    );

    const streamError = new Error('stream failed');
    streamHandlers.error(streamError);
    streamHandlers.close();
    streamHandlers.end();

    expect(watcher.onDockerEventsStreamFailure).toHaveBeenCalledWith(stream, 'error', streamError);
    expect(watcher.onDockerEventsStreamFailure).toHaveBeenCalledWith(stream, 'close');
    expect(watcher.onDockerEventsStreamFailure).toHaveBeenCalledWith(stream, 'end');
  });

  test('listenDockerEventsOrchestration serializes chunks and pauses until queued work settles', async () => {
    const firstChunk = createDeferred<void>();
    const onDockerEvent = vi
      .fn()
      .mockImplementationOnce(() => firstChunk.promise)
      .mockResolvedValueOnce(undefined);
    const { watcher, stream, streamHandlers } = createWatcher({ onDockerEvent });
    await listenDockerEventsOrchestration(watcher as any);

    const firstProcessing = streamHandlers.data(Buffer.from('first'));
    const secondProcessing = streamHandlers.data(Buffer.from('second'));
    await vi.waitFor(() => expect(onDockerEvent).toHaveBeenCalled());

    expect(onDockerEvent).toHaveBeenCalledTimes(1);
    expect(onDockerEvent).toHaveBeenNthCalledWith(1, Buffer.from('first'), expect.any(Number));
    expect(stream.pause).toHaveBeenCalledTimes(2);
    expect(stream.resume).not.toHaveBeenCalled();

    firstChunk.resolve();
    await Promise.all([firstProcessing, secondProcessing]);

    expect(onDockerEvent).toHaveBeenNthCalledWith(2, Buffer.from('second'), expect.any(Number));
    expect(stream.resume).toHaveBeenCalledTimes(1);
  });

  test('listenDockerEventsOrchestration recovers the processing tail after a chunk rejection', async () => {
    const firstChunk = createDeferred<void>();
    const onDockerEvent = vi
      .fn()
      .mockImplementationOnce(() => firstChunk.promise)
      .mockResolvedValueOnce(undefined);
    const { watcher, streamHandlers } = createWatcher({ onDockerEvent });
    await listenDockerEventsOrchestration(watcher as any);

    const firstProcessing = streamHandlers.data(Buffer.from('first'));
    const secondProcessing = streamHandlers.data(Buffer.from('second'));
    firstChunk.reject(new Error('chunk failed'));

    await expect(Promise.all([firstProcessing, secondProcessing])).resolves.toBeDefined();
    expect(onDockerEvent).toHaveBeenCalledTimes(2);
    expect(watcher.log.debug).toHaveBeenCalledWith(
      expect.stringContaining('Unable to process Docker event stream chunk (chunk failed)'),
    );
  });

  test('listenDockerEventsOrchestration recovers when failure logging rejects the prior tail', async () => {
    const onDockerEvent = vi
      .fn()
      .mockRejectedValueOnce(new Error('first chunk failed'))
      .mockResolvedValueOnce(undefined);
    const { watcher, streamHandlers } = createWatcher({ onDockerEvent });
    watcher.log.debug.mockImplementationOnce(() => {
      throw new Error('logger failed');
    });
    await listenDockerEventsOrchestration(watcher as any);

    const firstProcessing = streamHandlers.data(Buffer.from('first'));
    const secondProcessing = streamHandlers.data(Buffer.from('second'));

    await Promise.allSettled([firstProcessing, secondProcessing]);
    expect(onDockerEvent).toHaveBeenCalledTimes(2);
    expect(watcher.log.debug).toHaveBeenLastCalledWith(
      expect.stringContaining('Unable to process Docker event stream chunk (logger failed)'),
    );
  });

  test('queued work from an invalidated stream exits before processing', async () => {
    const firstChunk = createDeferred<void>();
    const onDockerEvent = vi
      .fn()
      .mockImplementationOnce(() => firstChunk.promise)
      .mockResolvedValueOnce(undefined);
    const { watcher, streamHandlers } = createWatcher({ onDockerEvent });
    await listenDockerEventsOrchestration(watcher as any);

    const firstProcessing = streamHandlers.data(Buffer.from('first'));
    const secondProcessing = streamHandlers.data(Buffer.from('stale-second'));
    await vi.waitFor(() => expect(onDockerEvent).toHaveBeenCalledTimes(1));
    invalidateDockerEventStreamOrchestration(watcher as any);
    firstChunk.resolve();
    await Promise.all([firstProcessing, secondProcessing]);

    expect(onDockerEvent).toHaveBeenCalledTimes(1);
  });

  test('serialized no-newline parsing does not duplicate a completed event or lose the next remainder', async () => {
    const firstPayload = createDeferred<boolean>();
    const processDockerEventPayload = vi.fn((payload: string) => {
      if (payload.includes('first')) {
        return firstPayload.promise;
      }
      return Promise.resolve(false);
    });
    const { watcher, streamHandlers } = createWatcher({ processDockerEventPayload });
    watcher.onDockerEvent = (chunk: unknown, generation?: number) =>
      onDockerEventOrchestration(watcher as any, chunk, 1024, generation);
    await listenDockerEventsOrchestration(watcher as any);

    const firstProcessing = streamHandlers.data(Buffer.from('{"Action":"create","id":"first"}'));
    await Promise.resolve();
    const secondProcessing = streamHandlers.data(Buffer.from('\n{"Action":"create","id":"second"'));
    await Promise.resolve();

    expect(processDockerEventPayload).toHaveBeenCalledTimes(1);

    firstPayload.resolve(true);
    await Promise.all([firstProcessing, secondProcessing]);

    expect(processDockerEventPayload).toHaveBeenCalledWith(
      '{"Action":"create","id":"first"}',
      true,
      expect.any(Number),
    );
    expect(
      processDockerEventPayload.mock.calls.filter(([payload]) => payload.includes('first')),
    ).toHaveLength(1);
    expect(watcher.dockerEventsBuffer).toBe('{"Action":"create","id":"second"');
  });

  test('listenDockerEventsOrchestration logs and schedules reconnect when getEvents fails', async () => {
    const connectionError = new Error('Connection failed');
    const { watcher } = createWatcher({
      dockerApi: {
        getContainer: vi.fn(),
        getEvents: vi.fn((_options, callback) => callback(connectionError)),
      },
    });

    await listenDockerEventsOrchestration(watcher as any);

    expect(watcher.log.warn).toHaveBeenCalledWith(
      'Unable to listen to Docker events [Connection failed]',
    );
    expect(watcher.log.debug).toHaveBeenCalledWith(connectionError);
    expect(watcher.scheduleDockerEventsReconnect).toHaveBeenCalledWith(
      'connection failure',
      connectionError,
    );
  });

  test('listenDockerEventsOrchestration destroys a stale stream and does not adopt it when the generation is invalidated before the getEvents callback fires', async () => {
    const { watcher, stream } = createWatcher();
    watcher.dockerApi.getEvents = vi.fn((_options: unknown, callback: any) => {
      // Simulates deregisterComponent's cleanupDockerEventsStream(true) call bumping the
      // generation while this getEvents request is still in flight.
      invalidateDockerEventStreamOrchestration(watcher as any);
      callback(undefined, stream);
    });

    await listenDockerEventsOrchestration(watcher as any);

    expect(stream.destroy).toHaveBeenCalledTimes(1);
    expect(watcher.dockerEventsStream).toBeUndefined();
    expect(watcher.resetDockerEventsReconnectBackoff).not.toHaveBeenCalled();
    expect(stream.on).not.toHaveBeenCalled();
  });

  test('listenDockerEventsOrchestration ignores a stale getEvents error and does not schedule a reconnect for it', async () => {
    const connectionError = new Error('Connection failed');
    const { watcher } = createWatcher();
    watcher.dockerApi.getEvents = vi.fn((_options: unknown, callback: any) => {
      invalidateDockerEventStreamOrchestration(watcher as any);
      callback(connectionError);
    });

    await listenDockerEventsOrchestration(watcher as any);

    expect(watcher.scheduleDockerEventsReconnect).not.toHaveBeenCalled();
    expect(watcher.log.warn).not.toHaveBeenCalled();
  });

  test('processDockerEventPayloadOrchestration returns true for empty payloads', async () => {
    const { watcher } = createWatcher();

    const processed = await processDockerEventPayloadOrchestration(watcher as any, '   ');

    expect(processed).toBe(true);
    expect(watcher.processDockerEvent).not.toHaveBeenCalled();
  });

  test('processDockerEventPayloadOrchestration parses and forwards valid payloads', async () => {
    const { watcher } = createWatcher();

    const processed = await processDockerEventPayloadOrchestration(
      watcher as any,
      ' {"Action":"start","id":"container123"} ',
    );

    expect(processed).toBe(true);
    expect(watcher.processDockerEvent).toHaveBeenCalledWith({
      Action: 'start',
      id: 'container123',
    });
  });

  test('processDockerEventPayloadOrchestration keeps recoverable partial payloads buffered', async () => {
    const { watcher } = createWatcher({
      isRecoverableDockerEventParseError: vi.fn().mockReturnValue(true),
    });

    const processed = await processDockerEventPayloadOrchestration(
      watcher as any,
      '{"Action":"sta',
      true,
    );

    expect(processed).toBe(false);
    expect(watcher.isRecoverableDockerEventParseError).toHaveBeenCalledTimes(1);
    expect(watcher.log.debug).not.toHaveBeenCalled();
  });

  test('processDockerEventPayloadOrchestration logs and skips unrecoverable parse errors', async () => {
    const { watcher } = createWatcher({
      isRecoverableDockerEventParseError: vi.fn().mockReturnValue(false),
    });

    const processed = await processDockerEventPayloadOrchestration(
      watcher as any,
      '{"Action":"sta',
      true,
    );

    expect(processed).toBe(true);
    expect(watcher.log.debug).toHaveBeenCalledWith(
      expect.stringContaining('Unable to process Docker event'),
    );
  });

  test('processDockerEventPayloadOrchestration handles parse errors with non-string message field', async () => {
    const { watcher } = createWatcher();
    const parseSpy = vi.spyOn(JSON, 'parse').mockImplementation(() => {
      throw { message: { detail: 'bad json' } };
    });

    const processed = await processDockerEventPayloadOrchestration(
      watcher as any,
      '{"Action":"ok"}',
    );

    expect(processed).toBe(true);
    expect(watcher.log.debug).toHaveBeenCalledWith('Unable to process Docker event (undefined)');
    parseSpy.mockRestore();
  });

  test('processDockerEventOrchestration delegates through state dependencies', async () => {
    const processDockerEventStateMock = vi.mocked(processDockerEventState);
    const getContainerMock = vi.mocked(storeContainer.getContainer);
    const inspectResponse = { State: { Status: 'running' } };
    const inspect = vi.fn().mockResolvedValue(inspectResponse);
    const containerFromStore = { id: 'store-container' };
    const { watcher } = createWatcher({
      dockerApi: {
        getContainer: vi.fn().mockReturnValue({ inspect }),
        getEvents: vi.fn(),
      },
    });

    processDockerEventStateMock.mockResolvedValue(undefined);
    getContainerMock.mockReturnValue(containerFromStore as any);

    const dockerEvent = { Action: 'update', id: 'container123' };
    await processDockerEventOrchestration(watcher as any, dockerEvent);

    expect(processDockerEventStateMock).toHaveBeenCalledTimes(1);
    const [eventArg, dependencies] = processDockerEventStateMock.mock.calls[0] as any;
    expect(eventArg).toEqual(dockerEvent);

    await dependencies.watchCronDebounced();
    expect(watcher.watchCronDebounced).toHaveBeenCalledTimes(1);

    await dependencies.ensureRemoteAuthHeaders();
    expect(watcher.ensureRemoteAuthHeaders).toHaveBeenCalledTimes(1);

    const inspected = await dependencies.inspectContainer('container123');
    expect(watcher.dockerApi.getContainer).toHaveBeenCalledWith('container123');
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(inspected).toEqual(inspectResponse);

    expect(dependencies.getContainerFromStore('container123')).toBe(containerFromStore);
    expect(getContainerMock).toHaveBeenCalledWith('container123');

    dependencies.updateContainerFromInspect({ id: 'c1' }, { State: { Status: 'running' } });
    expect(watcher.updateContainerFromInspect).toHaveBeenCalledWith(
      { id: 'c1' },
      { State: { Status: 'running' } },
    );

    dependencies.debug('debug-line');
    expect(watcher.log.debug).toHaveBeenCalledWith('debug-line');
  });

  test('generation guards skip stale payloads, events, and delayed state callbacks', async () => {
    const processDockerEventStateMock = vi.mocked(processDockerEventState);
    let dependencies: any;
    processDockerEventStateMock.mockImplementationOnce(async (_event, stateDependencies) => {
      dependencies = stateDependencies;
    });
    const { watcher } = createWatcher();

    await processDockerEventOrchestration(watcher as any, { Action: 'start' }, 0);
    invalidateDockerEventStreamOrchestration(watcher as any);

    await dependencies.ensureRemoteAuthHeaders();
    dependencies.updateContainerFromInspect({ id: 'c1' }, {});
    expect(watcher.ensureRemoteAuthHeaders).not.toHaveBeenCalled();
    expect(watcher.updateContainerFromInspect).not.toHaveBeenCalled();

    await expect(
      processDockerEventPayloadOrchestration(watcher as any, '{"Action":"start"}', false, 0),
    ).resolves.toBe(false);
    await processDockerEventOrchestration(watcher as any, { Action: 'start' }, 0);
    expect(watcher.recordRecentDockerEvent).toHaveBeenCalledTimes(1);
  });

  test('onDockerEventOrchestration exits when generation is stale before or during splitting', async () => {
    const stale = createWatcher().watcher;
    invalidateDockerEventStreamOrchestration(stale as any);
    await onDockerEventOrchestration(stale as any, Buffer.from('{}'), 1024, 0);
    expect(stale.processDockerEventPayload).not.toHaveBeenCalled();

    const duringSplit = createWatcher().watcher;
    const chunk = {
      toString: () => {
        invalidateDockerEventStreamOrchestration(duringSplit as any);
        return '{"Action":"start"}\n';
      },
    };
    await onDockerEventOrchestration(duringSplit as any, chunk, 1024, 0);
    expect(duringSplit.processDockerEventPayload).not.toHaveBeenCalled();
  });

  test('onDockerEventOrchestration leaves stale buffered parse results untouched', async () => {
    const { watcher } = createWatcher({ dockerEventsBuffer: '' });
    watcher.processDockerEventPayload.mockImplementationOnce(async () => {
      invalidateDockerEventStreamOrchestration(watcher as any);
      return true;
    });

    await onDockerEventOrchestration(
      watcher as any,
      Buffer.from('{"Action":"create","id":"container123"}'),
      1024,
      0,
    );

    expect(watcher.processDockerEventPayload).toHaveBeenCalledOnce();
    expect(watcher.dockerEventsBuffer).toBe('');
  });

  test('onDockerEventOrchestration processes complete payloads and keeps incomplete payload in buffer', async () => {
    const processDockerEventPayload = vi.fn().mockResolvedValue(true);
    const { watcher } = createWatcher({
      dockerEventsBuffer: '{"Action":"sta',
      processDockerEventPayload,
    });

    await onDockerEventOrchestration(
      watcher as any,
      Buffer.from('rt","id":"1"}\n{"Action":"create","id":"2"}\n{"Action":"par'),
      1024,
    );

    expect(watcher.ensureLogger).toHaveBeenCalledTimes(1);
    expect(processDockerEventPayload).toHaveBeenNthCalledWith(1, '{"Action":"start","id":"1"}');
    expect(processDockerEventPayload).toHaveBeenNthCalledWith(2, '{"Action":"create","id":"2"}');
    expect(watcher.dockerEventsBuffer).toBe('{"Action":"par');
  });

  test('onDockerEventOrchestration schedules reconnect when buffer exceeds max size', async () => {
    const processDockerEventPayload = vi.fn().mockResolvedValue(true);
    const { watcher } = createWatcher({
      dockerEventsBuffer: 'abc',
      processDockerEventPayload,
    });

    await onDockerEventOrchestration(watcher as any, Buffer.from('def'), 5);

    expect(watcher.scheduleDockerEventsReconnect).toHaveBeenCalledWith(
      'buffer overflow (> 5 bytes)',
    );
    expect(processDockerEventPayload).not.toHaveBeenCalled();
  });

  test('onDockerEventOrchestration opportunistically parses buffered payload and clears buffer when processed', async () => {
    const processDockerEventPayload = vi.fn().mockResolvedValue(true);
    const { watcher } = createWatcher({
      dockerEventsBuffer: '',
      processDockerEventPayload,
    });

    await onDockerEventOrchestration(
      watcher as any,
      Buffer.from('{"Action":"create","id":"container123"}'),
      1024,
    );

    expect(processDockerEventPayload).toHaveBeenCalledWith(
      '{"Action":"create","id":"container123"}',
      true,
    );
    expect(watcher.dockerEventsBuffer).toBe('');
  });

  test('onDockerEventOrchestration keeps buffered payload when opportunistic parse is partial', async () => {
    const processDockerEventPayload = vi.fn().mockResolvedValue(false);
    const { watcher } = createWatcher({
      dockerEventsBuffer: '',
      processDockerEventPayload,
    });

    await onDockerEventOrchestration(
      watcher as any,
      Buffer.from('{"Action":"create","id":"container123"}'),
      1024,
    );

    expect(processDockerEventPayload).toHaveBeenCalledWith(
      '{"Action":"create","id":"container123"}',
      true,
    );
    expect(watcher.dockerEventsBuffer).toBe('{"Action":"create","id":"container123"}');
  });
});
