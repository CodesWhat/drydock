import express, { type Request, type Response } from 'express';
import nocache from 'nocache';
import { getServerConfiguration } from '../configuration/index.js';
import logger from '../log/index.js';
import { sanitizeLogParam } from '../log/sanitize.js';
import * as registry from '../registry/index.js';
import { recordAuditEvent } from './audit-events.js';
import { requireDestructiveActionConfirmation } from './destructive-confirmation.js';
import { sendErrorResponse } from './error-response.js';
import { type ImageHost, listImageHosts } from './images/hosts.js';
import {
  buildImageInventory,
  estimateReclaimable,
  type ImageInventoryItem,
  isPruneMode,
  type PruneMode,
} from './images/inventory.js';
import { scoped } from './route-scopes.js';

const log = logger.child({ component: 'images' });

const router = express.Router();

const IMAGE_HOST_UNSUPPORTED_MESSAGE =
  "Image inventory is not supported over this host's agent connection, typically because the agent has not advertised the usesControllerDockerTransport capability.";

const AGENT_PRUNE_STILL_RUNNING_MESSAGE =
  "The agent's Docker proxy returned no result; the prune may still be running. Refresh the image list.";

// Docker fills ImageSummary.SharedSize only when the list call asks for it
// (`shared-size=true`, API 1.42+); without it the field is -1 and the
// reclaimable estimate degrades to the full image size.
const LIST_IMAGES_OPTIONS = { all: false, 'shared-size': true } as Record<string, unknown>;

/**
 * Mirrors the literal used by the container action gate (`container-actions.ts`);
 * kept local instead of importing `CONTAINER_ACTIONS_DISABLED_MESSAGE` from
 * `container-update-dispatch.ts`, which would pull in the whole update-request
 * import graph for a single string.
 */
const CONTAINER_ACTIONS_DISABLED_MESSAGE = 'Container actions are disabled';

interface ImageHostSummary {
  id: string;
  name: string;
  agent?: string;
  supported: boolean;
  reason?: 'agent-transport-unsupported';
  error?: string;
}

/**
 * Build a host summary for the `hosts` field of the list response. Called
 * for every host `listImageHosts` returns, not only the ones fetched: an
 * unsupported agent host carries its `reason` through so the UI can list it
 * disabled with the "agent does not expose the Docker API" notice, while
 * `error` is only ever set by `fetchHostInventory` for a host that was
 * actually queried and failed.
 */
function toHostSummary(host: ImageHost, error?: string): ImageHostSummary {
  const summary: ImageHostSummary = {
    id: host.id,
    name: host.name,
    supported: host.supported,
  };
  if (host.agent) {
    summary.agent = host.agent;
  }
  if (host.reason) {
    summary.reason = host.reason;
  }
  if (error) {
    summary.error = error;
  }
  return summary;
}

function findSupportedHostOrRespond(
  res: Response,
  hostId: string,
  hosts: ImageHost[],
): ImageHost | undefined {
  const host = hosts.find((candidate) => candidate.id === hostId);
  if (!host) {
    sendErrorResponse(res, 404, 'Image host not found');
    return undefined;
  }
  if (!host.supported) {
    sendErrorResponse(res, 501, IMAGE_HOST_UNSUPPORTED_MESSAGE);
    return undefined;
  }
  return host;
}

async function fetchHostInventory(
  host: ImageHost,
): Promise<{ items: ImageInventoryItem[]; summary: ImageHostSummary }> {
  try {
    const [images, containers] = await Promise.all([
      host.dockerApi!.listImages(LIST_IMAGES_OPTIONS),
      host.dockerApi!.listContainers({ all: true }),
    ]);
    const items = buildImageInventory(images, containers, {
      watcher: host.name,
      ...(host.agent ? { agent: host.agent } : {}),
    });
    return { items, summary: toHostSummary(host) };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    log.warn(
      `Error listing images for host ${sanitizeLogParam(host.id)} (${sanitizeLogParam(message)})`,
    );
    return { items: [], summary: toHostSummary(host, message) };
  }
}

function sortInventory(items: ImageInventoryItem[]): ImageInventoryItem[] {
  return items.sort((a, b) => {
    if (b.size !== a.size) {
      return b.size - a.size;
    }
    return a.id.localeCompare(b.id);
  });
}

/**
 * List the image inventory across every supported host, or a single host
 * when `host` is provided. A per-host fetch failure is isolated to that
 * host's summary (`error` set, no images contributed) rather than failing
 * the whole request. `hosts` in the response always lists every host
 * `listImageHosts` knows about, including unsupported agent hosts that were
 * never fetched, so the UI's host select can show them disabled with the
 * unsupported-transport notice instead of silently dropping them.
 */
async function listImages(req: Request, res: Response) {
  const hosts = listImageHosts(registry.getState().watcher);
  const hostQuery = typeof req.query.host === 'string' ? req.query.host : undefined;

  let targetHosts: ImageHost[];
  if (hostQuery) {
    const host = findSupportedHostOrRespond(res, hostQuery, hosts);
    if (!host) {
      return;
    }
    targetHosts = [host];
  } else {
    targetHosts = hosts.filter((host) => host.supported);
  }

  const results = await Promise.all(targetHosts.map((host) => fetchHostInventory(host)));
  const items = sortInventory(results.flatMap((result) => result.items));
  const summaryByHostId = new Map(results.map((result) => [result.summary.id, result.summary]));
  const hostSummaries = hosts.map((host) => summaryByHostId.get(host.id) ?? toHostSummary(host));

  res.status(200).json({ data: items, total: items.length, hosts: hostSummaries });
}

