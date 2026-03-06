import type { Request, Response } from 'express';
import type { AgentClient } from '../../agent/AgentClient.js';
import type { Container, ContainerReport } from '../../model/container.js';
import { getContainerStatusSummary } from '../../util/container-summary.js';
import {
  getPathParamValue,
  parseBooleanQueryParam,
  parseIntegerQueryParam,
} from './request-helpers.js';
import { isSensitiveKey } from './shared.js';

interface CrudStoreContainerApi {
  getContainer: (id: string) => Container | undefined;
  deleteContainer: (id: string) => void;
}

interface ContainerListPagination {
  limit: number;
  offset: number;
}

interface UpdateOperationStoreApi {
  getOperationsByContainerName: (containerName: string) => unknown[];
}

interface ServerConfiguration {
  feature: {
    delete: boolean;
  };
}

interface LocalContainerWatcher {
  watch: () => Promise<unknown>;
  getContainers?: () => Promise<Container[]>;
  watchContainer: (container: Container) => Promise<ContainerReport>;
}

interface AuditStoreApi {
  insertAudit: (entry: {
    action: string;
    containerName: string;
    containerImage?: string;
    status: string;
    details?: string;
  }) => unknown;
}

interface CrudHandlerDependencies {
  getContainersFromStore: (
    query: Request['query'],
    pagination?: ContainerListPagination,
  ) => Container[];
  storeContainer: CrudStoreContainerApi;
  updateOperationStore: UpdateOperationStoreApi;
  getServerConfiguration: () => ServerConfiguration;
  getAgent: (name: string) => AgentClient | undefined;
  getErrorMessage: (error: unknown) => string;
  getErrorStatusCode: (error: unknown) => number | undefined;
  getWatchers: () => Record<string, LocalContainerWatcher>;
  redactContainerRuntimeEnv: (container: Container) => Container;
  redactContainersRuntimeEnv: (containers: Container[]) => Container[];
  getContainerRaw?: (id: string) => Container | undefined;
  auditStore?: AuditStoreApi;
}

const CONTAINER_LIST_MAX_LIMIT = 200;

function removeContainerListControlParams(query: Request['query']): Request['query'] {
  const filteredQuery: Record<string, unknown> = {};
  Object.entries(query || {}).forEach(([key, value]) => {
    if (key === 'includeVulnerabilities' || key === 'limit' || key === 'offset') {
      return;
    }
    filteredQuery[key] = value;
  });
  return filteredQuery as Request['query'];
}

function normalizeContainerListPagination(query: Request['query']) {
  const parsedLimit = parseIntegerQueryParam(query.limit, 0);
  const parsedOffset = parseIntegerQueryParam(query.offset, 0);
  return {
    limit: Math.min(CONTAINER_LIST_MAX_LIMIT, Math.max(0, parsedLimit)),
    offset: Math.max(0, parsedOffset),
  };
}

function stripContainerVulnerabilityArrays(container: Container): Container {
  if (!container.security) {
    return container;
  }
  return {
    ...container,
    security: {
      ...container.security,
      scan: container.security.scan
        ? {
            ...container.security.scan,
            vulnerabilities: [],
          }
        : container.security.scan,
      updateScan: container.security.updateScan
        ? {
            ...container.security.updateScan,
            vulnerabilities: [],
          }
        : container.security.updateScan,
    },
  };
}

function getSecurityIssueCount(containers: Container[]): number {
  return containers.filter((container) => {
    const summary = container.security?.scan?.summary;
    return Number(summary?.critical ?? 0) > 0 || Number(summary?.high ?? 0) > 0;
  }).length;
}

