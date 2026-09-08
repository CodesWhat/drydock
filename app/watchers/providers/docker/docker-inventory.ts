import type Dockerode from 'dockerode';
import { type Container, getCanonicalContainerName } from '../../../model/container.js';
import * as store from '../../../store/container.js';
import { getErrorMessage } from '../../../util/error.js';
import { recordControllerLocalEnumeration } from '../../controller-local-container-ids.js';
import { isRecreatedContainerAlias } from './container-event-update.js';
import {
  filterRecreatedContainerAliases,
  getDockerWatcherSourceKey,
  getLabel,
} from './container-init.js';
import type { DockerWatcherConfiguration } from './Docker.js';
import { canonicalizeContainerName, isContainerToWatch } from './docker-helpers.js';
import {
  buildDiscoveredContainer,
  type DockerContainerInspectPayload,
  type DockerContainerSummary,
} from './docker-image-details-orchestration.js';
import { ddWatch } from './label.js';

export interface DockerInventoryWatcher
  extends Omit<Parameters<typeof buildDiscoveredContainer>[0], 'dockerApi'> {
  configuration: DockerWatcherConfiguration;
  dockerApi: Dockerode;
  controllerLocalEnumerationGeneration: number;
  scanGeneration: number;
  isWatcherDeregistered: boolean;
  getId: () => string;
  getEffectiveContainerLabels: (
    container: DockerContainerSummary,
    cache: Map<string, Promise<Record<string, string>>>,
    strict: boolean,
  ) => Promise<Record<string, string>>;
  getDockerImageDetailsHelpers: () => Parameters<typeof buildDiscoveredContainer>[3];
  updateContainerFromInspect: (
    container: Container,
    inspect: DockerContainerInspectPayload,
  ) => void;
}

type SourceProbe = Pick<DockerInventoryWatcher, 'name' | 'agent' | 'configuration'>;

export function refreshDockerInventoryForWatcher(
  watcher: DockerInventoryWatcher,
  sourceContainers: (source: SourceProbe, containers: Container[]) => Container[],
) {
  watcher.ensureLogger();
  const enumerationGeneration = ++watcher.controllerLocalEnumerationGeneration;
  const scanGeneration = watcher.scanGeneration;
  const name = watcher.name;
  const agent = watcher.agent || undefined;
  const source = getDockerWatcherSourceKey(watcher);
  const sourceProbe = { name, agent, configuration: { ...watcher.configuration } };
  const dockerApi = watcher.dockerApi;
  const serviceLabels = new Map<string, Promise<Record<string, string>>>();
  return refreshDockerInventory({
    isCurrent: () =>
      !watcher.isWatcherDeregistered &&
      scanGeneration === watcher.scanGeneration &&
      enumerationGeneration === watcher.controllerLocalEnumerationGeneration &&
      name === watcher.name &&
      agent === (watcher.agent || undefined) &&
      source === getDockerWatcherSourceKey(watcher) &&
      dockerApi === watcher.dockerApi,
    getSourceContainers: () => sourceContainers(sourceProbe, [...store.getContainersRaw()]),
    owns: (container) => sourceContainers(sourceProbe, [container]).length === 1,
    enumerate: async () => {
      await watcher.ensureRemoteAuthHeaders();
      return dockerApi.listContainers(watcher.configuration.watchall ? { all: true } : {});
    },
    inspect: async (id) =>
      (await dockerApi.getContainer(id).inspect()) as unknown as DockerContainerInspectPayload,
    labels: (container) => watcher.getEffectiveContainerLabels(container, serviceLabels, true),
    discover: async (container, inspect) => {
      const image = await dockerApi.getImage(container.Image).inspect();
      const discovered = await buildDiscoveredContainer(
        watcher as unknown as Parameters<typeof buildDiscoveredContainer>[0],
        container,
        {},
        watcher.getDockerImageDetailsHelpers(),
        image as unknown as Parameters<typeof buildDiscoveredContainer>[4],
        inspect,
      );
      if (discovered) discovered.agent = agent;
      return discovered;
    },
    update: (container, inspect) => watcher.updateContainerFromInspect(container, inspect),
    recordEnumeration: (ids) => recordControllerLocalEnumeration(watcher, ids),
    watchByDefault: watcher.configuration.watchbydefault,
  });
}

