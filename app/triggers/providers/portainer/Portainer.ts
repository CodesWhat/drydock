import path from 'node:path';
import yaml from 'yaml';
import { getState } from '../../../registry/index.js';
import { buildComposeProjectLockKey } from '../../../updates/update-locks.js';
import Docker, { type DockerTriggerConfiguration } from '../docker/Docker.js';
import { getRequestedOperationId } from '../docker/update-runtime-context.js';
import {
  updateComposeServiceImageInText,
  YAML_MAX_ALIAS_COUNT,
} from '../dockercompose/ComposeFileParser.js';

const COMPOSE_PROJECT_LABEL = 'com.docker.compose.project';
const COMPOSE_PROJECT_CONFIG_FILES_LABEL = 'com.docker.compose.project.config_files';
const COMPOSE_PROJECT_WORKING_DIR_LABEL = 'com.docker.compose.project.working_dir';
const COMPOSE_SERVICE_LABEL = 'com.docker.compose.service';
const DEFAULT_VERSION_VAR_LABEL = 'dd.portainer.version-var';
const DEFAULT_UPDATE_MODE_LABEL = 'dd.portainer.update-mode';
const STACK_ID_LABEL = 'dd.portainer.stack-id';
const ENDPOINT_ID_LABEL = 'dd.portainer.endpoint-id';
const DEFAULT_REDEPLOY_TIMEOUT_MS = 5 * 60 * 1000;
const REDEPLOY_POLL_INTERVAL_MS = 2 * 1000;

type PortainerUpdateMode = 'auto' | 'env' | 'compose';

interface PortainerTriggerConfiguration extends DockerTriggerConfiguration {
  url: string;
  apikey: string;
  updateMode: PortainerUpdateMode;
  versionVarLabel: string;
  updateModeLabel: string;
  pullImage: boolean;
  pruneStack: boolean;
  redeployTimeout: number;
}

interface PortainerStackSummary {
  Id: number;
  Name?: string;
  EndpointId?: number;
  ProjectPath?: string;
  Env?: PortainerStackEnv[];
}

interface PortainerStackDetails extends PortainerStackSummary {
  Env?: PortainerStackEnv[];
}

interface PortainerStackEnv {
  name: string;
  value: string;
}

interface PortainerStackFileResponse {
  StackFileContent: string;
}

interface ComposeFile {
  services?: Record<string, { image?: string } | unknown>;
}

interface ResolvedPortainerStack {
  stack: PortainerStackDetails;
  stackFileContent: string;
}

interface ResolvedPortainerUpdate {
  mode: 'env' | 'compose';
  stack: PortainerStackDetails;
  stackFileContent: string;
  service: string;
  serviceImage?: string;
  versionVar?: string;
  targetImage: string;
  targetTag?: string;
  updatedStackFileContent: string;
  updatedEnv: PortainerStackEnv[];
}

interface DockerContainerListItem {
  Id?: string;
  Image?: string;
  State?: string;
  Status?: string;
  Names?: string[];
  Labels?: Record<string, string>;
}

