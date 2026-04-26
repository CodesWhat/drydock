import type { Request, Response } from 'express';
import * as event from '../../../event/index.js';
import type { Container, ContainerReport } from '../../../model/container.js';
import { sendErrorResponse } from '../../error-response.js';
import { buildPaginationLinks } from '../../pagination-links.js';
import type {
  CrudHandlerContext,
  LocalContainerWatcher,
  WatchContainersBody,
  WatchTarget,
} from '../crud-context.js';
import { normalizeContainerListPagination, paginateCollection } from '../filters.js';
import { getPathParamValue } from '../request-helpers.js';
import { isSensitiveKey } from '../shared.js';
import { getContainerOrNotFound, resolveWatcherIdForContainer } from './common.js';
import { buildContainerListResponse } from './list.js';

const WATCH_CONTAINERS_MAX_IDS = 200;

function parseWatchContainersBody(body: unknown): { body?: WatchContainersBody; error?: string } {
  if (body === undefined || body === null) {
    return { body: {} };
  }

  if (typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Request body must be an object' };
  }

  const requestBody = body as Record<string, unknown>;
  const unknownKeys = Object.keys(requestBody).filter((key) => key !== 'containerIds');
  if (unknownKeys.length > 0) {
    return { error: `Unknown request properties: ${unknownKeys.join(', ')}` };
  }

  const { containerIds } = requestBody;
  if (containerIds === undefined) {
    return { body: {} };
  }
  if (!Array.isArray(containerIds)) {
    return { error: 'containerIds must be an array of non-empty strings' };
  }
  if (containerIds.length === 0) {
    return { error: 'containerIds must not be empty' };
  }
  if (containerIds.length > WATCH_CONTAINERS_MAX_IDS) {
    return { error: `containerIds must contain at most ${WATCH_CONTAINERS_MAX_IDS} entries` };
  }

  const normalizedIds: string[] = [];
  const seenIds = new Set<string>();
  for (const containerId of containerIds) {
    if (typeof containerId !== 'string' || containerId.trim() === '') {
      return { error: 'containerIds must be an array of non-empty strings' };
    }
    const normalizedId = containerId.trim();
    if (seenIds.has(normalizedId)) {
      continue;
    }
    seenIds.add(normalizedId);
    normalizedIds.push(normalizedId);
  }

  return {
    body: {
      containerIds: normalizedIds,
    },
  };
}

function resolveTargetedWatchTargets(
  context: CrudHandlerContext,
  containerIds: string[],
  watcherMap: Record<string, LocalContainerWatcher>,
): { targets: WatchTarget[] } | { targets?: undefined; status: number; error: string } {
  const selectedTargets: WatchTarget[] = [];

  for (const containerId of containerIds) {
    const container = context.storeContainer.getContainer(containerId);
    if (!container) {
      return { status: 404, error: 'Container not found' };
    }

    const watcherId = resolveWatcherIdForContainer(container);
    const watcher = watcherMap[watcherId];
    if (!watcher) {
      return {
        status: 500,
        error: `No provider found for container ${container.id} and provider ${watcherId}`,
      };
    }

    selectedTargets.push({
      container,
      watcher,
    });
  }

  return { targets: selectedTargets };
}

function extractContainerEnv(container: Container) {
  const details = container.details as { env?: unknown[] } | undefined;
  const rawEnv = Array.isArray(details?.env) ? details.env : [];

  return rawEnv
    .filter(
      (entry): entry is { key: string; value: string } =>
        !!entry &&
        typeof entry === 'object' &&
        typeof (entry as { key?: unknown }).key === 'string',
    )
    .map((entry) => ({
      key: entry.key,
      value: entry.value,
      sensitive: isSensitiveKey(entry.key),
    }));
}

