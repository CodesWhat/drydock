import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  cleanupDockerEventsStream,
  DOCKER_EVENTS_RECONNECT_BASE_DELAY_MS,
  getDockerEventsOptions,
  isRecoverableDockerEventParseError,
  onDockerEventsStreamFailure,
  resetDockerEventsReconnectBackoff,
  scheduleDockerEventsReconnect,
  shouldAttemptBufferedPayloadParse,
  splitDockerEventChunk,
} from './docker-events.js';

interface MockDockerEventsState {
  configuration: { watchevents?: boolean };
  isDockerEventsListenerActive: boolean;
  dockerEventsReconnectTimeout?: any;
  dockerEventsReconnectDelayMs: number;
  dockerEventsReconnectAttempt: number;
  dockerEventsStream?: any;
  dockerEventsBuffer: string;
  log?: any;
}

function createState(overrides: Partial<MockDockerEventsState> = {}): MockDockerEventsState {
  return {
    configuration: { watchevents: true },
    isDockerEventsListenerActive: true,
    dockerEventsReconnectTimeout: undefined,
    dockerEventsReconnectDelayMs: DOCKER_EVENTS_RECONNECT_BASE_DELAY_MS,
    dockerEventsReconnectAttempt: 0,
    dockerEventsStream: undefined,
    dockerEventsBuffer: 'stale',
    log: {
      warn: vi.fn(),
      debug: vi.fn(),
    },
    ...overrides,
  };
}

