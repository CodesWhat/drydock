import type { AgentClient } from '../../agent/AgentClient.js';
import type { Container, ContainerReport } from '../../model/container.js';
import type { PaginationLinks } from '../pagination-links.js';

export interface CrudStoreContainerApi {
  getContainer: (id: string) => Container | undefined;
  deleteContainer: (id: string) => void;
}

export interface ContainerListPagination {
  limit: number;
  offset: number;
}

export interface ContainerListResponse {
  data: Container[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  _links?: PaginationLinks;
}

export interface WatchContainersBody {
  containerIds?: string[];
}

export interface UpdateOperationStoreApi {
  getOperationsByContainerName: (containerName: string) => unknown[];
  getInProgressOperationByContainerName: (containerName: string) => unknown | undefined;
  getInProgressOperationByContainerId: (containerId: string) => unknown | undefined;
  getActiveOperationByContainerName: (containerName: string) => unknown | undefined;
  getActiveOperationByContainerId: (containerId: string) => unknown | undefined;
}

export interface ServerConfiguration {
  feature: {
    delete: boolean;
  };
}

export interface LocalContainerWatcher {
  watch: () => Promise<unknown>;
  getContainers?: () => Promise<Container[]>;
  watchContainer: (container: Container) => Promise<ContainerReport>;
}

export interface AuditStoreApi {
  insertAudit: (entry: {
    action: string;
    containerName: string;
    containerImage?: string;
    status: string;
    details?: string;
  }) => unknown;
}

export interface CrudHandlerDependencies {
  storeApi: {
    getContainersFromStore: (
      query: Record<string, unknown>,
      pagination?: ContainerListPagination,
    ) => Container[];
    getContainerCountFromStore: (query: Record<string, unknown>) => number;
    storeContainer: CrudStoreContainerApi;
    updateOperationStore: UpdateOperationStoreApi;
    getContainerRaw?: (id: string) => Container | undefined;
  };
  agentApi: {
    getServerConfiguration: () => ServerConfiguration;
    getAgent: (name: string) => AgentClient | undefined;
    getWatchers: () => Record<string, LocalContainerWatcher>;
  };
  errorApi: {
    getErrorMessage: (error: unknown) => string;
    getErrorStatusCode: (error: unknown) => number | undefined;
  };
  securityApi: {
    redactContainerRuntimeEnv: (container: Container) => Container;
    redactContainersRuntimeEnv: (containers: Container[]) => Container[];
    auditStore?: AuditStoreApi;
  };
}

export interface CrudHandlerContext {
  getContainersFromStore: CrudHandlerDependencies['storeApi']['getContainersFromStore'];
  getContainerCountFromStore: CrudHandlerDependencies['storeApi']['getContainerCountFromStore'];
  storeContainer: CrudStoreContainerApi;
  updateOperationStore: UpdateOperationStoreApi;
  getContainerRaw?: CrudHandlerDependencies['storeApi']['getContainerRaw'];
  getServerConfiguration: CrudHandlerDependencies['agentApi']['getServerConfiguration'];
  getAgent: CrudHandlerDependencies['agentApi']['getAgent'];
  getWatchers: CrudHandlerDependencies['agentApi']['getWatchers'];
  getErrorMessage: CrudHandlerDependencies['errorApi']['getErrorMessage'];
  getErrorStatusCode: CrudHandlerDependencies['errorApi']['getErrorStatusCode'];
  redactContainerRuntimeEnv: CrudHandlerDependencies['securityApi']['redactContainerRuntimeEnv'];
  redactContainersRuntimeEnv: CrudHandlerDependencies['securityApi']['redactContainersRuntimeEnv'];
  auditStore?: AuditStoreApi;
}

export interface WatchTarget {
  container: Container;
  watcher: LocalContainerWatcher;
}

export function buildCrudHandlerContext({
  storeApi: {
    getContainersFromStore,
    getContainerCountFromStore,
    storeContainer,
    updateOperationStore,
    getContainerRaw,
  },
  agentApi: { getServerConfiguration, getAgent, getWatchers },
  errorApi: { getErrorMessage, getErrorStatusCode },
  securityApi: { redactContainerRuntimeEnv, redactContainersRuntimeEnv, auditStore },
}: CrudHandlerDependencies): CrudHandlerContext {
  return {
    getContainersFromStore,
    getContainerCountFromStore,
    storeContainer,
    updateOperationStore,
    getContainerRaw,
    getServerConfiguration,
    getAgent,
    getWatchers,
    getErrorMessage,
    getErrorStatusCode,
    redactContainerRuntimeEnv,
    redactContainersRuntimeEnv,
    auditStore,
  };
}
