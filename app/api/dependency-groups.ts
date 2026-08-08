import express, { type Request, type Response } from 'express';
import nocache from 'nocache';
import { getServerConfiguration } from '../configuration/index.js';
import { buildDependencyGraph, topologicalSort } from '../dependencies/dependency-graph.js';
import logger from '../log/index.js';
import { sanitizeLogParam } from '../log/sanitize.js';
import { getContainerActionsCounter } from '../prometheus/container-actions.js';
import * as storeContainer from '../store/container.js';
import {
  type AcceptedContainerUpdateRequest,
  type RejectedContainerUpdateRequest,
  requestContainerUpdates,
} from '../updates/request-update.js';
import { resolveDependencyChain } from './container-dependencies.js';
import { sendErrorResponse } from './error-response.js';

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
 * pair runAcceptedContainerUpdates partitions with internally, over the same
 * accepted-container set — so `wave` here is never a second, potentially
 * divergent, computation of dispatch order (design §4).
 */
function annotateAcceptedWithWave(
  accepted: AcceptedContainerUpdateRequest[],
): DependencyGroupAcceptedItem[] {
  const { nodes, edges } = buildDependencyGraph(accepted.map((entry) => entry.container));
  const { waves } = topologicalSort(nodes, edges);
  const waveIndexById = new Map<string, number>();
  waves.forEach((wave, index) => {
    for (const id of wave) {
      waveIndexById.set(id, index);
    }
  });

  return accepted.map((entry) => ({
    containerId: entry.container.id,
    containerName: entry.container.name,
    operationId: entry.operationId,
    /* v8 ignore next -- defensive only: waveIndexById is built from this same
       accepted[] set, so every entry.container.id always has a match. */
    wave: waveIndexById.get(entry.container.id) ?? 0,
    actionKind: entry.container.dependsOnAction === 'restart' ? 'restart' : 'update',
  }));
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

  try {
    const { chainContainers } = resolveDependencyChain(rootId);
    const result = await requestContainerUpdates(chainContainers);

    result.accepted.forEach(() => {
      getContainerActionsCounter()?.inc({ action: 'container-update' });
    });

    res.status(200).json({
      message: 'Dependency group update requests processed',
      accepted: annotateAcceptedWithWave(result.accepted),
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
  router.post('/:rootId/update', updateDependencyGroup);
  return router;
}
