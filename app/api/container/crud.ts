import type { Request, Response } from 'express';
import type { AgentClient } from '../../agent/AgentClient.js';
import type { Container, ContainerReport } from '../../model/container.js';

interface StoreContainerApi {
  getContainer: (
    id: string,
    options?: {
      includeRuntimeEnvValues?: boolean;
    },
  ) => Container | undefined;
  deleteContainer: (id: string) => void;
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

export interface CrudHandlerDependencies {
  getContainersFromStore: (query: Request['query']) => Container[];
  storeContainer: StoreContainerApi;
  updateOperationStore: UpdateOperationStoreApi;
  getServerConfiguration: () => ServerConfiguration;
  getAgent: (name: string) => AgentClient | undefined;
  getErrorMessage: (error: unknown) => string;
  getErrorStatusCode: (error: unknown) => number | undefined;
  getWatchers: () => Record<string, LocalContainerWatcher>;
  redactContainerRuntimeEnv: (container: Container) => Container;
  redactContainersRuntimeEnv: (containers: Container[]) => Container[];
}

function getPathParamValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] || '';
  }
  return value || '';
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
}: CrudHandlerDependencies) {
  /**
   * Get all (filtered) containers.
   * @param req
   * @param res
   */
  function getContainers(req: Request, res: Response) {
    const { query } = req;
    const containers = getContainersFromStore(query);
    res.status(200).json(redactContainersRuntimeEnv(containers));
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

    const container = storeContainer.getContainer(id, {
      includeRuntimeEnvValues: true,
    });
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

  return {
    getContainers,
    getContainer,
    getContainerUpdateOperations,
    deleteContainer,
    watchContainers,
    watchContainer,
  };
}
