import type Dockerode from 'dockerode';
import type { Container } from '../../../model/container.js';
import * as storeContainer from '../../../store/container.js';
import { processDockerEvent as processDockerEventState } from './container-event-update.js';
import { RECREATED_CONTAINER_NAME_PATTERN } from './Docker.js';
import {
  getDockerEventsOptions,
  shouldAttemptBufferedPayloadParse,
  splitDockerEventChunk,
} from './docker-events.js';

interface DockerEventOrchestrationWatcher {
  log: {
    info: (message: string) => void;
    warn: (message: string) => void;
    debug: (message: string) => void;
  };
  configuration: {
    watchevents: boolean;
  };
  dockerApi: {
    getContainer: (id: string) => { inspect: () => Promise<any> };
    getEvents: (
      options: Dockerode.GetEventsOptions,
      callback: (error?: any, stream?: any) => void,
    ) => void;
  };
  watchCronDebounced: () => Promise<void>;
  dockerEventsReconnectTimeout?: ReturnType<typeof setTimeout>;
  isDockerEventsListenerActive: boolean;
  dockerEventsBuffer: string;
  dockerEventsStream?: any;
  ensureLogger: () => void;
  ensureRemoteAuthHeaders: () => Promise<void>;
  scheduleDockerEventsReconnect: (reason: string, error?: any) => void;
  cleanupDockerEventsStream: (destroy?: boolean) => void;
  resetDockerEventsReconnectBackoff: () => void;
  onDockerEventsStreamFailure: (stream: any, reason: string, error?: any) => void;
  onDockerEvent: (dockerEventChunk: any) => Promise<void>;
  processDockerEventPayload: (
    dockerEventPayload: string,
    shouldTreatRecoverableErrorsAsPartial?: boolean,
  ) => Promise<boolean>;
  processDockerEvent: (dockerEvent: any) => Promise<void>;
  updateContainerFromInspect: (containerFound: Container, containerInspect: any) => void;
  isRecoverableDockerEventParseError: (error: any) => boolean;
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
  } catch (e: any) {
    watcher.log.warn(`Unable to initialize remote watcher auth for docker events (${e.message})`);
    watcher.scheduleDockerEventsReconnect('auth initialization failure', e);
    return;
  }

  watcher.cleanupDockerEventsStream(true);
  watcher.dockerEventsBuffer = '';
  watcher.log.info('Listening to docker events');
  const options: Dockerode.GetEventsOptions = getDockerEventsOptions();
  watcher.dockerApi.getEvents(options, (err, stream) => {
    if (err) {
      if (watcher.log && typeof watcher.log.warn === 'function') {
        watcher.log.warn(`Unable to listen to Docker events [${err.message}]`);
        watcher.log.debug(err);
      }
      watcher.scheduleDockerEventsReconnect('connection failure', err);
    } else {
      watcher.dockerEventsStream = stream;
      watcher.resetDockerEventsReconnectBackoff();
      stream.on('data', (chunk: any) => watcher.onDockerEvent(chunk));
      stream.on('error', (streamError: any) =>
        watcher.onDockerEventsStreamFailure(stream, 'error', streamError),
      );
      stream.on('close', () => watcher.onDockerEventsStreamFailure(stream, 'close'));
      stream.on('end', () => watcher.onDockerEventsStreamFailure(stream, 'end'));
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
    const dockerEvent = JSON.parse(payloadTrimmed);
    await watcher.processDockerEvent(dockerEvent);
    return true;
  } catch (e: any) {
    if (shouldTreatRecoverableErrorsAsPartial && watcher.isRecoverableDockerEventParseError(e)) {
      return false;
    }
    watcher.log.debug(`Unable to process Docker event (${e.message})`);
    return true;
  }
}

export async function processDockerEventOrchestration(
  watcher: DockerEventOrchestrationWatcher,
  dockerEvent: any,
): Promise<void> {
  await processDockerEventState(dockerEvent, {
    watchCronDebounced: async () => watcher.watchCronDebounced(),
    ensureRemoteAuthHeaders: async () => watcher.ensureRemoteAuthHeaders(),
    inspectContainer: async (containerId: string) => {
      const container = await watcher.dockerApi.getContainer(containerId);
      return container.inspect();
    },
    getContainerFromStore: (containerId: string) => storeContainer.getContainer(containerId),
    updateContainerFromInspect: (containerFound: Container, containerInspect: any) =>
      watcher.updateContainerFromInspect(containerFound, containerInspect),
    isRecreatedContainerAlias: async (containerId: string) => {
      try {
        const containerObj = watcher.dockerApi.getContainer(containerId);
        const inspect = await containerObj.inspect();
        const name = (inspect.Name || '').replace(/^\//, '');
        const match = name.match(RECREATED_CONTAINER_NAME_PATTERN);
        if (!match) {
          return false;
        }
        const [, shortIdPrefix] = match;
        return containerId.toLowerCase().startsWith(shortIdPrefix.toLowerCase());
      } catch {
        return false;
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
  dockerEventChunk: any,
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
