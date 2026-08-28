import type Dockerode from 'dockerode';
import type { Container } from '../../../model/container.js';
import * as storeContainer from '../../../store/container.js';
import { processDockerEvent as processDockerEventState } from './container-event-update.js';
import {
  getDockerEventsOptions,
  shouldAttemptBufferedPayloadParse,
  splitDockerEventChunk,
} from './docker-events.js';

interface DockerContainerHandle {
  inspect: () => Promise<unknown>;
}

interface DockerEventsStream {
  on: (event: string, listener: (...args: unknown[]) => void) => unknown;
  pause?: () => void;
  resume?: () => void;
  destroy?: () => void;
}

function getErrorMessage(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' ? message : undefined;
}

interface DockerEventOrchestrationWatcher {
  log: {
    info: (message: string) => void;
    warn: (message: string) => void;
    debug: (message: unknown) => void;
  };
  configuration: {
    watchevents: boolean;
  };
  dockerApi: {
    getContainer: (id: string) => DockerContainerHandle;
    getEvents: (
      options: Dockerode.GetEventsOptions,
      callback: (error?: unknown, stream?: DockerEventsStream) => void,
    ) => void;
  };
  watchCronDebounced: () => Promise<void>;
  dockerEventsReconnectTimeout?: ReturnType<typeof setTimeout>;
  isDockerEventsListenerActive: boolean;
  dockerEventsBuffer: string;
  dockerEventsStream?: DockerEventsStream;
  ensureLogger: () => void;
  ensureRemoteAuthHeaders: () => Promise<void>;
  scheduleDockerEventsReconnect: (reason: string, error?: unknown) => void;
  cleanupDockerEventsStream: (destroy?: boolean) => void;
  resetDockerEventsReconnectBackoff: () => void;
  onDockerEventsStreamFailure: (
    stream: DockerEventsStream,
    reason: string,
    error?: unknown,
  ) => void;
  onDockerEvent: (dockerEventChunk: unknown, streamGeneration?: number) => Promise<void>;
  processDockerEventPayload: (
    dockerEventPayload: string,
    shouldTreatRecoverableErrorsAsPartial?: boolean,
    streamGeneration?: number,
  ) => Promise<boolean>;
  processDockerEvent: (dockerEvent: unknown, streamGeneration?: number) => Promise<void>;
  recordRecentDockerEvent: (dockerEvent: unknown) => void;
  updateContainerFromInspect: (containerFound: Container, containerInspect: unknown) => void;
  isRecoverableDockerEventParseError: (error: unknown) => boolean;
  recreateDockerClient?: () => Promise<void>;
}

interface DockerEventStreamState {
  generation: number;
  processingTail: Promise<void>;
}

const dockerEventStreamState = new WeakMap<
  DockerEventOrchestrationWatcher,
  DockerEventStreamState
>();

function getDockerEventStreamState(
  watcher: DockerEventOrchestrationWatcher,
): DockerEventStreamState {
  let state = dockerEventStreamState.get(watcher);
  if (!state) {
    state = { generation: 0, processingTail: Promise.resolve() };
    dockerEventStreamState.set(watcher, state);
  }
  return state;
}

export function invalidateDockerEventStreamOrchestration(
  watcher: DockerEventOrchestrationWatcher,
): void {
  const state = getDockerEventStreamState(watcher);
  state.generation += 1;
  state.processingTail = Promise.resolve();
  watcher.dockerEventsBuffer = '';
}

function isCurrentStreamGeneration(
  watcher: DockerEventOrchestrationWatcher,
  streamGeneration: number | undefined,
): boolean {
  return (
    streamGeneration === undefined ||
    getDockerEventStreamState(watcher).generation === streamGeneration
  );
}

/**
 * A preflight step (recreateDockerClient / ensureRemoteAuthHeaders) awaits,
 * during which deregisterComponent() can flip isDockerEventsListenerActive to
 * false and bump the stream generation, or a newer listenDockerEventsOrchestration
 * call can bump the generation on its own without deactivating the watcher.
 * Neither condition implies the other, so both are checked before acting on
 * a preflight step that resumed after the fact.
 */
function isDockerEventsListenerStale(
  watcher: DockerEventOrchestrationWatcher,
  entryStreamGeneration: number,
): boolean {
  return (
    !watcher.isDockerEventsListenerActive ||
    !isCurrentStreamGeneration(watcher, entryStreamGeneration)
  );
}

function logChunkProcessingFailure(watcher: DockerEventOrchestrationWatcher, error: unknown): void {
  watcher.log.debug(`Unable to process Docker event stream chunk (${getErrorMessage(error)})`);
}