export function createGetContainerUpdateOperationsHandler(context: CrudHandlerContext) {
  return function getContainerUpdateOperations(req: Request, res: Response) {
    const id = getPathParamValue(req.params.id);
    const container = getContainerOrNotFound(context, id, res);
    if (!container) {
      return;
    }

    const operations = context.updateOperationStore.getOperationsByContainerName(container.name);
    const pagination = normalizeContainerListPagination(req.query);
    const data = paginateCollection(operations, pagination);
    const hasMore = pagination.limit > 0 && pagination.offset + data.length < operations.length;
    const links = buildPaginationLinks({
      basePath: `/api/containers/${id}/update-operations`,
      query: req.query,
      limit: pagination.limit,
      offset: pagination.offset,
      total: operations.length,
      returnedCount: data.length,
    });
    res.status(200).json({
      data,
      total: operations.length,
      limit: pagination.limit,
      offset: pagination.offset,
      hasMore,
      ...(links ? { _links: links } : {}),
    });
  };
}

export function createWatchContainersHandler(context: CrudHandlerContext) {
  return async function watchContainers(req: Request, res: Response) {
    const parsedBody = parseWatchContainersBody(req.body);
    if (parsedBody.error) {
      sendErrorResponse(res, 400, parsedBody.error);
      return;
    }

    const watcherMap = context.getWatchers();
    const containerIds = parsedBody.body?.containerIds;
    try {
      if (Array.isArray(containerIds) && containerIds.length > 0) {
        const selected = resolveTargetedWatchTargets(context, containerIds, watcherMap);
        if ('error' in selected) {
          sendErrorResponse(res, selected.status, selected.error);
          return;
        }
        // Collect reports so batch-mode triggers receive them via emitContainerReports,
        // mirroring what the bulk watch() path emits after processing all containers.
        const containerReports = await Promise.all(
          selected.targets.map((target) => target.watcher.watchContainer(target.container)),
        );
        const validReports = containerReports.filter(
          (r): r is ContainerReport => r !== undefined && r !== null,
        );
        if (validReports.length > 0) {
          await event.emitContainerReports(validReports);
        }
      } else {
        await Promise.all(Object.values(watcherMap).map((watcher) => watcher.watch()));
      }

      res.status(200).json(buildContainerListResponse(context, req.query, '/api/containers/watch'));
    } catch (error: unknown) {
      sendErrorResponse(res, 500, `Error when watching images (${context.getErrorMessage(error)})`);
    }
  };
}

export function createWatchContainerHandler(context: CrudHandlerContext) {
  return async function watchContainer(req: Request, res: Response) {
    const id = getPathParamValue(req.params.id);
    const container = getContainerOrNotFound(context, id, res);
    if (!container) {
      return;
    }

    const watcherId = resolveWatcherIdForContainer(container);
    const watcher = context.getWatchers()[watcherId];
    if (!watcher) {
      sendErrorResponse(
        res,
        500,
        `No provider found for container ${id} and provider ${watcherId}`,
      );
      return;
    }

    try {
      if (typeof watcher.getContainers === 'function') {
        const containers = await watcher.getContainers();
        const containerFound = containers.some(
          (containerInList) => containerInList.id === container.id,
        );
        if (!containerFound) {
          sendErrorResponse(res, 404, 'Container not found');
          return;
        }
      }
      const containerReport = await watcher.watchContainer(container, { emitBatchEvent: true });
      res.status(200).json(context.redactContainerRuntimeEnv(containerReport.container));
    } catch {
      sendErrorResponse(res, 500, `Error when watching container ${id}`);
    }
  };
}

export function createRevealContainerEnvHandler(context: CrudHandlerContext) {
  return function revealContainerEnv(req: Request, res: Response) {
    if (!context.getContainerRaw || !context.auditStore) {
      sendErrorResponse(res, 501, 'Environment reveal is not available');
      return;
    }

    const id = getPathParamValue(req.params.id);
    const container = context.getContainerRaw(id);
    if (!container) {
      sendErrorResponse(res, 404, 'Container not found');
      return;
    }

    const env = extractContainerEnv(container);
    context.auditStore.insertAudit({
      action: 'env-reveal',
      containerName: container.name,
      containerImage: container.image?.name,
      status: 'info',
      details: `Revealed ${env.filter((entry) => entry.sensitive).length} sensitive env var(s)`,
    });

    res.status(200).json({ env });
  };
}
