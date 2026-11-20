import type { ContainerInfo, ImageInfo } from 'dockerode';
import { getErrorMessage } from '../util/error.js';
import {
  buildRollbackImageProtection,
  EXCLUDE_LABEL_FILTER,
  hasExcludeLabel,
  hoursToMs,
  isRecentRollbackContainer,
} from './protection.js';
import type { CleanupHost, CleanupPolicy, CleanupType, CleanupTypeResult } from './types.js';
import { CLEANUP_TYPES } from './types.js';

const MAX_RECORDED_ERRORS = 10;
const STOPPED_STATES = new Set(['exited', 'created', 'dead']);
const PREDEFINED_NETWORKS = new Set(['bridge', 'host', 'none']);
const ANONYMOUS_VOLUME_NAME = /^[0-9a-f]{64}$/;
/** A network created moments ago may just not have its containers yet. */
const NETWORK_GRACE_HOURS = 1;

interface PlanItem {
  label: string;
  bytes: number;
  remove?: () => Promise<unknown>;
}

interface TypePlan {
  items: PlanItem[];
  skipped: number;
  /** Types the Docker prune API handles atomically (networks, build cache). */
  native?: () => Promise<{ removed: number; bytes: number }>;
}

interface PlanContext {
  host: CleanupHost;
  policy: CleanupPolicy;
  now: number;
  containers: ContainerInfo[];
  images: ImageInfo[];
}

export interface CleanupExecution {
  types: Partial<Record<CleanupType, CleanupTypeResult>>;
  totalReclaimedBytes: number;
}

function namedTags(image: ImageInfo): string[] {
  return (image.RepoTags ?? []).filter((tag) => !tag.includes('<none>'));
}

function isDangling(image: ImageInfo): boolean {
  return namedTags(image).length === 0;
}

function imageBytes(image: ImageInfo): number {
  return Math.max(0, image.Size - Math.max(0, image.SharedSize ?? -1));
}

function describeImage(image: ImageInfo): string {
  return namedTags(image)[0] ?? image.Id;
}

function planImages(context: PlanContext, type: 'danglingImages' | 'unusedImages'): TypePlan {
  const { host, policy, now, containers, images } = context;
  const usedImageIds = new Set(containers.map((container) => container.ImageID));
  const rollback = buildRollbackImageProtection(policy.protectHours, now);
  const oldestAllowed = now - hoursToMs(policy.unusedImagesOlderThanHours);
  const items: PlanItem[] = [];
  let skipped = 0;

  for (const image of images) {
    const dangling = isDangling(image);
    if ((type === 'danglingImages') !== dangling || usedImageIds.has(image.Id)) {
      continue;
    }
    if (type === 'unusedImages' && image.Created * 1000 > oldestAllowed) {
      continue;
    }
    if (hasExcludeLabel(image.Labels) || rollback.isProtected(image)) {
      skipped += 1;
      continue;
    }
    items.push({
      label: describeImage(image),
      bytes: imageBytes(image),
      remove: () =>
        host.api.getImage(image.Id).remove({
          force: namedTags(image).length > 1,
        }),
    });
  }
  return { items, skipped };
}