function enqueueDockerEventChunk(
  watcher: DockerEventOrchestrationWatcher,
  stream: DockerEventsStream,
  streamGeneration: number,
  chunk: unknown,
): Promise<void> {
  stream.pause?.();
  const state = getDockerEventStreamState(watcher);
  const previousTail = state.processingTail.catch((error: unknown) => {
    logChunkProcessingFailure(watcher, error);
  });
  let processingTask: Promise<void>;
  processingTask = previousTail
    .then(async () => {
      if (
        watcher.dockerEventsStream !== stream ||
        !isCurrentStreamGeneration(watcher, streamGeneration)
      ) {
        return;
      }
      await watcher.onDockerEvent(chunk, streamGeneration);
    })
    .catch((error: unknown) => {
      logChunkProcessingFailure(watcher, error);
    })
    .finally(() => {
      if (
        state.processingTail === processingTask &&
        watcher.dockerEventsStream === stream &&
        isCurrentStreamGeneration(watcher, streamGeneration)
      ) {
        stream.resume?.();
      }
    });
  state.processingTail = processingTask;
  return processingTask;
}

/**
 * Listen and react to docker events.
 */
export async function listenDockerEventsOrchestration(
  watcher: DockerEventOrchestrationWatcher,
): Promise<void> {
  watcher.ensureLogger();
  if (!watcher.log || typeof watcher.log.info !== 'function') {
    return;
  }
  if (!watcher.configuration.watchevents || !watcher.isDockerEventsListenerActive) {
    return;
  }
  if (watcher.dockerEventsReconnectTimeout) {
    clearTimeout(watcher.dockerEventsReconnectTimeout);
    watcher.dockerEventsReconnectTimeout = undefined;
  }

  const entryStreamGeneration = getDockerEventStreamState(watcher).generation;

  if (watcher.recreateDockerClient) {
    try {
      await watcher.recreateDockerClient();
    } catch (e: unknown) {
      if (isDockerEventsListenerStale(watcher, entryStreamGeneration)) {
        return;
      }
      const errorMessage = getErrorMessage(e);
      watcher.log.warn(`Unable to recreate Docker client during reconnect (${errorMessage})`);
      watcher.scheduleDockerEventsReconnect('client recreation failure', e);
      return;
    }
  }

  try {
    await watcher.ensureRemoteAuthHeaders();
  } catch (e: unknown) {
    if (isDockerEventsListenerStale(watcher, entryStreamGeneration)) {
      return;
    }
    const errorMessage = getErrorMessage(e);
    watcher.log.warn(
      `Unable to initialize remote watcher auth for docker events (${errorMessage})`,
    );
    watcher.scheduleDockerEventsReconnect('auth initialization failure', e);
    return;
  }

  if (isDockerEventsListenerStale(watcher, entryStreamGeneration)) {
    return;
  }

  watcher.cleanupDockerEventsStream(true);
  const requestedStreamGeneration = getDockerEventStreamState(watcher).generation;
  watcher.dockerEventsBuffer = '';
  watcher.log.info('Listening to docker events');
  const options: Dockerode.GetEventsOptions = getDockerEventsOptions();
  watcher.dockerApi.getEvents(options, (err, stream) => {
    if (err) {
      if (!isCurrentStreamGeneration(watcher, requestedStreamGeneration)) {
        return;
      }
      const errorMessage = getErrorMessage(err);
      if (watcher.log && typeof watcher.log.warn === 'function') {
        watcher.log.warn(`Unable to listen to Docker events [${errorMessage}]`);
        watcher.log.debug(err);
      }
      watcher.scheduleDockerEventsReconnect('connection failure', err);
    } else {
      if (!isCurrentStreamGeneration(watcher, requestedStreamGeneration)) {
        (stream as DockerEventsStream).destroy?.();
        return;
      }
      const dockerEventsStream = stream as DockerEventsStream;
      watcher.dockerEventsStream = dockerEventsStream;
      const streamGeneration = requestedStreamGeneration;
      watcher.resetDockerEventsReconnectBackoff();
      dockerEventsStream.on('data', (chunk: unknown) =>
        enqueueDockerEventChunk(watcher, dockerEventsStream, streamGeneration, chunk),
      );
      dockerEventsStream.on('error', (streamError: unknown) =>
        watcher.onDockerEventsStreamFailure(dockerEventsStream, 'error', streamError),
      );
      dockerEventsStream.on('close', () =>
        watcher.onDockerEventsStreamFailure(dockerEventsStream, 'close'),
      );
      dockerEventsStream.on('end', () =>
        watcher.onDockerEventsStreamFailure(dockerEventsStream, 'end'),
      );
    }
  });
}