export function createCrudHandlers({
  getContainersFromStore,
  storeContainer,
  updateOperationStore,
  getServerConfiguration,
  getAgent,
  getErrorMessage,
  getErrorStatusCode,
  getWatchers,
  redactContainerRuntimeEnv,
  redactContainersRuntimeEnv,
  getContainerRaw,
  auditStore,
}: CrudHandlerDependencies) {
  /**
   * Get all (filtered) containers.
   * @param req
   * @param res
   */
  function getContainers(req: Request, res: Response) {
    const { query } = req;
    const includeVulnerabilities = parseBooleanQueryParam(query.includeVulnerabilities, false);
    const filteredQuery = removeContainerListControlParams(query);
    const pagination = normalizeContainerListPagination(query);
    const pagedContainers = getContainersFromStore(filteredQuery, pagination);
    const redactedContainers = redactContainersRuntimeEnv(pagedContainers);
    const responsePayload = includeVulnerabilities
      ? redactedContainers
      : redactedContainers.map((container) => stripContainerVulnerabilityArrays(container));
    res.status(200).json(responsePayload);
  }

  /**
   * Get lightweight container/security badge summary for sidebar refreshes.
   * @param _req
   * @param res
   */
  function getContainerSummary(_req: Request, res: Response) {
    const containers = getContainersFromStore({});
    const containerStatus = getContainerStatusSummary(containers);
    res.status(200).json({
      containers: containerStatus,
      security: {
        issues: getSecurityIssueCount(containers),
      },
    });
  }

  /**
   * Get a container by id.
   * @param req
   * @param res
   */
  function getContainer(req: Request, res: Response) {
    const id = getPathParamValue(req.params.id);
    const container = storeContainer.getContainer(id);
    if (container) {
      res.status(200).json(redactContainerRuntimeEnv(container));
    } else {
      res.sendStatus(404);
    }
  }

  /**
   * Get persisted update-operation history for a container.
   * @param req
   * @param res
   */
  function getContainerUpdateOperations(req: Request, res: Response) {
    const id = getPathParamValue(req.params.id);
    const container = storeContainer.getContainer(id);
    if (!container) {
      res.sendStatus(404);
      return;
    }

    const operations = updateOperationStore.getOperationsByContainerName(container.name);
    res.status(200).json(operations);
  }

  /**
   * Delete a container by id.
   * @param req
   * @param res
   */
  async function deleteContainer(req: Request, res: Response) {
    const serverConfiguration = getServerConfiguration();
    if (!serverConfiguration.feature.delete) {
      res.sendStatus(403);
      return;
    }

    const id = getPathParamValue(req.params.id);
    const container = storeContainer.getContainer(id);
    if (!container) {
      res.sendStatus(404);
      return;
    }

    if (!container.agent) {
      storeContainer.deleteContainer(id);
      res.sendStatus(204);
      return;
    }

    const agent = getAgent(container.agent);
    if (!agent) {
      res.status(500).json({
        error: `Agent ${container.agent} not found`,
      });
      return;
    }

    try {
      await agent.deleteContainer(id);
      storeContainer.deleteContainer(id);
      res.sendStatus(204);
    } catch (error: unknown) {
      if (getErrorStatusCode(error) === 404) {
        storeContainer.deleteContainer(id);
        res.sendStatus(204);
      } else {
        res.status(500).json({
          error: `Error deleting container on agent (${getErrorMessage(error)})`,
        });
      }
    }
  }

  /**
   * Watch all containers.
   * @param req
   * @param res
   * @returns {Promise<void>}
   */
  async function watchContainers(req: Request, res: Response) {
    try {
      await Promise.all(Object.values(getWatchers()).map((watcher) => watcher.watch()));
      getContainers(req, res);
    } catch (error: unknown) {
      res.status(500).json({
        error: `Error when watching images (${getErrorMessage(error)})`,
      });
    }
  }

  /**
   * Watch an image.
   * @param req
   * @param res
   * @returns {Promise<void>}
   */
  async function watchContainer(req: Request, res: Response) {
    const id = getPathParamValue(req.params.id);

    const container = storeContainer.getContainer(id);
    if (!container) {
      res.sendStatus(404);
      return;
    }

    let watcherId = `docker.${container.watcher}`;
    if (container.agent) {
      watcherId = `${container.agent}.${watcherId}`;
    }
    const watcher = getWatchers()[watcherId];
    if (!watcher) {
      res.status(500).json({
        error: `No provider found for container ${id} and provider ${watcherId}`,
      });
      return;
    }

    try {
      if (typeof watcher.getContainers === 'function') {
        // Ensure container is still in store
        // (for cases where it has been removed before running a new watchAll)
        const containers = await watcher.getContainers();
        const containerFound = containers.some(
          (containerInList) => containerInList.id === container.id,
        );
        if (!containerFound) {
          res.status(404).send();
          return;
        }
      }
      // Run watchContainer from the Provider
      const containerReport = await watcher.watchContainer(container);
      res.status(200).json(redactContainerRuntimeEnv(containerReport.container));
    } catch {
      res.status(500).json({
        error: `Error when watching container ${id}`,
      });
    }
  }

  /**
   * Reveal unredacted environment variables for a container.
   *
   * Security note: this endpoint is intentionally authentication-gated only.
   * In current single-operator deployments, any authenticated user can reveal
   * secrets for any container. Fine-grained RBAC is planned for a future
   * enterprise access release.
   * @param req
   * @param res
   */
  function revealContainerEnv(req: Request, res: Response) {
    if (!getContainerRaw || !auditStore) {
      res.sendStatus(501);
      return;
    }

    const id = getPathParamValue(req.params.id);
    const container = getContainerRaw(id);
    if (!container) {
      res.sendStatus(404);
      return;
    }

    const details = container.details as { env?: unknown[] } | undefined;
    const rawEnv = Array.isArray(details?.env) ? details.env : [];

    const env = rawEnv
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

    auditStore.insertAudit({
      action: 'env-reveal',
      containerName: container.name,
      containerImage: container.image?.name,
      status: 'info',
      details: `Revealed ${env.filter((e) => e.sensitive).length} sensitive env var(s)`,
    });

    res.status(200).json({ env });
  }

  return {
    getContainers,
    getContainerSummary,
    getContainer,
    getContainerUpdateOperations,
    deleteContainer,
    watchContainers,
    watchContainer,
    revealContainerEnv,
  };
}