function planStoppedContainers(context: PlanContext): TypePlan {
  const { host, policy, now, containers } = context;
  const items: PlanItem[] = [];
  let skipped = 0;

  for (const container of containers) {
    if (!STOPPED_STATES.has(container.State)) {
      continue;
    }
    if (
      hasExcludeLabel(container.Labels) ||
      isRecentRollbackContainer(container, policy.protectHours, now)
    ) {
      skipped += 1;
      continue;
    }
    items.push({
      label: (container.Names?.[0] ?? container.Id).replace(/^\//, ''),
      bytes: (container as ContainerInfo & { SizeRw?: number }).SizeRw ?? 0,
      // Never `v: true`: anonymous volumes are only ever touched by the separate volumes opt-in.
      remove: () => host.api.getContainer(container.Id).remove({ v: false }),
    });
  }
  return { items, skipped };
}

async function planNetworks(context: PlanContext): Promise<TypePlan> {
  const { host, now } = context;
  const networks = await host.api.listNetworks();
  const oldestAllowed = now - hoursToMs(NETWORK_GRACE_HOURS);
  const items: PlanItem[] = [];
  let skipped = 0;

  for (const network of networks) {
    const attached = Object.keys(network.Containers ?? {}).length;
    const created = Date.parse(network.Created ?? '');
    const builtIn =
      PREDEFINED_NETWORKS.has(network.Name) ||
      network.Scope !== 'local' ||
      Boolean((network as { Ingress?: boolean }).Ingress);
    if (builtIn || attached > 0 || created > oldestAllowed) {
      continue;
    }
    if (hasExcludeLabel(network.Labels)) {
      skipped += 1;
      continue;
    }
    items.push({ label: network.Name, bytes: 0 });
  }

  return {
    items,
    skipped,
    native: async () => {
      const result = await host.api.pruneNetworks({
        filters: { 'label!': [EXCLUDE_LABEL_FILTER], until: [`${NETWORK_GRACE_HOURS}h`] },
      });
      return { removed: (result.NetworksDeleted ?? []).length, bytes: 0 };
    },
  };
}

function planBuildCache(
  context: PlanContext,
  usage: Awaited<ReturnType<CleanupHost['api']['df']>>,
): TypePlan {
  const idle = (usage.BuildCache ?? []).filter((entry) => !entry.InUse);
  return {
    items: idle.map((entry) => ({ label: 'build cache record', bytes: entry.Size ?? 0 })),
    skipped: 0,
    native: async () => {
      const result = await context.host.api.pruneBuilder({ all: true });
      return { removed: idle.length, bytes: result.SpaceReclaimed ?? 0 };
    },
  };
}

/**
 * Volumes: anonymous volumes only, judged against the usage snapshot taken
 * before this run removes anything. A volume a container we remove now still
 * references counts as in use, so a run never deletes the data of a container
 * it just cleaned up or one Drydock just replaced.
 */
function planVolumes(
  context: PlanContext,
  usage: Awaited<ReturnType<CleanupHost['api']['df']>>,
): TypePlan {
  const { host, policy, now } = context;
  const oldestAllowed = now - hoursToMs(policy.protectHours);
  const items: PlanItem[] = [];
  let skipped = 0;

  for (const volume of usage.Volumes ?? []) {
    const idle = volume.UsageData?.RefCount === 0;
    if (!ANONYMOUS_VOLUME_NAME.test(volume.Name) || !idle) {
      continue;
    }
    const created = Date.parse(volume.CreatedAt ?? '');
    if (hasExcludeLabel(volume.Labels) || created > oldestAllowed) {
      skipped += 1;
      continue;
    }
    items.push({
      label: volume.Name,
      bytes: Math.max(0, volume.UsageData?.Size ?? 0),
      remove: () => host.api.getVolume(volume.Name).remove(),
    });
  }
  return { items, skipped };
}

function emptyResult(): CleanupTypeResult {
  return { candidates: 0, removed: 0, reclaimedBytes: 0, skipped: 0, errors: [] };
}

function recordError(result: CleanupTypeResult, label: string, error: unknown): void {
  result.skipped += 1;
  if (result.errors.length < MAX_RECORDED_ERRORS) {
    result.errors.push(`${label}: ${getErrorMessage(error)}`);
  }
}

async function executePlan(plan: TypePlan, dryRun: boolean): Promise<CleanupTypeResult> {
  const result = emptyResult();
  result.candidates = plan.items.length;
  result.skipped = plan.skipped;
  const estimate = plan.items.reduce((sum, item) => sum + item.bytes, 0);

  if (dryRun) {
    result.reclaimedBytes = estimate;
    return result;
  }

  if (plan.native) {
    if (plan.items.length === 0) {
      return result;
    }
    try {
      const outcome = await plan.native();
      result.removed = outcome.removed;
      result.reclaimedBytes = outcome.bytes;
    } catch (error: unknown) {
      recordError(result, 'prune', error);
    }
    return result;
  }

  for (const item of plan.items) {
    try {
      await item.remove?.();
      result.removed += 1;
      result.reclaimedBytes += item.bytes;
    } catch (error: unknown) {
      recordError(result, item.label, error);
    }
  }
  return result;
}

/**
 * Plan and, unless `dryRun`, execute the enabled prune types on one host.
 * Every type is isolated: a failure in one is recorded on its result and the
 * rest still run. Listing failures surface as an error on the affected types.
 */
export async function executeCleanup(
  host: CleanupHost,
  policy: CleanupPolicy,
  options: { dryRun: boolean; now?: number },
): Promise<CleanupExecution> {
  const now = options.now ?? Date.now();
  const enabled = CLEANUP_TYPES.filter((type) => policy.types[type]);
  const needsImages = policy.types.danglingImages || policy.types.unusedImages;
  const needsUsage = policy.types.buildCache || policy.types.volumes;

  const types: Partial<Record<CleanupType, CleanupTypeResult>> = {};
  const failType = (type: CleanupType, error: unknown) => {
    const result = emptyResult();
    result.errors.push(getErrorMessage(error));
    types[type] = result;
  };

  let containers: ContainerInfo[] = [];
  let images: ImageInfo[] = [];
  let usage: Awaited<ReturnType<CleanupHost['api']['df']>> = {};
  let sharedError: unknown;
  try {
    if (needsImages || policy.types.stoppedContainers) {
      containers = await host.api.listContainers({
        all: true,
        size: policy.types.stoppedContainers,
      });
    }
    if (needsImages) {
      images = await host.api.listImages({ all: false, 'shared-size': true });
    }
    if (needsUsage) {
      usage = await host.api.df();
    }
  } catch (error: unknown) {
    sharedError = error;
  }

  const context: PlanContext = { host, policy, now, containers, images };
  for (const type of enabled) {
    if (sharedError !== undefined) {
      failType(type, sharedError);
      continue;
    }
    try {
      const plan = await planFor(type, context, usage);
      types[type] = await executePlan(plan, options.dryRun);
    } catch (error: unknown) {
      failType(type, error);
    }
  }

  const totalReclaimedBytes = Object.values(types).reduce(
    (sum, result) => sum + result.reclaimedBytes,
    0,
  );
  return { types, totalReclaimedBytes };
}

async function planFor(
  type: CleanupType,
  context: PlanContext,
  usage: Awaited<ReturnType<CleanupHost['api']['df']>>,
): Promise<TypePlan> {
  switch (type) {
    case 'danglingImages':
    case 'unusedImages':
      return planImages(context, type);
    case 'stoppedContainers':
      return planStoppedContainers(context);
    case 'networks':
      return planNetworks(context);
    case 'buildCache':
      return planBuildCache(context, usage);
    case 'volumes':
      return planVolumes(context, usage);
  }
}