export async function processDockerEventPayloadOrchestration(
  watcher: DockerEventOrchestrationWatcher,
  dockerEventPayload: string,
  shouldTreatRecoverableErrorsAsPartial = false,
  streamGeneration?: number,
): Promise<boolean> {
  if (!isCurrentStreamGeneration(watcher, streamGeneration)) {
    return false;
  }
  const payloadTrimmed = dockerEventPayload.trim();
  if (payloadTrimmed === '') {
    return true;
  }
  try {
    const dockerEvent: unknown = JSON.parse(payloadTrimmed);
    if (streamGeneration === undefined) {
      await watcher.processDockerEvent(dockerEvent);
    } else {
      await watcher.processDockerEvent(dockerEvent, streamGeneration);
    }
    return true;
  } catch (e: unknown) {
    if (shouldTreatRecoverableErrorsAsPartial && watcher.isRecoverableDockerEventParseError(e)) {
      return false;
    }
    const errorMessage = getErrorMessage(e);
    watcher.log.debug(`Unable to process Docker event (${errorMessage})`);
    return true;
  }
}

export async function processDockerEventOrchestration(
  watcher: DockerEventOrchestrationWatcher,
  dockerEvent: unknown,
  streamGeneration?: number,
): Promise<void> {
  if (!isCurrentStreamGeneration(watcher, streamGeneration)) {
    return;
  }
  watcher.recordRecentDockerEvent(dockerEvent);
  await processDockerEventState(dockerEvent, {
    watchCronDebounced: async () => {
      if (isCurrentStreamGeneration(watcher, streamGeneration)) {
        await watcher.watchCronDebounced();
      }
    },
    ensureRemoteAuthHeaders: async () => {
      if (isCurrentStreamGeneration(watcher, streamGeneration)) {
        await watcher.ensureRemoteAuthHeaders();
      }
    },
    inspectContainer: async (containerId: string) => {
      const container = await watcher.dockerApi.getContainer(containerId);
      return container.inspect();
    },
    getContainerFromStore: (containerId: string) =>
      isCurrentStreamGeneration(watcher, streamGeneration)
        ? storeContainer.getContainer(containerId)
        : undefined,
    updateContainerFromInspect: (containerFound: Container, containerInspect: unknown) => {
      if (isCurrentStreamGeneration(watcher, streamGeneration)) {
        watcher.updateContainerFromInspect(containerFound, containerInspect);
      }
    },
    debug: (message: string) => watcher.log.debug(message),
  });
}

/**
 * Process a docker event chunk.
 */
export async function onDockerEventOrchestration(
  watcher: DockerEventOrchestrationWatcher,
  dockerEventChunk: unknown,
  maxBufferBytes: number,
  streamGeneration?: number,
): Promise<void> {
  watcher.ensureLogger();
  if (!isCurrentStreamGeneration(watcher, streamGeneration)) {
    return;
  }
  const splitPayloads = splitDockerEventChunk(watcher.dockerEventsBuffer, dockerEventChunk);
  if (!isCurrentStreamGeneration(watcher, streamGeneration)) {
    return;
  }
  watcher.dockerEventsBuffer = splitPayloads.buffer;

  for (const dockerEventPayload of splitPayloads.payloads) {
    if (streamGeneration === undefined) {
      await watcher.processDockerEventPayload(dockerEventPayload);
    } else {
      await watcher.processDockerEventPayload(dockerEventPayload, false, streamGeneration);
    }
    if (!isCurrentStreamGeneration(watcher, streamGeneration)) {
      return;
    }
  }

  if (Buffer.byteLength(watcher.dockerEventsBuffer, 'utf8') > maxBufferBytes) {
    watcher.scheduleDockerEventsReconnect(`buffer overflow (> ${maxBufferBytes} bytes)`);
    return;
  }

  if (shouldAttemptBufferedPayloadParse(watcher.dockerEventsBuffer)) {
    const processed =
      streamGeneration === undefined
        ? await watcher.processDockerEventPayload(watcher.dockerEventsBuffer.trim(), true)
        : await watcher.processDockerEventPayload(
            watcher.dockerEventsBuffer.trim(),
            true,
            streamGeneration,
          );
    if (!isCurrentStreamGeneration(watcher, streamGeneration)) {
      return;
    }
    if (processed) {
      watcher.dockerEventsBuffer = '';
    }
  }
}