interface DockerApiWithListContainers {
  listContainers: (options?: { all?: boolean }) => Promise<DockerContainerListItem[]>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizePortainerUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function normalizePath(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? path.posix.normalize(trimmed) : null;
}

function getComposeConfigFiles(labels?: Record<string, string>): string[] {
  const configFiles = labels?.[COMPOSE_PROJECT_CONFIG_FILES_LABEL];
  if (!configFiles) {
    return [];
  }

  const workingDir = normalizePath(labels?.[COMPOSE_PROJECT_WORKING_DIR_LABEL]);
  return configFiles
    .split(',')
    .map((file) => file.trim())
    .filter((file) => file.length > 0)
    .map((file) =>
      path.posix.isAbsolute(file) || !workingDir ? file : path.posix.join(workingDir, file),
    )
    .map((file) => path.posix.normalize(file));
}

function getComposeProjectPaths(labels?: Record<string, string>): Set<string> {
  const paths = new Set<string>();
  const workingDir = normalizePath(labels?.[COMPOSE_PROJECT_WORKING_DIR_LABEL]);
  if (workingDir) {
    paths.add(workingDir);
  }

  for (const configFile of getComposeConfigFiles(labels)) {
    paths.add(path.posix.dirname(configFile));
  }
  return paths;
}

function normalizeImplicitLatest(image: string | undefined): string | undefined {
  if (!image || image.includes('@')) {
    return image;
  }
  const lastSegment = image.split('/').pop() || image;
  if (lastSegment.includes(':')) {
    return image;
  }
  return `${image}:latest`;
}

function getServiceKey(compose: ComposeFile, container, currentImage: string): string | undefined {
  const composeServiceName = container.labels?.[COMPOSE_SERVICE_LABEL];
  if (composeServiceName && compose.services?.[composeServiceName]) {
    return composeServiceName;
  }

  const hasComposeIdentityLabels = Boolean(
    container.labels?.[COMPOSE_PROJECT_LABEL] ||
      container.labels?.[COMPOSE_PROJECT_CONFIG_FILES_LABEL] ||
      container.labels?.[COMPOSE_PROJECT_WORKING_DIR_LABEL],
  );
  if (hasComposeIdentityLabels) {
    return undefined;
  }

  return Object.entries(compose.services || {}).find(([, service]) => {
    const image = isPlainObject(service) ? service.image : undefined;
    if (typeof image !== 'string') {
      return false;
    }
    const normalized = normalizeImplicitLatest(image);
    return image === currentImage || normalized === currentImage || image.includes(currentImage);
  })?.[0];
}

function getServiceImage(compose: ComposeFile, service: string): string | undefined {
  const serviceDefinition = compose.services?.[service];
  if (!isPlainObject(serviceDefinition)) {
    return undefined;
  }
  return typeof serviceDefinition.image === 'string' ? serviceDefinition.image : undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTargetServiceContainer(
  item: DockerContainerListItem,
  container,
  resolved: ResolvedPortainerUpdate,
): boolean {
  const labels = item.Labels || {};
  const service = labels[COMPOSE_SERVICE_LABEL];
  const project = labels[COMPOSE_PROJECT_LABEL];
  const expectedProject = container.labels?.[COMPOSE_PROJECT_LABEL];
  if (service !== resolved.service) {
    return false;
  }
  if (expectedProject && project !== expectedProject) {
    return false;
  }
  return item.Image === resolved.targetImage;
}

function extractTagVariable(image: string | undefined): string | undefined {
  if (!image || image.includes('@')) {
    return undefined;
  }
  const lastSlashIndex = image.lastIndexOf('/');
  const lastColonIndex = image.indexOf(':', lastSlashIndex + 1);
  if (lastColonIndex <= lastSlashIndex) {
    return undefined;
  }

  const tag = image.slice(lastColonIndex + 1).trim();
  const match = tag.match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-[^}]*)?\}$/);
  return match?.[1];
}

function getTargetTag(container): string | undefined {
  const remoteValue = container.updateKind?.remoteValue;
  if (typeof remoteValue === 'string' && remoteValue.trim() !== '') {
    return remoteValue;
  }
  const resultTag = container.result?.tag;
  return typeof resultTag === 'string' && resultTag.trim() !== '' ? resultTag : undefined;
}

function upsertStackEnv(
  env: PortainerStackEnv[] | undefined,
  name: string,
  value: string,
): PortainerStackEnv[] {
  const nextEnv = (env || []).filter((entry) => entry.name !== name);
  nextEnv.push({ name, value });
  return nextEnv;
}

/**
 * Update a Portainer-managed compose stack through Portainer's stack redeploy API.
 */
