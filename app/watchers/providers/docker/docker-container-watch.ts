import type { Container } from '../../../model/container.js';
import * as storeContainer from '../../../store/container.js';
import { type DockerContainerWatchOptions, watchContainer } from './container-processing.js';
import type Docker from './Docker.js';

type DockerContainerWatcher = Pick<
  Docker,
  | 'dockerApi'
  | 'ensureLogger'
  | 'ensureRemoteAuthHeaders'
  | 'getEffectiveContainerLabels'
  | 'addImageDetailsToContainer'
  | 'findNewVersion'
  | 'mapContainerToContainerReport'
> & {
  log: Parameters<typeof watchContainer>[1]['log'];
  scanGeneration: number;
};

export async function watchDockerContainer(
  watcher: DockerContainerWatcher,
  container: Container,
  options: DockerContainerWatchOptions,
) {
  if (options.refreshImageDetails) {
    await watcher.ensureRemoteAuthHeaders();
    const summaries = await watcher.dockerApi.listContainers({
      all: true,
      filters: { id: [container.id] },
    });
    const summary = summaries.find((candidate) => candidate.Id === container.id);
    if (!summary) throw new Error(`Container ${container.id} is no longer available`);
    const enriched = await watcher.addImageDetailsToContainer(
      {
        ...summary,
        Labels: await watcher.getEffectiveContainerLabels({ ...summary }, new Map(), true),
        Image: summary.Image && (summary.ImageID || container.image.id),
      },
      {},
      { requireImageDetails: true },
    );
    if (!enriched) throw new Error(`Unable to resolve image details for container ${container.id}`);
    container = enriched;
  }
  const {
    emitBatchEvent = false,
    useRegistryPollCache = false,
    collectReleaseMaturity,
    scanGeneration,
  } = options;
  watcher.ensureLogger();
  return watchContainer(container, {
    ensureLogger: () => watcher.ensureLogger(),
    log: watcher.log,
    findNewVersion: (containerToCheck, logContainer) =>
      watcher.findNewVersion(containerToCheck, logContainer, {
        useRegistryPollCache,
        collectReleaseMaturity,
      }),
    mapContainerToContainerReport: (containerWithResult, watchStartedAtMs) =>
      watcher.mapContainerToContainerReport(containerWithResult, watchStartedAtMs),
    emitBatchEvent,
    isScanStale:
      scanGeneration === undefined ? undefined : () => scanGeneration !== watcher.scanGeneration,
    isRenamedPredecessorOfReplacement: storeContainer.isRenamedPredecessorOfReplacement,
  });
}
