import express, { type Request, type Response } from 'express';
import nocache from 'nocache';
import {
  buildDependencyGraph,
  collectContainerIdsWithResolvedDependsOn,
  getConnectedComponentIds,
  resolveDependencyActionKind,
  topologicalSort,
} from '../dependencies/dependency-graph.js';
import type { Container } from '../model/container.js';
import * as storeContainer from '../store/container.js';
import { sendErrorResponse } from './error-response.js';
import { scoped } from './route-scopes.js';

const router = express.Router();

/**
 * GET /dependencies — full resolved dependency graph over every known
 * container (design §4). Thin serializer over the pure graph engine
 * (dependency-graph.ts) — no duplicate resolution logic lives here.
 */
function getContainerDependencies(_req: Request, res: Response) {
  const containers = storeContainer.getContainers();
  const { nodes, edges, unresolved, crossHostIgnored } = buildDependencyGraph(containers);
  const { cycles } = topologicalSort(nodes, edges);
  const containerById = new Map<string, Container>(
    containers.map((container) => [container.id, container]),
  );

  res.status(200).json({
    nodes: nodes.map((node) => {
      const container = containerById.get(node.id);
      return {
        id: node.id,
        name: node.name,
        displayName: container?.displayName ?? node.name,
        watcher: container?.watcher,
        agent: node.agent,
      };
    }),
    edges,
    cycles,
    unresolved,
    crossHostIgnored,
  });
}

/**
 * The subgraph relevant to a dependency chain rooted at `rootId`: every
 * container in the same weakly-connected component (dependencies AND
 * dependents, transitively), scoped to the full container list so the wave
 * structure below is exactly what runAcceptedContainerUpdates would compute
 * for this same set (design §4 "preview always matches what actually runs").
 */
function resolveDependencyChain(rootId: string): {
  chainContainers: Container[];
  unresolved: ReturnType<typeof buildDependencyGraph>['unresolved'];
  cycles: string[][];
} {
  const allContainers = storeContainer.getContainers();
  const { edges } = buildDependencyGraph(allContainers);
  const componentIds = getConnectedComponentIds(rootId, edges);
  const chainContainers = allContainers.filter((container) => componentIds.has(container.id));

  const scoped = buildDependencyGraph(chainContainers);
  const { cycles } = topologicalSort(scoped.nodes, scoped.edges);

  return { chainContainers, unresolved: scoped.unresolved, cycles };
}

/**
 * POST /:id/update-chain-preview — dry-run wave preview (design §4). Calls
 * the exact same buildDependencyGraph/topologicalSort pair
 * runAcceptedContainerUpdates dispatches from, over the exact same
 * connected-component subgraph a real dependency-group update would use, so
 * the preview can never drift from what actually runs.
 */
function previewUpdateChain(req: Request, res: Response) {
  const id = req.params.id as string;
  const target = storeContainer.getContainer(id);
  if (!target) {
    sendErrorResponse(res, 404, 'Container not found');
    return;
  }

  const { chainContainers, unresolved, cycles } = resolveDependencyChain(id);
  const containerById = new Map<string, Container>(
    chainContainers.map((container) => [container.id, container]),
  );
  const { nodes, edges } = buildDependencyGraph(chainContainers);
  const { waves } = topologicalSort(nodes, edges);
  const containerIdsWithResolvedDependsOn = collectContainerIdsWithResolvedDependsOn(edges);

  res.status(200).json({
    waves: waves.map((wave, index) => ({
      index,
      containers: wave.map((containerId) => {
        const container = containerById.get(containerId);
        return {
          id: containerId,
          name: container?.name,
          /* v8 ignore next -- defensive only: containerById is built from the
             same chainContainers set buildDependencyGraph/topologicalSort ran
             over, so every wave containerId always has a match. */
          actionKind: container
            ? resolveDependencyActionKind(container, containerIdsWithResolvedDependsOn)
            : 'update',
        };
      }),
    })),
    warnings: { cycles, unresolved },
  });
}

/**
 * Init Router.
 * @returns {*}
 */
export function init() {
  router.use(nocache());
  router.get('/dependencies', scoped('read', getContainerDependencies));
  router.post('/:id/update-chain-preview', scoped('containers:watch', previewUpdateChain));
  return router;
}

export { resolveDependencyChain };