class Portainer extends Docker<PortainerTriggerConfiguration> {
  getConfigurationSchema() {
    return super
      .getConfigurationSchema()
      .append({
        url: this.joi
          .string()
          .uri({
            scheme: ['http', 'https'],
          })
          .required(),
        apikey: this.joi.string().required(),
        updateMode: this.joi.string().valid('auto', 'env', 'compose').default('auto'),
        versionVarLabel: this.joi.string().default(DEFAULT_VERSION_VAR_LABEL),
        updateModeLabel: this.joi.string().default(DEFAULT_UPDATE_MODE_LABEL),
        pullImage: this.joi.boolean().default(true),
        pruneStack: this.joi.boolean().default(false),
        redeployTimeout: this.joi.number().integer().min(0).default(DEFAULT_REDEPLOY_TIMEOUT_MS),
      })
      .rename('updatemode', 'updateMode', {
        ignoreUndefined: true,
        override: true,
      })
      .rename('versionvarlabel', 'versionVarLabel', {
        ignoreUndefined: true,
        override: true,
      })
      .rename('updatemodelabel', 'updateModeLabel', {
        ignoreUndefined: true,
        override: true,
      })
      .rename('pullimage', 'pullImage', {
        ignoreUndefined: true,
        override: true,
      })
      .rename('prunestack', 'pruneStack', {
        ignoreUndefined: true,
        override: true,
      })
      .rename('redeploytimeout', 'redeployTimeout', {
        ignoreUndefined: true,
        override: true,
      });
  }

  maskConfiguration() {
    return this.maskFields(['apikey']);
  }

  getPortainerUrl() {
    return normalizePortainerUrl(this.configuration.url);
  }

  getHeaders() {
    return {
      'Content-Type': 'application/json',
      'X-API-Key': this.configuration.apikey,
    };
  }

  async portainerFetch<T>(pathname: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.getPortainerUrl()}${pathname}`, {
      ...init,
      headers: {
        ...this.getHeaders(),
        ...(init.headers || {}),
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `Portainer API request ${pathname} failed with HTTP ${response.status}${body ? ` (${body})` : ''}`,
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  async getPortainerStacks(): Promise<PortainerStackSummary[]> {
    return this.portainerFetch<PortainerStackSummary[]>('/api/stacks');
  }

  async getPortainerStack(id: number): Promise<PortainerStackDetails> {
    return this.portainerFetch<PortainerStackDetails>(`/api/stacks/${id}`);
  }

  async getPortainerStackFile(id: number): Promise<string> {
    const response = await this.portainerFetch<PortainerStackFileResponse>(
      `/api/stacks/${id}/file`,
    );
    return response.StackFileContent;
  }

  async redeployPortainerStack(stack: PortainerStackDetails, stackFileContent: string, env) {
    const endpointId = stack.EndpointId;
    if (!Number.isFinite(endpointId)) {
      throw new Error(`Portainer stack ${stack.Id} has no EndpointId`);
    }

    if (this.configuration.dryrun) {
      this.log.info(
        `Skip Portainer stack ${stack.Name || stack.Id} redeploy because dry-run mode is enabled`,
      );
      return;
    }

    await this.portainerFetch<void>(`/api/stacks/${stack.Id}?endpointId=${endpointId}`, {
      method: 'PUT',
      body: JSON.stringify({
        stackFileContent,
        env,
        prune: this.configuration.pruneStack,
        pullImage: this.configuration.pullImage,
      }),
    });
  }

  async waitForPortainerRedeploy(
    dockerApi: DockerApiWithListContainers | undefined,
    container,
    resolved: ResolvedPortainerUpdate,
    logContainer,
  ) {
    if (!dockerApi || typeof dockerApi.listContainers !== 'function') {
      logContainer.warn(
        'Unable to verify Portainer redeploy because Docker listContainers is unavailable',
      );
      return;
    }

    const timeoutMs = this.configuration.redeployTimeout;
    if (!(timeoutMs > 0)) {
      logContainer.info(
        'Skip Portainer redeploy verification because redeploy timeout is disabled',
      );
      return;
    }

    const startedAt = Date.now();
    let lastSeen: string | undefined;
    do {
      const containers = await dockerApi.listContainers({ all: true });
      const matched = containers.find((item) =>
        isTargetServiceContainer(item, container, resolved),
      );
      if (matched) {
        logContainer.info(
          `Portainer redeploy verified: ${matched.Names?.[0]?.replace(/^\//, '') || matched.Id?.substring(0, 12) || resolved.service} now uses ${resolved.targetImage}`,
        );
        return;
      }