/**
 * Resolve the `host` and `mode` query parameters shared by the prune-preview
 * and prune routes, sending the appropriate error response and returning
 * `undefined` when either is missing or invalid.
 */
function resolveHostAndMode(
  res: Response,
  hostId: string | undefined,
  modeValue: unknown,
): { host: ImageHost; mode: PruneMode } | undefined {
  if (!hostId) {
    sendErrorResponse(res, 400, 'host is required');
    return undefined;
  }
  if (!isPruneMode(modeValue)) {
    sendErrorResponse(res, 400, 'mode must be "dangling" or "unused"');
    return undefined;
  }

  const hosts = listImageHosts(registry.getState().watcher);
  const host = findSupportedHostOrRespond(res, hostId, hosts);
  if (!host) {
    return undefined;
  }

  return { host, mode: modeValue };
}

function isAgentPruneTimeoutError(host: ImageHost, error: unknown): boolean {
  if (!host.agent || !error || typeof error !== 'object') {
    return false;
  }
  const candidate = error as { statusCode?: unknown; message?: unknown };
  if (candidate.statusCode === 502 || candidate.statusCode === 504) {
    return true;
  }
  const message = typeof candidate.message === 'string' ? candidate.message : '';
  return /timeout|timed out|socket hang up/i.test(message);
}

function respondWithHostError(res: Response, host: ImageHost, error: unknown): void {
  if (isAgentPruneTimeoutError(host, error)) {
    sendErrorResponse(res, 504, AGENT_PRUNE_STILL_RUNNING_MESSAGE);
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  sendErrorResponse(res, 500, message);
}

/**
 * Estimate the images and space a prune would reclaim on a host, without
 * deleting anything.
 */
async function getPrunePreview(req: Request, res: Response) {
  const serverConfiguration = getServerConfiguration();
  if (!serverConfiguration.feature.containeractions) {
    sendErrorResponse(res, 403, CONTAINER_ACTIONS_DISABLED_MESSAGE);
    return;
  }

  const hostQuery = typeof req.query.host === 'string' ? req.query.host : undefined;
  const resolved = resolveHostAndMode(res, hostQuery, req.query.mode);
  if (!resolved) {
    return;
  }
  const { host, mode } = resolved;

  try {
    const [images, containers] = await Promise.all([
      host.dockerApi!.listImages(LIST_IMAGES_OPTIONS),
      host.dockerApi!.listContainers({ all: true }),
    ]);
    const items = buildImageInventory(images, containers, {
      watcher: host.name,
      ...(host.agent ? { agent: host.agent } : {}),
    });
    res.status(200).json(estimateReclaimable(items, host.id, mode));
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    log.warn(
      `Error estimating reclaimable space for host ${sanitizeLogParam(host.id)} (${sanitizeLogParam(message)})`,
    );
    respondWithHostError(res, host, e);
  }
}

/**
 * Prune images on a host (dangling only, or every unused image) and audit
 * the outcome.
 */
async function pruneImages(req: Request, res: Response) {
  const serverConfiguration = getServerConfiguration();
  if (!serverConfiguration.feature.containeractions) {
    sendErrorResponse(res, 403, CONTAINER_ACTIONS_DISABLED_MESSAGE);
    return;
  }

  const body = (req.body ?? {}) as { host?: unknown; mode?: unknown };
  const hostId = typeof body.host === 'string' ? body.host : undefined;
  const resolved = resolveHostAndMode(res, hostId, body.mode);
  if (!resolved) {
    return;
  }
  const { host, mode } = resolved;

  try {
    const pruneResult = await host.dockerApi!.pruneImages(
      mode === 'unused' ? { filters: { dangling: ['false'] } } : {},
    );
    const imagesDeleted = (pruneResult.ImagesDeleted ?? []).filter((entry) => entry.Deleted).length;
    const spaceReclaimed = pruneResult.SpaceReclaimed ?? 0;

    recordAuditEvent({
      action: 'image-prune',
      status: 'success',
      containerName: host.id,
      details: `${mode}: ${imagesDeleted} images, ${spaceReclaimed} bytes`,
    });

    res.status(200).json({
      message: 'Image prune completed',
      result: { host: host.id, mode, imagesDeleted, spaceReclaimed },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    log.warn(
      `Error pruning images on host ${sanitizeLogParam(host.id)} (${sanitizeLogParam(message)})`,
    );

    recordAuditEvent({
      action: 'image-prune',
      status: 'error',
      containerName: host.id,
      details: message,
    });

    respondWithHostError(res, host, e);
  }
}

/**
 * Init Router.
 * @returns {*}
 */
export function init() {
  router.use(nocache());
  router.get('/', scoped('read', listImages));
  router.get('/prune-preview', scoped('admin', getPrunePreview));
  router.post(
    '/prune',
    requireDestructiveActionConfirmation('image-prune'),
    scoped('admin', pruneImages),
  );
  return router;
}