describe('docker events helpers extraction', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('splits event chunk payloads and keeps unfinished payload in buffer', () => {
    const firstPass = splitDockerEventChunk('', Buffer.from('{"Action":"create"}\n{"Action":"sta'));
    expect(firstPass.payloads).toEqual(['{"Action":"create"}']);
    expect(firstPass.buffer).toBe('{"Action":"sta');

    const secondPass = splitDockerEventChunk(firstPass.buffer, Buffer.from('rt"}\n'));
    expect(secondPass.payloads).toEqual(['{"Action":"start"}']);
    expect(secondPass.buffer).toBe('');
  });

  test('checks when buffered payload should be opportunistically parsed', () => {
    expect(shouldAttemptBufferedPayloadParse('   ')).toBe(false);
    expect(shouldAttemptBufferedPayloadParse('{"Action":"create"}')).toBe(true);
    expect(shouldAttemptBufferedPayloadParse('{"Action":"create"')).toBe(false);
  });

  test('identifies recoverable json parse errors for partial event payloads', () => {
    expect(
      isRecoverableDockerEventParseError(new Error('Unexpected end of JSON input while parsing')),
    ).toBe(true);
    expect(
      isRecoverableDockerEventParseError(new Error('Unterminated string in JSON at position 12')),
    ).toBe(true);
    expect(isRecoverableDockerEventParseError(new Error('Something else'))).toBe(false);
    expect(isRecoverableDockerEventParseError({})).toBe(false);
  });

  test('cleans up docker event stream listeners and optionally destroys stream', () => {
    const removeAllListeners = vi.fn();
    const destroy = vi.fn();
    const state = createState({
      dockerEventsStream: {
        removeAllListeners,
        destroy,
      },
    });

    cleanupDockerEventsStream(state, false);

    expect(removeAllListeners).toHaveBeenCalledWith('data');
    expect(removeAllListeners).toHaveBeenCalledWith('error');
    expect(removeAllListeners).toHaveBeenCalledWith('close');
    expect(removeAllListeners).toHaveBeenCalledWith('end');
    expect(destroy).not.toHaveBeenCalled();
    expect(state.dockerEventsStream).toBeUndefined();

    state.dockerEventsStream = {
      removeAllListeners,
      destroy,
    };

    cleanupDockerEventsStream(state, true);
    expect(destroy).toHaveBeenCalled();
  });

  test('schedules reconnect with exponential backoff and attempts reconnect', async () => {
    vi.useFakeTimers();

    const state = createState();
    const cleanup = vi.fn();
    const listenDockerEvents = vi.fn().mockResolvedValue(undefined);

    scheduleDockerEventsReconnect(
      state,
      {
        cleanupDockerEventsStream: cleanup,
        listenDockerEvents,
      },
      'error',
      new Error('stream dropped'),
    );

    expect(cleanup).toHaveBeenCalledWith(false);
    expect(state.dockerEventsBuffer).toBe('');
    expect(state.dockerEventsReconnectAttempt).toBe(1);
    expect(state.dockerEventsReconnectDelayMs).toBe(2000);
    expect(state.dockerEventsReconnectTimeout).toBeDefined();

    await vi.advanceTimersByTimeAsync(1000);

    expect(listenDockerEvents).toHaveBeenCalledTimes(1);
    expect(state.dockerEventsReconnectTimeout).toBeUndefined();
  });

  test('does not schedule reconnect when events are disabled or listener inactive', () => {
    const cleanup = vi.fn();
    const listenDockerEvents = vi.fn();

    const eventsDisabledState = createState({ configuration: { watchevents: false } });
    scheduleDockerEventsReconnect(
      eventsDisabledState,
      {
        cleanupDockerEventsStream: cleanup,
        listenDockerEvents,
      },
      'disabled',
    );

    const listenerInactiveState = createState({ isDockerEventsListenerActive: false });
    scheduleDockerEventsReconnect(
      listenerInactiveState,
      {
        cleanupDockerEventsStream: cleanup,
        listenDockerEvents,
      },
      'inactive',
    );

    expect(cleanup).not.toHaveBeenCalled();
    expect(listenDockerEvents).not.toHaveBeenCalled();
    expect(eventsDisabledState.dockerEventsReconnectTimeout).toBeUndefined();
    expect(listenerInactiveState.dockerEventsReconnectTimeout).toBeUndefined();
  });

  test('does not schedule duplicate reconnect attempts when one is already pending', () => {
    const cleanup = vi.fn();
    const listenDockerEvents = vi.fn();
    const state = createState({
      dockerEventsReconnectTimeout: { pending: true },
    });

    scheduleDockerEventsReconnect(
      state,
      {
        cleanupDockerEventsStream: cleanup,
        listenDockerEvents,
      },
      'duplicate',
    );

    expect(cleanup).not.toHaveBeenCalled();
    expect(listenDockerEvents).not.toHaveBeenCalled();
    expect(state.log.debug).toHaveBeenCalledWith(
      'Docker event stream reconnect already scheduled; ignoring "duplicate" signal',
    );
  });

  test('ignores duplicate reconnect attempts when debug logger is unavailable', () => {
    const cleanup = vi.fn();
    const listenDockerEvents = vi.fn();
    const state = createState({
      dockerEventsReconnectTimeout: { pending: true },
      log: {},
    });

    expect(() =>
      scheduleDockerEventsReconnect(
        state,
        {
          cleanupDockerEventsStream: cleanup,
          listenDockerEvents,
        },
        'duplicate-no-debug',
      ),
    ).not.toThrow();
  });

  test('aborts reconnect attempt when listener becomes inactive before timer fires', async () => {
    vi.useFakeTimers();
    const cleanup = vi.fn();
    const listenDockerEvents = vi.fn();
    const state = createState();

    scheduleDockerEventsReconnect(
      state,
      {
        cleanupDockerEventsStream: cleanup,
        listenDockerEvents,
      },
      'stream ended',
    );
    state.configuration.watchevents = false;

    await vi.advanceTimersByTimeAsync(1000);

    expect(listenDockerEvents).not.toHaveBeenCalled();
  });

  test('logs reconnect failures and reschedules with backoff', async () => {
    vi.useFakeTimers();
    const cleanup = vi.fn();
    const listenDockerEvents = vi
      .fn()
      .mockRejectedValueOnce(new Error('still down'))
      .mockResolvedValueOnce(undefined);
    const state = createState();

    scheduleDockerEventsReconnect(
      state,
      {
        cleanupDockerEventsStream: cleanup,
        listenDockerEvents,
      },
      'stream error',
    );

    await vi.advanceTimersByTimeAsync(1000);
    expect(state.log.warn).toHaveBeenCalledWith(
      'Docker event stream reconnect attempt #1 failed (still down)',
    );
    expect(state.dockerEventsReconnectAttempt).toBe(2);

    await vi.advanceTimersByTimeAsync(2000);
    expect(listenDockerEvents).toHaveBeenCalledTimes(2);
  });

  test('reschedules reconnect failures even when warn logger is unavailable', async () => {
    vi.useFakeTimers();
    const cleanup = vi.fn();
    const listenDockerEvents = vi
      .fn()
      .mockRejectedValueOnce(new Error('still down'))
      .mockResolvedValueOnce(undefined);
    const state = createState({
      log: {},
    });

    scheduleDockerEventsReconnect(
      state,
      {
        cleanupDockerEventsStream: cleanup,
        listenDockerEvents,
      },
      'stream error',
    );

    await vi.advanceTimersByTimeAsync(3000);
    expect(listenDockerEvents).toHaveBeenCalledTimes(2);
  });

  test('handles reconnect failures with malformed error payloads', async () => {
    vi.useFakeTimers();
    const cleanup = vi.fn();
    const listenDockerEvents = vi
      .fn()
      .mockRejectedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    const state = createState();

    scheduleDockerEventsReconnect(
      state,
      {
        cleanupDockerEventsStream: cleanup,
        listenDockerEvents,
      },
      'stream error',
    );
    state.log.warn.mockClear();

    await vi.advanceTimersByTimeAsync(1000);
    expect(state.log.warn).toHaveBeenCalledWith('Docker event stream reconnect attempt #1 failed');
    expect(state.dockerEventsReconnectAttempt).toBe(2);

    await vi.advanceTimersByTimeAsync(2000);
    expect(listenDockerEvents).toHaveBeenCalledTimes(2);
  });

  test('ignores stream failure callback for stale stream references', () => {
    const state = createState();
    const currentStream = {};
    const staleStream = {};
    state.dockerEventsStream = currentStream;

    const schedule = vi.fn();

    onDockerEventsStreamFailure(
      state,
      {
        scheduleDockerEventsReconnect: schedule,
      },
      staleStream,
      'close',
    );
    expect(schedule).not.toHaveBeenCalled();

    onDockerEventsStreamFailure(
      state,
      {
        scheduleDockerEventsReconnect: schedule,
      },
      currentStream,
      'close',
      new Error('closed'),
    );
    expect(schedule).toHaveBeenCalledWith('close', expect.any(Error));
  });

  test('resets reconnect backoff state', () => {
    const state = createState({
      dockerEventsReconnectAttempt: 8,
      dockerEventsReconnectDelayMs: 9000,
    });

    resetDockerEventsReconnectBackoff(state);

    expect(state.dockerEventsReconnectAttempt).toBe(0);
    expect(state.dockerEventsReconnectDelayMs).toBe(DOCKER_EVENTS_RECONNECT_BASE_DELAY_MS);
  });

  test('provides docker events options with container event filters', () => {
    expect(getDockerEventsOptions()).toEqual({
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
    });
  });
});
