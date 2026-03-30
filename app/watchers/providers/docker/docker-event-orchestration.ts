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
  onDockerEvent: (dockerEventChunk: unknown) => Promise<void>;
  processDockerEventPayload: (
    dockerEventPayload: string,
    shouldTreatRecoverableErrorsAsPartial?: boolean,
  ) => Promise<boolean>;
  processDockerEvent: (dockerEvent: unknown) => Promise<void>;
  updateContainerFromInspect: (containerFound: Container, containerInspect: unknown) => void;
  isRecoverableDockerEventParseError: (error: unknown) => boolean;
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

  try {
    await watcher.ensureRemoteAuthHeaders();
  } catch (e: unknown) {
    const errorMessage = getErrorMessage(e);
    watcher.log.warn(
      `Unable to initialize remote watcher auth for docker events (${errorMessage})`,
    );
    watcher.scheduleDockerEventsReconnect('auth initialization failure', e);
    return;
  }

  watcher.cleanupDockerEventsStream(true);
  watcher.dockerEventsBuffer = '';
  watcher.log.info('Listening to docker events');
  const options: Dockerode.GetEventsOptions = getDockerEventsOptions();
  watcher.dockerApi.getEvents(options, (err, stream) => {
    if (err) {
      const errorMessage = getErrorMessage(err);
      if (watcher.log && typeof watcher.log.warn === 'function') {
        watcher.log.warn(`Unable to listen to Docker events [${errorMessage}]`);
        watcher.log.debug(err);
      }
      watcher.scheduleDockerEventsReconnect('connection failure', err);
    } else {
      const dockerEventsStream = stream as DockerEventsStream;
      watcher.dockerEventsStream = dockerEventsStream;
      watcher.resetDockerEventsReconnectBackoff();
      dockerEventsStream.on('data', (chunk: unknown) => watcher.onDockerEvent(chunk));
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
): Promise<boolean> {
  const payloadTrimmed = dockerEventPayload.trim();
  if (payloadTrimmed === '') {
    return true;
  }
  try {
    const dockerEvent: unknown = JSON.parse(payloadTrimmed);
    await watcher.processDockerEvent(dockerEvent);
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
): Promise<void> {
  await processDockerEventState(dockerEvent, {
    watchCronDebounced: async () => watcher.watchCronDebounced(),
    ensureRemoteAuthHeaders: async () => watcher.ensureRemoteAuthHeaders(),
    inspectContainer: async (containerId: string) => {
      const container = await watcher.dockerApi.getContainer(containerId);
      return container.inspect();
    },
    getContainerFromStore: (containerId: string) => storeContainer.getContainer(containerId),
    updateContainerFromInspect: (containerFound: Container, containerInspect: unknown) =>
      watcher.updateContainerFromInspect(containerFound, containerInspect),
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
): Promise<void> {
  watcher.ensureLogger();
  const splitPayloads = splitDockerEventChunk(watcher.dockerEventsBuffer, dockerEventChunk);
  watcher.dockerEventsBuffer = splitPayloads.buffer;

  for (const dockerEventPayload of splitPayloads.payloads) {
    await watcher.processDockerEventPayload(dockerEventPayload);
  }

  if (Buffer.byteLength(watcher.dockerEventsBuffer, 'utf8') > maxBufferBytes) {
    watcher.scheduleDockerEventsReconnect(`buffer overflow (> ${maxBufferBytes} bytes)`);
    return;
  }

  if (shouldAttemptBufferedPayloadParse(watcher.dockerEventsBuffer)) {
    const processed = await watcher.processDockerEventPayload(
      watcher.dockerEventsBuffer.trim(),
      true,
    );
    if (processed) {
      watcher.dockerEventsBuffer = '';
    }
  }
}
