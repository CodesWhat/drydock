import type Dockerode from 'dockerode';

export const DOCKER_EVENTS_RECONNECT_BASE_DELAY_MS = 1000;
export const DOCKER_EVENTS_RECONNECT_MAX_DELAY_MS = 30 * 1000;

const DOCKER_CONTAINER_EVENT_TYPES = [
  'create',
  'destroy',
  'start',
  'stop',
  'pause',
  'unpause',
  'die',
  'update',
  'rename',
] as const;

interface DockerEventsState {
  configuration: {
    watchevents?: boolean;
  };
  isDockerEventsListenerActive: boolean;
  dockerEventsReconnectTimeout?: ReturnType<typeof setTimeout>;
  dockerEventsReconnectDelayMs: number;
  dockerEventsReconnectAttempt: number;
  dockerEventsStream?: any;
  dockerEventsBuffer: string;
  log?: {
    warn?: (...args: any[]) => void;
    debug?: (...args: any[]) => void;
  };
}

export interface DockerEventsReconnectDependencies {
  cleanupDockerEventsStream: (destroy?: boolean) => void;
  listenDockerEvents: () => Promise<void>;
}

export interface DockerEventsStreamFailureDependencies {
  scheduleDockerEventsReconnect: (reason: string, err?: any) => void;
}

export function resetDockerEventsReconnectBackoff(
  state: DockerEventsState,
  baseDelayMs = DOCKER_EVENTS_RECONNECT_BASE_DELAY_MS,
) {
  state.dockerEventsReconnectAttempt = 0;
  state.dockerEventsReconnectDelayMs = baseDelayMs;
}

export function cleanupDockerEventsStream(state: DockerEventsState, destroy = false) {
  if (!state.dockerEventsStream) {
    return;
  }

  const stream = state.dockerEventsStream;
  state.dockerEventsStream = undefined;

  if (typeof stream.removeAllListeners === 'function') {
    stream.removeAllListeners('data');
    stream.removeAllListeners('error');
    stream.removeAllListeners('close');
    stream.removeAllListeners('end');
  }

  if (destroy && typeof stream.destroy === 'function') {
    stream.destroy();
  }
}

export function scheduleDockerEventsReconnect(
  state: DockerEventsState,
  dependencies: DockerEventsReconnectDependencies,
  reason: string,
  err?: any,
  maxDelayMs = DOCKER_EVENTS_RECONNECT_MAX_DELAY_MS,
) {
  if (!state.configuration.watchevents || !state.isDockerEventsListenerActive) {
    return;
  }

  if (state.dockerEventsReconnectTimeout) {
    if (state.log && typeof state.log.debug === 'function') {
      state.log.debug(
        `Docker event stream reconnect already scheduled; ignoring "${reason}" signal`,
      );
    }
    return;
  }

  dependencies.cleanupDockerEventsStream(false);
  state.dockerEventsBuffer = '';
  state.dockerEventsReconnectAttempt += 1;
  const reconnectDelayMs = state.dockerEventsReconnectDelayMs;
  const errorMessage = err?.message ? ` (${err.message})` : '';
  if (state.log && typeof state.log.warn === 'function') {
    state.log.warn(
      `Docker event stream ${reason}${errorMessage}; reconnect attempt #${state.dockerEventsReconnectAttempt} in ${reconnectDelayMs}ms`,
    );
  }
  state.dockerEventsReconnectDelayMs = Math.min(state.dockerEventsReconnectDelayMs * 2, maxDelayMs);

  state.dockerEventsReconnectTimeout = setTimeout(async () => {
    state.dockerEventsReconnectTimeout = undefined;
    if (!state.configuration.watchevents || !state.isDockerEventsListenerActive) {
      return;
    }
    try {
      await dependencies.listenDockerEvents();
    } catch (reconnectError: any) {
      if (state.log && typeof state.log.warn === 'function') {
        state.log.warn(
          `Docker event stream reconnect attempt #${state.dockerEventsReconnectAttempt} failed (${reconnectError.message})`,
        );
      }
      scheduleDockerEventsReconnect(
        state,
        dependencies,
        'reconnect failure',
        reconnectError,
        maxDelayMs,
      );
    }
  }, reconnectDelayMs);
}

export function onDockerEventsStreamFailure(
  state: DockerEventsState,
  dependencies: DockerEventsStreamFailureDependencies,
  stream: any,
  reason: string,
  err?: any,
) {
  if (stream !== state.dockerEventsStream) {
    return;
  }
  dependencies.scheduleDockerEventsReconnect(reason, err);
}

export function isRecoverableDockerEventParseError(error: any) {
  const message = `${error?.message || ''}`.toLowerCase();
  return (
    message.includes('unexpected end of json input') ||
    message.includes('unterminated string in json')
  );
}

export function splitDockerEventChunk(buffer: string, dockerEventChunk: any) {
  const chunkContent = `${buffer}${dockerEventChunk.toString()}`;
  const payloads = chunkContent.split('\n');
  const lastPayload = payloads.pop();

  return {
    payloads,
    buffer: lastPayload || '',
  };
}

export function shouldAttemptBufferedPayloadParse(buffer: string) {
  const bufferedPayload = buffer.trim();
  return bufferedPayload !== '' && bufferedPayload.startsWith('{') && bufferedPayload.endsWith('}');
}

export function getDockerEventsOptions(): Dockerode.GetEventsOptions {
  return {
    filters: {
      type: ['container'],
      event: [...DOCKER_CONTAINER_EVENT_TYPES],
    },
  };
}