interface InventoryRefreshError {
  phase: 'store' | 'enumerate' | 'inspect' | 'labels' | 'image' | 'ownership' | 'stale' | 'persist';
  id?: string;
  message: string;
}

export interface InventoryRefreshResult {
  containers: Container[];
  removedIds: string[];
  errors: InventoryRefreshError[];
  authoritative: boolean;
}

interface InventoryDependencies {
  isCurrent: () => boolean;
  getSourceContainers: () => Container[];
  owns: (container: Container) => boolean;
  enumerate: () => Promise<DockerContainerSummary[]>;
  inspect: (id: string) => Promise<DockerContainerInspectPayload>;
  labels: (container: DockerContainerSummary) => Promise<Record<string, string>>;
  discover: (
    container: DockerContainerSummary,
    inspect: DockerContainerInspectPayload,
  ) => Promise<Container | undefined>;
  update: (container: Container, inspect: DockerContainerInspectPayload) => void;
  recordEnumeration: (ids: string[]) => void;
  watchByDefault: boolean;
}

type Observation = {
  id: string;
  previous?: Container;
  inspect?: DockerContainerInspectPayload;
  discovered?: Container;
  remove?: boolean;
};

function sameIdentity(previous: Container, current: Container | undefined) {
  return (
    current !== undefined &&
    previous.identityKey === current.identityKey &&
    previous.image.id === current.image.id
  );
}

function nameIdentity(container: Container) {
  return JSON.stringify([container.agent || '', container.watcher, container.name]);
}

