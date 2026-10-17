import express, { type Request, type Response } from 'express';
import nocache from 'nocache';
import { getServerConfiguration } from '../configuration/index.js';
import {
  buildDependencyGraph,
  collectContainerIdsWithResolvedDependsOn,
  resolveDependencyActionKind,
  topologicalSort,
} from '../dependencies/dependency-graph.js';
import logger from '../log/index.js';
import { sanitizeLogParam } from '../log/sanitize.js';
import type { Container } from '../model/container.js';
import { getContainerActionsCounter } from '../prometheus/container-actions.js';
import * as storeContainer from '../store/container.js';
import {
  type AcceptedContainerUpdateRequest,
  type RejectedContainerUpdateRequest,
  requestContainerUpdates,
} from '../updates/request-update.js';
import { resolveDependencyChain } from './container-dependencies.js';
import { requireDestructiveActionConfirmation } from './destructive-confirmation.js';
import { sendErrorResponse } from './error-response.js';
import { scoped } from './route-scopes.js';

const log = logger.child({ component: 'dependency-groups' });

const router = express.Router();

type DependencyGroupAcceptedItem = {
  containerId: string;
  containerName: string;
  operationId: string;
  wave: number;
  actionKind: 'update' | 'restart';
};

function serializeRejectedUpdateRequest(rejected: RejectedContainerUpdateRequest) {
  return {
    containerId: rejected.container.id,
    containerName: rejected.container.name,
    statusCode: rejected.statusCode,
    message: rejected.message,
  };
}

/**
 * Annotate each accepted entry with the wave index it will actually be
 * dispatched in, using the exact same buildDependencyGraph/topologicalSort
 * pair runAcceptedContainerUpdates partitions with internally, over the full
 * admission batch — so rejected upstream entries cannot erase dependency
 * context for accepted restart-only dependents. `actionKind` uses
 * the same `resolveDependencyActionKind` the dispatcher itself uses, so it
 * can't drift from which entries are actually restarted vs. updated either
 * (PR #681 review #2/#3).
 */
function annotateAcceptedWithWave(
  accepted: AcceptedContainerUpdateRequest[],
  dependencyContext: Container[],
): DependencyGroupAcceptedItem[] {
  const { nodes, edges } = buildDependencyGraph(dependencyContext);
  const { waves } = topologicalSort(nodes, edges);
  const waveIndexById = new Map<string, number>();
  waves.forEach((wave, index) => {
    for (const id of wave) {
      waveIndexById.set(id, index);
    }
  });
  const containerIdsWithResolvedDependsOn = collectContainerIdsWithResolvedDependsOn(edges);

  return accepted.map((entry) => ({
    containerId: entry.container.id,
    containerName: entry.container.name,
    operationId: entry.operationId,
    /* v8 ignore next -- defensive only: waveIndexById is built from this same
       accepted[] set, so every entry.container.id always has a match. */
    wave: waveIndexById.get(entry.container.id) ?? 0,
    actionKind: resolveDependencyActionKind(entry.container, containerIdsWithResolvedDependsOn),
  }));
}

type ExpectedContainerIdsParseResult =
  | { kind: 'absent' }
  | { kind: 'invalid' }
  | { kind: 'valid'; ids: string[] };

/**
 * `expectedContainerIds` is an optional blast-radius binding: the UI passes
 * back the exact container id set it previewed (previewUpdateChain's wave
 * membership) so this endpoint can refuse to run against a chain that has
 * since changed shape, rather than silently updating a different set of
 * containers than the ones the user confirmed. Omitting the field entirely
 * preserves the old unbound behavior for any other caller.
 */
function parseExpectedContainerIds(body: unknown): ExpectedContainerIdsParseResult {
  if (!body || typeof body !== 'object') {
    return { kind: 'absent' };
  }
  const raw = (body as Record<string, unknown>).expectedContainerIds;
  if (raw === undefined) {
    return { kind: 'absent' };
  }
  if (!Array.isArray(raw) || !raw.every((value) => typeof value === 'string')) {
    return { kind: 'invalid' };
  }
  return { kind: 'valid', ids: raw };
}

/** Order-insensitive (and duplicate-count-sensitive) equality over id lists. */
function sameContainerIdSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((id, index) => id === sortedB[index]);
}

/**
 * POST /:rootId/update — bulk-update every container in the dependency chain
 * rooted at :rootId (design §4). Mirrors the existing
 * POST /containers/update {accepted, rejected} shape (container-actions.ts),
 * annotated with `wave` and `actionKind` per accepted entry. Admission goes
 * through the same requestContainerUpdates() gates as any manual bulk update
 * — restart-kind dependents are admitted by the dependsOnAction === 'restart'
 * exemption in request-update.ts's updateAvailable gate, not by a bespoke
 * bypass here.
 *
 * Destructive-confirmation-gated (dependency-group-update) at the route
 * level, same as container-delete — this can update/restart an arbitrary
 * number of containers in one call.
 */
async function updateDependencyGroup(req: Request, res: Response) {
  const serverConfiguration = getServerConfiguration();
  if (!serverConfiguration.feature.containeractions) {
    sendErrorResponse(res, 403, 'Container actions are disabled');
    return;
  }

  const rootId = req.params.rootId as string;
  const root = storeContainer.getContainer(rootId);
  if (!root) {
    sendErrorResponse(res, 404, 'Container not found');
    return;
  }

  const expectedContainerIds = parseExpectedContainerIds(req.body);
  if (expectedContainerIds.kind === 'invalid') {
    sendErrorResponse(res, 400, 'expectedContainerIds must be an array of container ids');
    return;
  }

  try {
    const { chainContainers } = resolveDependencyChain(rootId);

    if (expectedContainerIds.kind === 'valid') {
      const currentContainerIds = chainContainers.map((container) => container.id);
      if (!sameContainerIdSet(currentContainerIds, expectedContainerIds.ids)) {
        sendErrorResponse(res, 409, {
          message: 'Dependency chain has changed since it was last previewed',
          details: { currentContainerIds: [...currentContainerIds].sort() },
        });
        return;
      }
    }

    const result = await requestContainerUpdates(chainContainers);

    result.accepted.forEach(() => {
      getContainerActionsCounter()?.inc({ action: 'container-update' });
    });

    res.status(200).json({
      message: 'Dependency group update requests processed',
      accepted: annotateAcceptedWithWave(result.accepted, chainContainers),
      rejected: result.rejected.map(serializeRejectedUpdateRequest),
    });
  } catch (error: unknown) {
    log.warn(
      `Unexpected error accepting dependency group update for root ${sanitizeLogParam(rootId)} (${sanitizeLogParam(
        error instanceof Error ? error.message : String(error),
      )})`,
    );
    sendErrorResponse(res, 500, 'Unable to accept dependency group update');
  }
}

/**
 * Init Router.
 * @returns {*}
 */
export function init() {
  router.use(nocache());
  router.post(
    '/:rootId/update',
    requireDestructiveActionConfirmation('dependency-group-update'),
    scoped('containers:update', updateDependencyGroup),
  );
  return router;
}