      const sameService = containers.find((item) => {
        const labels = item.Labels || {};
        return (
          labels[COMPOSE_SERVICE_LABEL] === resolved.service &&
          labels[COMPOSE_PROJECT_LABEL] === container.labels?.[COMPOSE_PROJECT_LABEL]
        );
      });
      if (sameService?.Image && sameService.Image !== lastSeen) {
        lastSeen = sameService.Image;
        logContainer.debug(
          `Waiting for Portainer redeploy of ${resolved.service}: current image is ${sameService.Image}, target is ${resolved.targetImage}`,
        );
      }

      await delay(REDEPLOY_POLL_INTERVAL_MS);
    } while (Date.now() - startedAt < timeoutMs);

    throw new Error(
      `Timed out waiting for Portainer stack ${resolved.stack.Name || resolved.stack.Id} service ${resolved.service} to use ${resolved.targetImage}`,
    );
  }

  async resolvePortainerStack(container): Promise<ResolvedPortainerStack> {
    const configuredStackId = container.labels?.[STACK_ID_LABEL];
    const stacks = await this.getPortainerStacks();
    let matchedStack: PortainerStackSummary | undefined;

    if (configuredStackId) {
      matchedStack = stacks.find((stack) => String(stack.Id) === configuredStackId);
      if (!matchedStack) {
        throw new Error(`Unable to find Portainer stack with id ${configuredStackId}`);
      }
    } else {
      const containerProjectPaths = getComposeProjectPaths(container.labels);
      matchedStack = stacks.find((stack) => {
        const projectPath = normalizePath(stack.ProjectPath);
        return Boolean(projectPath && containerProjectPaths.has(projectPath));
      });
    }

    if (!matchedStack) {
      throw new Error(`Unable to resolve Portainer stack for container ${container.name}`);
    }

    const stack = await this.getPortainerStack(matchedStack.Id);
    const endpointId = container.labels?.[ENDPOINT_ID_LABEL];
    if (endpointId) {
      stack.EndpointId = Number(endpointId);
    }

    const stackFileContent = await this.getPortainerStackFile(stack.Id);
    return { stack, stackFileContent };
  }

  resolveConfiguredUpdateMode(container): PortainerUpdateMode {
    const labelMode = container.labels?.[this.configuration.updateModeLabel];
    if (labelMode === 'auto' || labelMode === 'env' || labelMode === 'compose') {
      return labelMode;
    }
    return this.configuration.updateMode;
  }

  resolvePortainerUpdate(container, targetImage: string): Promise<ResolvedPortainerUpdate> {
    return this.resolvePortainerStack(container).then(({ stack, stackFileContent }) => {
      const compose = yaml.parse(stackFileContent, {
        maxAliasCount: YAML_MAX_ALIAS_COUNT,
      }) as ComposeFile;
      const registry = getState().registry[container.image.registry.name];
      const currentImage = registry.getImageFullName(container.image, container.image.tag.value);
      const service = getServiceKey(compose, container, currentImage);
      if (!service) {
        throw new Error(
          `Unable to resolve Portainer stack service for container ${container.name}`,
        );
      }

      const serviceImage = getServiceImage(compose, service);
      const explicitVersionVar = container.labels?.[this.configuration.versionVarLabel];
      const detectedVersionVar = extractTagVariable(serviceImage);
      const updateMode = this.resolveConfiguredUpdateMode(container);
      const targetTag = getTargetTag(container);
      const shouldUseEnv =
        updateMode === 'env' ||
        (updateMode === 'auto' && Boolean(explicitVersionVar || detectedVersionVar));

      if (shouldUseEnv) {
        const versionVar = explicitVersionVar || detectedVersionVar;
        if (!versionVar) {
          throw new Error(
            `Portainer env update for ${container.name} requires ${this.configuration.versionVarLabel} or a tag variable in the compose image`,
          );
        }
        if (!targetTag) {
          throw new Error(
            `Portainer env update for ${container.name} requires a tag update target`,
          );
        }
        return {
          mode: 'env',
          stack,
          stackFileContent,
          service,
          serviceImage,
          versionVar,
          targetImage,
          targetTag,
          updatedStackFileContent: stackFileContent,
          updatedEnv: upsertStackEnv(stack.Env, versionVar, targetTag),
        };
      }

      return {
        mode: 'compose',
        stack,
        stackFileContent,
        service,
        serviceImage,
        targetImage,
        targetTag,
        updatedStackFileContent: updateComposeServiceImageInText(
          stackFileContent,
          service,
          targetImage,
        ),
        updatedEnv: stack.Env || [],
      };
    });
  }

  async preview(container) {
    const preview = await super.preview(container);
    if (!preview || typeof preview !== 'object' || 'error' in preview) {
      return preview;
    }

    const resolved = await this.resolvePortainerUpdate(container, preview.newImage);
    return {
      ...preview,
      portainer: {
        stackId: resolved.stack.Id,
        stackName: resolved.stack.Name,
        endpointId: resolved.stack.EndpointId,
        service: resolved.service,
        mode: resolved.mode,
        versionVar: resolved.versionVar,
        mutation: {
          intent:
            resolved.mode === 'env'
              ? 'update-portainer-stack-env'
              : 'update-portainer-stack-compose-service-image',
          dryRun: Boolean(this.configuration.dryrun),
          willWrite: !this.configuration.dryrun,
        },
      },
    };
  }

  async runPreRuntimeUpdateLifecycle(context, container, logContainer, runtimeContext?: unknown) {
    if (this.configuration.dryrun) {
      logContainer.info('Skip prune/backup in Portainer dry-run mode');
      return;
    }
    await super.runPreRuntimeUpdateLifecycle(context, container, logContainer, runtimeContext);
  }

  async performContainerUpdate(
    context,
    container,
    logContainer,
    runtimeContext?: unknown,
    postPullHook?: (operationId: string) => Promise<void>,
  ) {
    const resolved = await this.resolvePortainerUpdate(container, context.newImage);
    logContainer.info(
      `Redeploy Portainer stack ${resolved.stack.Name || resolved.stack.Id} service ${resolved.service} using ${resolved.mode} mode`,
    );

    await this.redeployPortainerStack(
      resolved.stack,
      resolved.updatedStackFileContent,
      resolved.updatedEnv,
    );

    await this.waitForPortainerRedeploy(context.dockerApi, container, resolved, logContainer);

    if (postPullHook) {
      await postPullHook(getRequestedOperationId(container, runtimeContext) ?? '');
    }

    return !this.configuration.dryrun;
  }

  override getUpdateLockKeys(container: {
    name: string;
    watcher: string;
    labels?: Record<string, string>;
  }): string[] {
    const keys = super.getUpdateLockKeys(container);
    const composeProject = container.labels?.[COMPOSE_PROJECT_LABEL];
    if (composeProject) {
      keys.push(buildComposeProjectLockKey(container, composeProject));
    }
    return keys;
  }
}

export default Portainer;

export {
  extractTagVariable as testable_extractTagVariable,
  getComposeProjectPaths as testable_getComposeProjectPaths,
  getTargetTag as testable_getTargetTag,
  upsertStackEnv as testable_upsertStackEnv,
};