function confirmRecreatedRemovals(observations: Observation[]) {
  const replacements = new Set(
    observations.flatMap(({ discovered }) => (discovered ? [nameIdentity(discovered)] : [])),
  );
  for (const observation of observations) {
    const { previous, inspect } = observation;
    if (!previous || !inspect) continue;
    const inspectedName = String(inspect.Name || '').replace(/^\//, '');
    const canonicalName = isRecreatedContainerAlias(previous.id, inspectedName)
      ? canonicalizeContainerName(inspectedName)
      : getCanonicalContainerName(inspectedName);
    if (
      inspectedName !== previous.name &&
      canonicalName === previous.name &&
      replacements.has(nameIdentity(previous))
    )
      observation.remove = true;
  }
}

async function refreshDockerInventory(
  deps: InventoryDependencies,
): Promise<InventoryRefreshResult> {
  const result: InventoryRefreshResult = {
    containers: [],
    removedIds: [],
    errors: [],
    authoritative: false,
  };
  const fail = (phase: InventoryRefreshError['phase'], error: unknown, id?: string) => {
    result.errors.push({
      phase,
      ...(id === undefined ? {} : { id }),
      message: getErrorMessage(error, String(error)),
    });
  };
  const current = () => {
    if (deps.isCurrent()) return true;
    fail('stale', 'Watcher changed while refreshing inventory');
    return false;
  };
  const finish = () => {
    try {
      result.containers = deps
        .getSourceContainers()
        .map((container) => store.getContainer(container.id)!);
    } catch (error) {
      fail('store', error);
    }
    result.authoritative = result.errors.length === 0;
    return result;
  };

  let previous: Container[];
  try {
    previous = deps.getSourceContainers();
  } catch (error) {
    fail('store', error);
    return result;
  }
  if (!current()) return finish();
  let listed: DockerContainerSummary[];
  try {
    listed = await deps.enumerate();
    if (
      !Array.isArray(listed) ||
      listed.some((container) => typeof container?.Id !== 'string' || container.Id === '')
    )
      throw new Error('Docker returned an invalid container listing');
  } catch (error) {
    fail('enumerate', error);
    return finish();
  }
  if (!current()) return finish();

  const listedById = new Map(listed.map((container) => [container.Id, container]));
  const previousById = new Map(previous.map((container) => [container.id, container]));
  const { skippedContainerIds } = filterRecreatedContainerAliases(listed, previous);
  const observations: Observation[] = [];
  for (const id of new Set([...listedById.keys(), ...previousById.keys()])) {
    const prior = previousById.get(id);
    const summary = listedById.get(id);
    if (skippedContainerIds.has(id) && !prior) continue;
    let existing: Container | undefined;
    try {
      existing = store.getContainerRaw(id);
    } catch (error) {
      fail('store', error, id);
      continue;
    }
    if (existing && !deps.owns(existing)) {
      fail('ownership', 'Container belongs to another Docker source', id);
      continue;
    }
    if (summary && !summary.Image) continue;
    let inspected: DockerContainerInspectPayload;
    try {
      inspected = await deps.inspect(id);
      if (inspected.Id !== id || typeof inspected.State?.Status !== 'string')
        throw new Error('Docker inspection identity or state is invalid');
    } catch (error) {
      if (!summary && prior && (error as { statusCode?: number })?.statusCode === 404)
        observations.push({ id, previous: prior, remove: true });
      else fail('inspect', error, id);
      continue;
    }
    let labels: Record<string, string>;
    try {
      labels = await deps.labels({
        ...(summary || { Id: id, Image: String(inspected.Config?.Image || '') }),
        Labels: inspected.Config?.Labels as Record<string, string> | undefined,
      });
    } catch (error) {
      fail('labels', error, id);
      continue;
    }
    inspected = { ...inspected, Config: { ...inspected.Config, Labels: labels } };
    if (!isContainerToWatch(getLabel(labels, ddWatch), deps.watchByDefault)) {
      if (prior) observations.push({ id, previous: prior, remove: true });
      continue;
    }
    if (prior) observations.push({ id, previous: prior, inspect: inspected });
    else {
      try {
        const discovered = await deps.discover(
          {
            ...summary!,
            Names: [String(inspected.Name || summary!.Names?.[0] || id)],
            State: inspected.State.Status as string,
            Labels: labels,
          },
          inspected,
        );
        if (!discovered) throw new Error('Unable to resolve the local image reference');
        observations.push({ id, inspect: inspected, discovered });
      } catch (error) {
        fail('image', error, id);
      }
    }
  }

  if (!current()) return finish();
  deps.recordEnumeration([...listedById.keys()]);
  confirmRecreatedRemovals(observations);
  const priorIdsByName = new Map<string, string[]>();
  for (const container of previous) {
    const key = nameIdentity(container);
    const ids = priorIdsByName.get(key) || [];
    ids.push(container.id);
    priorIdsByName.set(key, ids);
  }
  // Confirmed removals precede inserts so the existing retention mechanism can
  // transfer policies to a recreated container with the same logical identity.
  observations.sort((a, b) => Number(Boolean(b.remove)) - Number(Boolean(a.remove)));
  for (const observation of observations) {
    if (!current()) break;
    const { id, previous: prior, inspect, discovered, remove } = observation;
    try {
      const latest = store.getContainerRaw(id);
      if ((latest && !deps.owns(latest)) || (prior && !sameIdentity(prior, latest))) {
        fail('ownership', 'Container identity changed while refreshing inventory', id);
        continue;
      }
      if (remove) {
        store.deleteContainer(id, { replacementExpected: true });
        result.removedIds.push(id);
      } else if (latest) deps.update(latest, inspect!);
      else {
        const key = nameIdentity(discovered!);
        const unresolvedPrior = priorIdsByName.get(key)?.some((priorId) => {
          const retained = store.getContainerRaw(priorId);
          return retained && nameIdentity(retained) === key;
        });
        if (unresolvedPrior) {
          fail('ownership', 'Cannot confirm replacement while the prior container remains', id);
          continue;
        }
        store.insertContainer(discovered!);
      }
    } catch (error) {
      fail('persist', error, id);
    }
  }
  return finish();
}
