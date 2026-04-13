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
  listenDockerEventsOrchestration,
  onDockerEventOrchestration,
  processDockerEventOrchestration,
  processDockerEventPayloadOrchestration,
} from './docker-event-orchestration.js';

function createWatcher(overrides: Record<string, any> = {}) {
  const streamHandlers: Record<string, (...args: any[]) => unknown> = {};
  const stream = {
    on: vi.fn((eventName: string, handler: (...args: any[]) => unknown) => {
      streamHandlers[eventName] = handler;
    }),
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
          ],
        },
      },
      expect.any(Function),
    );
    expect(watcher.dockerEventsStream).toBe(stream);
    expect(watcher.resetDockerEventsReconnectBackoff).toHaveBeenCalledTimes(1);

    await streamHandlers.data(Buffer.from('{"Action":"start"}\n'));
    expect(watcher.onDockerEvent).toHaveBeenCalledWith(Buffer.from('{"Action":"start"}\n'));

    const streamError = new Error('stream failed');
    streamHandlers.error(streamError);
    streamHandlers.close();
    streamHandlers.end();

    expect(watcher.onDockerEventsStreamFailure).toHaveBeenCalledWith(stream, 'error', streamError);
    expect(watcher.onDockerEventsStreamFailure).toHaveBeenCalledWith(stream, 'close');
    expect(watcher.onDockerEventsStreamFailure).toHaveBeenCalledWith(stream, 'end');
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
