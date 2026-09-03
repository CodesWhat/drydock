import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'yaml';
import { buildDependencyGraph, topologicalSort } from '../../../dependencies/dependency-graph.js';
import type { ContainerImage } from '../../../model/container.js';
import type Registry from '../../../registries/Registry.js';
import { getState } from '../../../registry/index.js';
import { resolveConfiguredPath, resolveConfiguredPathWithinBase } from '../../../runtime/paths.js';
import * as updateOperationStore from '../../../store/update-operation.js';
import {
  buildComposeFileLockKeys,
  buildComposeProjectLockKey,
  withContainerUpdateLocks,
} from '../../../updates/update-locks.js';
import { sleep } from '../../../util/sleep.js';
import {
  attachCreatedContainerCandidate,
  cleanupCreatedContainerCandidate,
  getCreatedContainerCandidate,
} from '../docker/created-container-candidate.js';
import Docker, {
  type DockerContainerHandle,
  type DockerTriggerConfiguration,
} from '../docker/Docker.js';
import { getRequestedOperationId } from '../docker/update-runtime-context.js';
import ComposeFileLockManager from './ComposeFileLockManager.js';
import ComposeFileParser, {
  COMPOSE_CACHE_MAX_ENTRIES,
  updateComposeServiceImageInText,
  updateComposeServiceImagesInText,
  YAML_MAX_ALIAS_COUNT,
} from './ComposeFileParser.js';
import {
  getSelfContainerIdentifier as getRuntimeSelfContainerIdentifier,
  getSelfContainerBindMounts,
  mapComposePathToContainerBindMount as mapComposePathThroughBindMounts,
  parseHostToContainerBindMount as parseHostContainerBindMount,
} from './ComposePathBindMounts.js';
import PostStartExecutor, {
  normalizePostStartEnvironmentValue,
  normalizePostStartHooks,
} from './PostStartExecutor.js';

const COMPOSE_RENAME_MAX_RETRIES = 5;
const COMPOSE_RENAME_RETRY_MS = 200;
const COMPOSE_PROJECT_LABEL = 'com.docker.compose.project';
const COMPOSE_PROJECT_CONFIG_FILES_LABEL = 'com.docker.compose.project.config_files';
const COMPOSE_PROJECT_WORKING_DIR_LABEL = 'com.docker.compose.project.working_dir';
const COMPOSE_DIRECTORY_FILE_CANDIDATES = [
  'compose.yaml',
  'compose.yml',
  'docker-compose.yaml',
  'docker-compose.yml',
];
const ROOT_MODE_BREAK_GLASS_HINT =
  'use socket proxy or adjust file permissions/group_add; break-glass root mode requires DD_RUN_AS_ROOT=true + DD_ALLOW_INSECURE_ROOT=true';
interface DockercomposeTriggerConfiguration extends DockerTriggerConfiguration {
  file?: string;
  backup: boolean;
  composeFileLabel: string;
  reconciliationMode: 'warn' | 'block' | 'off';
  digestPinning: boolean;
  composeFileOnce: boolean;
  mountPrefixFallback: boolean;
}

interface DockerApiLike {
  modem: {
    socketPath: string;
  };
  info?: () => Promise<{
    Architecture?: unknown;
  }>;
  getContainer: (containerName: string) => {
    inspect: () => Promise<{
      State?: {
        Running?: boolean;
      };
      Config?: {
        Labels?: Record<string, string>;
      };
      HostConfig?: {
        Binds?: string[];
      };
    }>;
    exec: (options: unknown) => Promise<{
      start: (options: { Detach: boolean; Tty: boolean }) => Promise<{
        once?: (event: string, callback: (error?: unknown) => void) => void;
        removeListener: (event: string, callback: (error?: unknown) => void) => void;
        resume?: () => void;
      }>;
      inspect: () => Promise<{
        ExitCode?: number;
      }>;
    }>;
  };
  getImage?: (imageRef: string) => {
    inspect: () => Promise<{
      Id?: string;
      RepoDigests?: string[];
      Architecture?: string;
      Os?: string;
    }>;
  };
}

type ContainersByComposeFileEntry = {
  composeFile: string;
  composeFiles: string[];
  containers: unknown[];
};

type HostToContainerBindMount = {
  source: string;
  destination: string;
};

type ComposeContainerReference = {
  id?: unknown;
  name?: string;
  labels?: Record<string, string>;
  watcher?: string;
  // Optional dependency-ordering fields (v1.7 Phase 6.1, #219). Not declared
  // by every caller of this narrowed reference type, but the underlying
  // watcher-discovered Container objects always carry them (resolved by
  // container-init.ts / compose-dependency-resolver.ts) — declaring them
  // here is a type-level-only change, see sortMappingsByDependencyOrder.
  dependsOn?: string[];
  dependsOnSource?: 'label' | 'compose';
  dependsOnAction?: 'update' | 'restart';
};

type RuntimeUpdateContainerReference = {
  result?: {
    digest?: unknown;
  };
  updateKind?: {
    kind?: string;
    remoteValue?: unknown;
  };
};

type RegistryImageContainerReference = {
  image: {
    registry: {
      name: string;
    };
    tag: {
      value: string;
    };
  };
};

type RegistryPullAuth = Awaited<ReturnType<Registry['getAuthPull']>>;
type ComposeRuntimeContext = {
  dockerApi?: unknown;
  auth?: RegistryPullAuth;
  newImage?: string;
  imageIdentity?: string;
  securityGateUnboundWarn?: boolean;
  securityGateUnboundReason?: string;
  operationId?: string;
  registry?: unknown;
};

type ComposeUpdateLifecycleContext = {
  composeFile: string;
  service: string;
  serviceDefinition?: unknown;
  composeFiles?: string[];
  composeFileOnceApplied?: boolean;
  onRuntimeUpdateApplied?: () => void;
  skipPull?: boolean;
  runtimeContext?: ComposeRuntimeContext;
  postPullGateCompleted?: boolean;
};

type ComposeRuntimeUpdateMapping = {
  service: string;
  container: ComposeContainerReference &
    RuntimeUpdateContainerReference &
    RegistryImageContainerReference;
};

type ComposeRuntimeRefreshOptions = {
  shouldStart?: boolean;
  skipPull?: boolean;
  forceRecreate?: boolean;
  composeFiles?: string[];
  runtimeContext?: ComposeRuntimeContext;
  postPullHook?: (operationId: string, imageIdentity?: string) => Promise<void>;
};

type ComposeRollbackOutcome = {
  status: 'rolled-back' | 'rollback-failed';
  phase: 'rolled-back' | 'rollback-failed';
  rollbackReason: 'compose_runtime_refresh_failed';
  lastError: string;
};

type ComposeRollbackError = Error & {
  composeRollbackOutcome?: ComposeRollbackOutcome;
};

function hasDefinedComposeRuntimeContextValue(runtimeContext: ComposeRuntimeContext): boolean {
  return Object.values(runtimeContext).some((value) => value !== undefined);
}

/**
 * Re-order `mappingsNeedingRuntimeUpdate` into dependency-graph topological
 * order before `runRuntimeUpdatesForComposeMappings`'s sequential loop
 * (v1.7 Phase 6.1, #219 — design §3): this loop was already the easiest
 * dependency-ordering integration point in the codebase since it's a plain
 * `for...of` with no concurrency to restructure — just swap "discovery
 * order" for "topological order". `buildDependencyGraph`'s own compose-edge
 * resolution matches candidates by compose project/service LABEL, not by the
 * node id supplied here, so a synthetic per-index id is used as the node id
 * — service names are not reliably unique across mappings (e.g. `docker
 * compose up --scale`, which produces multiple containers for one service).
 * A mapping list with no `depends_on` edges resolves to a single wave and is
 * returned unchanged.
 */
function sortMappingsByDependencyOrder(
  mappings: ComposeRuntimeUpdateMapping[],
): ComposeRuntimeUpdateMapping[] {
  if (mappings.length <= 1) {
    return mappings;
  }

  const mappingById = new Map<string, ComposeRuntimeUpdateMapping>();
  const graphContainers = mappings.map((mapping, index) => {
    const id = `mapping-${index}`;
    mappingById.set(id, mapping);
    return {
      id,
      name: mapping.container.name ?? mapping.service,
      watcher: mapping.container.watcher,
      labels: mapping.container.labels,
      dependsOn: mapping.container.dependsOn,
      dependsOnSource: mapping.container.dependsOnSource,
      dependsOnAction: mapping.container.dependsOnAction,
    };
  });
  const { nodes, edges } = buildDependencyGraph(graphContainers);
  const { waves } = topologicalSort(nodes, edges);

  const ordered: ComposeRuntimeUpdateMapping[] = [];
  for (const wave of waves) {
    for (const id of wave) {
      const mapping = mappingById.get(id);
      /* v8 ignore next 3 -- defensive only: every wave id originates from
         graphContainers built from this same mappings array, so mappingById
         (keyed the same way) always has a match. */
      if (!mapping) {
        continue;
      }
      ordered.push(mapping);
    }
  }
  return ordered;
}

type ValidateComposeConfigurationOptions = {
  composeFiles?: string[];
  parsedComposeFileObject?: unknown;
};

type MutateComposeFileOptions = ValidateComposeConfigurationOptions & {
  captureSnapshot?: boolean;
  backupFilePath?: string;
  validateCurrentState?: (
    composeFileText: string,
    filePath: string,
    composeFileChain: string[],
  ) => Promise<void>;
};

type ComposeFileMutationSnapshot = {
  filePath: string;
  originalText: string;
};

type ComposeRuntimeUpdateCompletion = {
  service: string;
  containerName?: string;
};

type RestoreComposeFileMutationOptions = {
  composeFileChain?: string[];
  composeByFile?: Map<string, unknown>;
  mappingsToPreserve?: unknown[];
};

type ComposeFileWithServices = {
  services?: Record<string, { image?: string }>;
};

function getDockerApiFromWatcher(watcher: unknown): DockerApiLike | undefined {
  if (!watcher || typeof watcher !== 'object') {
    return undefined;
  }
  const dockerApi = (watcher as { dockerApi?: unknown }).dockerApi;
  if (!dockerApi || typeof dockerApi !== 'object') {
    return undefined;
  }
  const maybeDockerApi = dockerApi as Partial<DockerApiLike>;
  if (!maybeDockerApi.modem || typeof maybeDockerApi.getContainer !== 'function') {
    return undefined;
  }
  return maybeDockerApi as DockerApiLike;
}

function resolveComposeInterpolation(
  value: unknown,
  environment: Record<string, string> = {},
): unknown {
  if (typeof value !== 'string' || !value.includes('${')) {
    return value;
  }

  return value.replace(
    /\$\{([_a-zA-Z][_a-zA-Z0-9]*)(?:(:-|-)([^}]*))?\}/g,
    (
      expression,
      variableName: string,
      operator: string | undefined,
      fallback: string | undefined,
    ) => {
      const configuredValue = environment[variableName];
      if (configuredValue !== undefined && (operator !== ':-' || configuredValue !== '')) {
        return configuredValue;
      }
      if (operator === ':-' || operator === '-') {
        return fallback as string;
      }
      return configuredValue ?? expression;
    },
  );
}

const COMPOSE_ESCAPED_DOLLAR = '\u0000';

function resolveComposeImageForContinuity(
  value: unknown,
  authoritativeResolvedImage?: unknown,
): unknown {
  if (typeof value !== 'string' || !value.includes('${')) {
    return value;
  }
  return authoritativeResolvedImage ?? value;
}

function getComposeRepositoryPart(imageReference: string): string {
  const withoutDigest = imageReference.split('@')[0];
  const lastSlashIndex = withoutDigest.lastIndexOf('/');
  const lastColonIndex = withoutDigest.lastIndexOf(':');
  return lastColonIndex > lastSlashIndex ? withoutDigest.slice(0, lastColonIndex) : withoutDigest;
}

function composeImageRepositoryMatchesRuntime(
  composeImage: unknown,
  runtimeImage: unknown,
): boolean {
  if (typeof composeImage !== 'string' || !composeImage.includes('${')) {
    return getImageRepositoryKey(runtimeImage) === getImageRepositoryKey(composeImage);
  }
  const repositoryPart = getComposeRepositoryPart(composeImage);
  const resolvedRepository = resolveComposeInterpolation(repositoryPart, {});
  if (typeof resolvedRepository !== 'string' || resolvedRepository.includes('${')) {
    return false;
  }
  return getImageRepositoryKey(runtimeImage) === getImageRepositoryKey(resolvedRepository);
}

function parseDoubleQuotedComposeEnvironmentValue(value: string): string | undefined {
  let decoded = '';
  for (let index = 0; index < value.length; index++) {
    if (value[index] !== '\\') {
      decoded += value[index];
      continue;
    }
    const escaped = value[++index];
    const replacements: Record<string, string> = {
      n: '\n',
      r: '\r',
      t: '\t',
      '\\': '\\',
      '"': '"',
    };
    if (escaped === '$') {
      decoded += COMPOSE_ESCAPED_DOLLAR;
      continue;
    }
    if (!(escaped in replacements)) {
      return undefined;
    }
    decoded += replacements[escaped];
  }
  return decoded;
}

function findComposeQuotedValueEnd(value: string, quote: string): number {
  for (let index = 0; index < value.length; index++) {
    if (value[index] !== quote) {
      continue;
    }
    let backslashCount = 0;
    for (let preceding = index - 1; preceding >= 0 && value[preceding] === '\\'; preceding--) {
      backslashCount++;
    }
    if (backslashCount % 2 === 0) {
      return index;
    }
  }
  return -1;
}

function parseComposeEnvironmentFile(contents: string): Record<string, string> {
  const resolvedEnvironment: Record<string, string> = {};
  const invalidEnvironmentKeys = new Set<string>();
  const lines = contents.split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const assignment = lines[lineIndex].match(
      /^\s*(?:export\s+)?([_a-zA-Z][_a-zA-Z0-9]*)\s*(?:=|:)\s*(.*)$/,
    );
    if (!assignment) {
      continue;
    }
    const variableName = assignment[1];
    const keyAlreadyInvalid = invalidEnvironmentKeys.has(variableName);
    const value = assignment[2].trimStart();
    if (value.startsWith("'")) {
      let quotedValue = value.slice(1);
      let closingIndex = findComposeQuotedValueEnd(quotedValue, "'");
      while (closingIndex < 0 && lineIndex + 1 < lines.length) {
        lineIndex++;
        quotedValue += `\n${lines[lineIndex]}`;
        closingIndex = findComposeQuotedValueEnd(quotedValue, "'");
      }
      const remainder = quotedValue.slice(closingIndex + 1).trim();
      if (closingIndex < 0 || (remainder !== '' && !remainder.startsWith('#'))) {
        invalidEnvironmentKeys.add(variableName);
        delete resolvedEnvironment[variableName];
        continue;
      }
      if (!keyAlreadyInvalid) {
        resolvedEnvironment[variableName] = quotedValue.slice(0, closingIndex).replace(/\\'/g, "'");
      }
      continue;
    }
    if (value.startsWith('"')) {
      let quotedValue = value.slice(1);
      let closingIndex = findComposeQuotedValueEnd(quotedValue, '"');
      while (closingIndex < 0 && lineIndex + 1 < lines.length) {
        lineIndex++;
        quotedValue += `\n${lines[lineIndex]}`;
        closingIndex = findComposeQuotedValueEnd(quotedValue, '"');
      }
      const remainder = quotedValue.slice(closingIndex + 1).trim();
      if (closingIndex < 0 || (remainder !== '' && !remainder.startsWith('#'))) {
        invalidEnvironmentKeys.add(variableName);
        delete resolvedEnvironment[variableName];
        continue;
      }
      const decoded = parseDoubleQuotedComposeEnvironmentValue(quotedValue.slice(0, closingIndex));
      if (decoded === undefined || /(?<!\\)\$(?!\{)/.test(decoded)) {
        invalidEnvironmentKeys.add(variableName);
        delete resolvedEnvironment[variableName];
        continue;
      }
      if (!keyAlreadyInvalid) {
        resolvedEnvironment[variableName] = String(
          resolveComposeInterpolation(decoded, resolvedEnvironment),
        ).replaceAll(COMPOSE_ESCAPED_DOLLAR, '$');
      }
      continue;
    }
    if (/["'`]|\$\(/.test(value)) {
      invalidEnvironmentKeys.add(variableName);
      delete resolvedEnvironment[variableName];
      continue;
    }
    const commentIndex = value.search(/\s#/);
    const unquotedValue = (commentIndex < 0 ? value : value.slice(0, commentIndex))
      .trimEnd()
      .replace(/\\\$/g, COMPOSE_ESCAPED_DOLLAR);
    if (/\$(?!\{)/.test(unquotedValue)) {
      invalidEnvironmentKeys.add(variableName);
      delete resolvedEnvironment[variableName];
      continue;
    }
    if (!keyAlreadyInvalid) {
      resolvedEnvironment[variableName] = String(
        resolveComposeInterpolation(unquotedValue, resolvedEnvironment),
      ).replaceAll(COMPOSE_ESCAPED_DOLLAR, '$');
    }
  }
  return resolvedEnvironment;
}
function getServiceKey(compose, container, currentImage) {
  const composeServiceName = container.labels?.['com.docker.compose.service'];
  if (composeServiceName) {
    return compose.services?.[composeServiceName] ? composeServiceName : undefined;
  }

  const hasComposeIdentityLabels = Boolean(
    container.labels?.[COMPOSE_PROJECT_LABEL] ||
      container.labels?.[COMPOSE_PROJECT_CONFIG_FILES_LABEL] ||
      container.labels?.[COMPOSE_PROJECT_WORKING_DIR_LABEL],
  );
  if (hasComposeIdentityLabels) {
    return undefined;
  }

  const matchesServiceImage = (serviceImage, imageToMatch) => {
    if (!serviceImage || !imageToMatch) {
      return false;
    }
    const resolvedServiceImage = resolveComposeInterpolation(serviceImage);
    const normalizedServiceImage = normalizeImplicitLatest(resolvedServiceImage);

    // Match priority (most strict to most lenient):
    // 1) Exact `service.image` match.
    if (serviceImage === imageToMatch) {
      return true;
    }
    if (resolvedServiceImage === imageToMatch) {
      return true;
    }
    // 2) Exact match after normalizing implicit `:latest`.
    if (normalizedServiceImage === imageToMatch) {
      return true;
    }
    // 3) Substring match against raw `service.image`.
    if (serviceImage.includes(imageToMatch)) {
      return true;
    }
    // 4) Substring match against normalized `service.image`.
    return normalizedServiceImage.includes(imageToMatch);
  };

  return Object.keys(compose.services).find((serviceKey) => {
    const service = compose.services[serviceKey];
    return matchesServiceImage(service.image, currentImage);
  });
}

function normalizeImplicitLatest(image) {
  if (!image) {
    return image;
  }
  if (image.includes('@')) {
    return image;
  }
  const lastSegment = image.split('/').pop() || image;
  if (lastSegment.includes(':')) {
    return image;
  }
  return `${image}:latest`;
}

function hasExplicitRegistryHost(imageReference: string): boolean {
  if (!imageReference) {
    return false;
  }
  const referenceWithoutDigest = imageReference.split('@')[0];
  const firstSlashIndex = referenceWithoutDigest.indexOf('/');
  if (firstSlashIndex < 0) {
    return false;
  }
  const firstSegment = referenceWithoutDigest.slice(0, firstSlashIndex);
  return firstSegment.includes('.') || firstSegment.includes(':') || firstSegment === 'localhost';
}

function preserveExplicitDockerIoPrefix(
  currentComposeImage: string | null | undefined,
  targetImageReference: string,
): string {
  if (!targetImageReference || typeof currentComposeImage !== 'string') {
    return targetImageReference;
  }
  if (!/^docker\.io\//i.test(currentComposeImage.trim())) {
    return targetImageReference;
  }
  if (hasExplicitRegistryHost(targetImageReference)) {
    return targetImageReference;
  }
  return `docker.io/${targetImageReference}`;
}

const HUB_ALIAS_HOST_PREFIX = /^(?:index\.docker\.io|registry-1\.docker\.io|docker\.io)\//i;
const HUB_LIBRARY_NAMESPACE_PREFIX = /^library\//;

/**
 * Reduce an image reference to the repository it names, with the tag, the
 * digest and the Docker Hub aliases that `Hub.getImageFullName` strips removed,
 * so `docker.io/library/nginx:1.27.0` and `nginx@sha256:...` compare equal.
 * @param imageReference
 * @returns the normalized repository, or '' when there is nothing to compare
 */
function getImageRepositoryKey(imageReference: unknown): string {
  const reference = typeof imageReference === 'string' ? imageReference.trim() : '';
  const referenceWithoutDigest = reference.split('@')[0];
  const lastSlashIndex = referenceWithoutDigest.lastIndexOf('/');
  const lastColonIndex = referenceWithoutDigest.lastIndexOf(':');
  const repository =
    lastColonIndex > lastSlashIndex
      ? referenceWithoutDigest.slice(0, lastColonIndex)
      : referenceWithoutDigest;
  const repositoryWithoutHubHost = repository.replace(HUB_ALIAS_HOST_PREFIX, '');
  return hasExplicitRegistryHost(repositoryWithoutHubHost)
    ? repositoryWithoutHubHost
    : repositoryWithoutHubHost.replace(HUB_LIBRARY_NAMESPACE_PREFIX, '');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getErrorMessage(error: unknown): string {
  if (!error || typeof error !== 'object' || !('message' in error)) {
    return String(error);
  }
  return String((error as { message?: unknown }).message);
}

function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * Return true if the container belongs to the compose file.
 * @param compose
 * @param container
 * @returns true/false
 */
function doesContainerBelongToCompose(compose, container) {
  // Get registry configuration
  const registry = getState().registry[container.image.registry.name];

  // Rebuild image definition string
  const currentImage = registry.getImageFullName(container.image, container.image.tag.value);
  return Boolean(getServiceKey(compose, container, currentImage));
}

function buildComposePatchPreview(composeFile, service, currentImage, updateImage) {
  return {
    path: composeFile,
    format: 'unified',
    diff: [
      `--- ${composeFile}`,
      `+++ ${composeFile}`,
      `@@ compose service ${service} image @@`,
      `-  image: ${currentImage}`,
      `+  image: ${updateImage}`,
    ].join('\n'),
  };
}

/**
 * Update a Docker compose stack with an updated one.
 */
class Dockercompose extends Docker<DockercomposeTriggerConfiguration> {
  _composeFileLockManager = new ComposeFileLockManager({
    getLog: () => this.log,
  });
  _composeFileParser = new ComposeFileParser({
    resolveComposeFilePath: (file) => this.resolveComposeFilePath(file),
    getDefaultComposeFilePath: () => this.configuration?.file,
    getLog: () => this.log,
    composeCacheMaxEntries: COMPOSE_CACHE_MAX_ENTRIES,
  });
  _postStartExecutor = new PostStartExecutor({
    getLog: () => this.log,
    getWatcher: (container) => this.getWatcher(container as ComposeContainerReference),
    isDryRun: () => this.configuration?.dryrun === true,
    getDockerApiFromWatcher,
  });
  _hostToContainerBindMountsLoaded = false;
  _hostToContainerBindMountsLoadPromise: Promise<void> | null = null;
  _hostToContainerBindMounts: HostToContainerBindMount[] = [];

  get _composeFileLocksHeld() {
    return this._composeFileLockManager._composeFileLocksHeld;
  }

  get _composeCacheMaxEntries() {
    return this._composeFileParser._composeCacheMaxEntries;
  }

  set _composeCacheMaxEntries(maxEntries: number) {
    this._composeFileParser.setComposeCacheMaxEntries(maxEntries);
  }

  override async runContainerUpdateLifecycle(
    container,
    runtimeContext?: unknown,
    options?: {
      lifecycleAlreadyAcquired?: boolean;
      selfUpdateClassification?: 'current' | 'peer' | 'indeterminate';
      onSelfUpdateOperationId?: (operationId: string, updated: boolean) => void;
    },
  ) {
    return super.runContainerUpdateLifecycle(container, runtimeContext, options);
  }

  get _composeObjectCache() {
    return this._composeFileParser._composeObjectCache;
  }

  get _composeDocumentCache() {
    return this._composeFileParser._composeDocumentCache;
  }

  /**
   * Get the Trigger configuration schema.
   * @returns {*}
   */
  getConfigurationSchema() {
    const schemaDocker = super.getConfigurationSchema();
    return schemaDocker
      .append({
        // Make file optional since we now support per-container compose files
        file: this.joi.string().optional(),
        backup: this.joi.boolean().default(false),
        // Add configuration for the label name to look for
        composeFileLabel: this.joi.string().default('dd.compose.file'),
        reconciliationMode: this.joi.string().valid('warn', 'block', 'off').default('warn'),
        digestPinning: this.joi.boolean().default(false),
        composeFileOnce: this.joi.boolean().default(false),
        mountPrefixFallback: this.joi.boolean().default(false),
      })
      .rename('composefilelabel', 'composeFileLabel', {
        ignoreUndefined: true,
        override: true,
      })
      .rename('reconciliationmode', 'reconciliationMode', {
        ignoreUndefined: true,
        override: true,
      })
      .rename('digestpinning', 'digestPinning', {
        ignoreUndefined: true,
        override: true,
      })
      .rename('composefileonce', 'composeFileOnce', {
        ignoreUndefined: true,
        override: true,
      })
      .rename('mountprefixfallback', 'mountPrefixFallback', {
        ignoreUndefined: true,
        override: true,
      });
  }

  async initTrigger() {
    // Force mode=batch to avoid docker-compose concurrent operations
    this.configuration.mode = 'batch';

    // Check default docker-compose file exists if specified
    if (this.configuration.file) {
      try {
        await fs.access(this.configuration.file);
      } catch (e: unknown) {
        const reason =
          getErrorCode(e) === 'EACCES'
            ? `permission denied (${ROOT_MODE_BREAK_GLASS_HINT})`
            : 'does not exist';
        this.log.error(`The default file ${this.configuration.file} ${reason}`);
        throw e;
      }
    }
  }

  parseHostToContainerBindMount(bindDefinition: string): HostToContainerBindMount | null {
    return parseHostContainerBindMount(bindDefinition);
  }

  getSelfContainerIdentifier(): string | null {
    return getRuntimeSelfContainerIdentifier();
  }

  protected isHostToContainerBindMountCacheLoaded(): boolean {
    return this._hostToContainerBindMountsLoaded;
  }

  protected getHostToContainerBindMountCache(): HostToContainerBindMount[] {
    return [...this._hostToContainerBindMounts];
  }

  protected setHostToContainerBindMountCache(bindMounts: HostToContainerBindMount[]): void {
    this._hostToContainerBindMounts = [...bindMounts];
  }

  protected resetHostToContainerBindMountCache(): void {
    this._hostToContainerBindMountsLoaded = false;
    this._hostToContainerBindMountsLoadPromise = null;
    this._hostToContainerBindMounts = [];
  }

  async ensureHostToContainerBindMountsLoaded(container: ComposeContainerReference): Promise<void> {
    if (this._hostToContainerBindMountsLoadPromise) {
      await this._hostToContainerBindMountsLoadPromise;
      return;
    }

    if (this._hostToContainerBindMountsLoaded) {
      return;
    }

    this._hostToContainerBindMountsLoadPromise = (async () => {
      const selfContainerIdentifier = this.getSelfContainerIdentifier();
      if (!selfContainerIdentifier) {
        this._hostToContainerBindMountsLoaded = true;
        return;
      }

      const watcher = this.getWatcher(container);
      const dockerApi = getDockerApiFromWatcher(watcher);
      if (!dockerApi) {
        return;
      }

      this._hostToContainerBindMountsLoaded = true;
      try {
        this._hostToContainerBindMounts = await getSelfContainerBindMounts(
          dockerApi,
          selfContainerIdentifier,
        );
      } catch (e: unknown) {
        this.log.debug(
          `Unable to inspect bind mounts for compose host-path remapping (${getErrorMessage(e)})`,
        );
      }
    })();

    try {
      await this._hostToContainerBindMountsLoadPromise;
    } finally {
      this._hostToContainerBindMountsLoadPromise = null;
    }
  }

  mapComposePathToContainerBindMount(composeFilePath: string): string {
    return mapComposePathThroughBindMounts(composeFilePath, this._hostToContainerBindMounts);
  }

  resolveComposeFilePath(
    composeFilePathToResolve: string,
    options: {
      enforceWorkingDirectoryBoundary?: boolean;
      label?: string;
    } = {},
  ) {
    const { enforceWorkingDirectoryBoundary = false, label = 'Compose file path' } = options;
    const composeFilePath = resolveConfiguredPath(composeFilePathToResolve, {
      label,
    });

    if (!enforceWorkingDirectoryBoundary) {
      return composeFilePath;
    }

    // Absolute compose paths are explicit operator configuration and are valid.
    // Boundary enforcement is only applied to relative paths to prevent traversal.
    if (path.isAbsolute(composeFilePathToResolve.trim())) {
      return composeFilePath;
    }

    return resolveConfiguredPathWithinBase(
      process.cwd(),
      path.relative(process.cwd(), composeFilePath),
      {
        label,
      },
    );
  }

  /**
   * Get the compose file path for a specific container.
   * First checks for a label, then falls back to default configuration.
   * @param container
   * @returns {string|null}
   */
  getConfiguredComposeFilesForContainer(
    container: ComposeContainerReference,
    options: { includeDefaultComposeFile?: boolean } = {},
  ): string[] {
    const { includeDefaultComposeFile = true } = options;
    const composeFileFromLegacyLabel = this.getComposeFileFromLegacyLabel(container);
    if (composeFileFromLegacyLabel) {
      return [composeFileFromLegacyLabel];
    }

    const composeFilesFromComposeLabels = this.getComposeFilesFromProjectLabels(
      container.labels,
      container.name,
    );
    if (composeFilesFromComposeLabels.length > 0) {
      return composeFilesFromComposeLabels;
    }

    if (!includeDefaultComposeFile) {
      return [];
    }
    const composeFileFromDefault = this.getDefaultComposeFilePath();
    if (composeFileFromDefault) {
      return [composeFileFromDefault];
    }
    return [];
  }

  getComposeFileForContainer(container: ComposeContainerReference): string | null {
    const composeFiles = this.getConfiguredComposeFilesForContainer(container);
    if (composeFiles.length > 0) {
      return composeFiles[0];
    }

    const composeFileLabel = this.configuration.composeFileLabel;
    if (!this.configuration.file) {
      return null;
    }
    this.log.warn(
      `No compose file found for container ${container.name} (no label '${composeFileLabel}' or '${COMPOSE_PROJECT_CONFIG_FILES_LABEL}' and no default file configured)`,
    );
    return null;
  }

  getComposeFileFromLegacyLabel(container: ComposeContainerReference): string | null {
    const composeFileLabel = this.configuration.composeFileLabel;
    const labelValue = container.labels?.[composeFileLabel];
    if (labelValue) {
      try {
        return this.resolveComposeFilePath(labelValue, {
          label: `Compose file label ${composeFileLabel}`,
        });
      } catch (e: unknown) {
        this.log.warn(
          `Compose file label ${composeFileLabel} on container ${container.name} is invalid (${getErrorMessage(e)})`,
        );
        return null;
      }
    }
    return null;
  }

  getDefaultComposeFilePath(): string | null {
    if (!this.configuration.file) {
      return null;
    }
    try {
      return this.resolveComposeFilePath(this.configuration.file, {
        label: 'Default compose file path',
      });
    } catch (e: unknown) {
      this.log.warn(`Default compose file path is invalid (${getErrorMessage(e)})`);
      return null;
    }
  }

  getComposeFilesFromProjectLabels(
    labels: Record<string, string> | undefined,
    containerName: string | undefined,
  ): string[] {
    const composeProjectFilesLabel = labels?.[COMPOSE_PROJECT_CONFIG_FILES_LABEL];
    if (!composeProjectFilesLabel) {
      return [];
    }
    const composeWorkingDirectoryRaw = labels?.[COMPOSE_PROJECT_WORKING_DIR_LABEL];
    let composeWorkingDirectory: string | null = null;
    if (composeWorkingDirectoryRaw) {
      try {
        composeWorkingDirectory = resolveConfiguredPath(composeWorkingDirectoryRaw, {
          label: `Compose file label ${COMPOSE_PROJECT_WORKING_DIR_LABEL}`,
        });
      } catch (e: unknown) {
        this.log.warn(
          `Compose file label ${COMPOSE_PROJECT_WORKING_DIR_LABEL} on container ${containerName} is invalid (${getErrorMessage(e)})`,
        );
      }
    }

    const composeFiles = new Set<string>();
    composeProjectFilesLabel
      .split(',')
      .map((composeFilePath) => composeFilePath.trim())
      .filter((composeFilePath) => composeFilePath.length > 0)
      .forEach((composeFilePathRaw) => {
        const composeFilePath = composeWorkingDirectory
          ? path.resolve(composeWorkingDirectory, composeFilePathRaw)
          : composeFilePathRaw;
        try {
          const resolvedComposeFilePath = this.resolveComposeFilePath(composeFilePath, {
            label: `Compose file label ${COMPOSE_PROJECT_CONFIG_FILES_LABEL}`,
          });
          composeFiles.add(this.mapComposePathToContainerBindMount(resolvedComposeFilePath));
        } catch (e: unknown) {
          this.log.warn(
            `Compose file label ${COMPOSE_PROJECT_CONFIG_FILES_LABEL} on container ${containerName} is invalid (${getErrorMessage(e)})`,
          );
        }
      });

    return [...composeFiles];
  }

  normalizeComposeFileChain(
    composeFile: string | null | undefined,
    composeFiles: string[] | null | undefined,
  ): string[] {
    const composeFileChain =
      Array.isArray(composeFiles) && composeFiles.length > 0
        ? composeFiles
        : composeFile
          ? [composeFile]
          : [];
    const uniqueComposeFiles = new Set<string>();
    composeFileChain.forEach((composeFilePath) => {
      if (composeFilePath) {
        uniqueComposeFiles.add(composeFilePath);
      }
    });
    return [...uniqueComposeFiles];
  }

  getComposeFilesForContainer(container: ComposeContainerReference): string[] {
    return this.getConfiguredComposeFilesForContainer(container);
  }

  async getComposeFilesFromInspect(container: ComposeContainerReference): Promise<string[]> {
    const watcher = this.getWatcher(container);
    const dockerApi = getDockerApiFromWatcher(watcher);
    if (!dockerApi) {
      return [];
    }

    try {
      const inspectedContainer = await dockerApi.getContainer(container.name).inspect();
      return this.getComposeFilesFromProjectLabels(
        inspectedContainer?.Config?.Labels,
        container.name,
      );
    } catch (e: unknown) {
      this.log.warn(
        `Unable to inspect compose labels for container ${container.name}; falling back to default compose file resolution (${getErrorMessage(e)})`,
      );
      return [];
    }
  }

  async resolveComposeFilesForContainer(container: ComposeContainerReference): Promise<string[]> {
    await this.ensureHostToContainerBindMountsLoaded(container);

    const composeFilesFromConfiguration = this.getConfiguredComposeFilesForContainer(container, {
      includeDefaultComposeFile: false,
    });
    if (composeFilesFromConfiguration.length > 0) {
      return composeFilesFromConfiguration;
    }

    const composeFilesFromInspect = await this.getComposeFilesFromInspect(container);
    if (composeFilesFromInspect.length > 0) {
      return composeFilesFromInspect;
    }

    const composeFileFromDefault = await this.resolveDefaultComposeFilePathForRuntime();
    if (!composeFileFromDefault) {
      return [];
    }
    return [composeFileFromDefault];
  }

  async resolveComposeFilePathFromDirectory(composePath: string): Promise<string | null> {
    try {
      const composePathStat = await fs.stat(composePath);
      if (!composePathStat.isDirectory()) {
        return composePath;
      }
    } catch {
      // Keep existing behavior for missing/inaccessible files; downstream checks
      // emit detailed does-not-exist/permission warnings.
      return composePath;
    }

    for (const composeFileCandidate of COMPOSE_DIRECTORY_FILE_CANDIDATES) {
      const composeFileCandidatePath = path.join(composePath, composeFileCandidate);
      try {
        await fs.access(composeFileCandidatePath);
        return composeFileCandidatePath;
      } catch {
        // try next candidate
      }
    }

    this.log.warn(
      `Configured compose path ${composePath} is a directory and does not contain a compose file candidate (${COMPOSE_DIRECTORY_FILE_CANDIDATES.join(', ')})`,
    );
    return null;
  }

  async resolveDefaultComposeFilePathForRuntime(): Promise<string | null> {
    const composeFileFromDefault = this.getDefaultComposeFilePath();
    if (!composeFileFromDefault) {
      return null;
    }
    return this.resolveComposeFilePathFromDirectory(composeFileFromDefault);
  }

  normalizeDigestPinningValue(value: unknown): string | null {
    if (!value || typeof value !== 'string') {
      return null;
    }
    const normalizedValue = value.trim();
    if (!normalizedValue) {
      return null;
    }
    if (/^sha256:[A-Fa-f0-9]+$/.test(normalizedValue)) {
      return normalizedValue;
    }
    if (/^[A-Fa-f0-9]+$/.test(normalizedValue)) {
      return `sha256:${normalizedValue}`;
    }
    return null;
  }

  getImageNameFromReference(imageReference: string | null | undefined): string | null | undefined {
    if (!imageReference || typeof imageReference !== 'string') {
      return imageReference;
    }
    const referenceWithoutDigest = imageReference.split('@')[0];
    const lastSlashIndex = referenceWithoutDigest.lastIndexOf('/');
    const lastColonIndex = referenceWithoutDigest.lastIndexOf(':');
    if (lastColonIndex > lastSlashIndex) {
      return referenceWithoutDigest.slice(0, lastColonIndex);
    }
    return referenceWithoutDigest;
  }

  getComposeMutationImageReference(
    container: RuntimeUpdateContainerReference,
    runtimeUpdateImage: string,
    currentComposeImage?: string,
  ): string {
    let composeMutationReference = runtimeUpdateImage;
    if (this.configuration.digestPinning === true) {
      const digestPinningCandidate =
        container?.result?.digest ||
        (container?.updateKind?.kind === 'digest' ? container?.updateKind?.remoteValue : undefined);
      const digestToPin = this.normalizeDigestPinningValue(digestPinningCandidate);
      if (digestToPin) {
        const imageName = this.getImageNameFromReference(runtimeUpdateImage);
        if (imageName) {
          composeMutationReference = `${imageName}@${digestToPin}`;
        }
      }
    }
    return preserveExplicitDockerIoPrefix(currentComposeImage, composeMutationReference);
  }

  getContainerRuntimeImageReference(container: RegistryImageContainerReference): string {
    const registry = getState().registry[container.image.registry.name];
    return registry.getImageFullName(container.image as ContainerImage, container.image.tag.value);
  }

  /**
   * Refuse to touch a service whose compose `image:` names a different
   * repository than the container is actually running. `getServiceKey` resolves
   * the service from the `com.docker.compose.service` label without comparing
   * images, so a container carrying a label for a service it is not an instance
   * of would otherwise have that service's `image:` rewritten to its own
   * repository. Runs in every `reconciliationMode`, `off` included, because a
   * repository mismatch is not drift to reconcile: the container is not that
   * service. Tag-only drift keeps its warn/block/off behaviour below.
   * @param composeFileChainSummary
   * @param versionMappings
   */
  assertComposeRepositoryContinuity(composeFileChainSummary, versionMappings) {
    for (const mapping of versionMappings) {
      const currentImage =
        mapping.currentResolved ?? resolveComposeImageForContinuity(mapping.current);
      if (composeImageRepositoryMatchesRuntime(currentImage, mapping.runtimeImage)) {
        continue;
      }
      throw new Error(
        `Compose service ${mapping.service} in ${composeFileChainSummary} declares image ` +
          `${mapping.current} but container ${mapping.container?.name} runs ${mapping.runtimeImage}; ` +
          'refusing to rewrite a different repository',
      );
    }
  }

  async assertComposeRepositoryContinuityFromFreshChain(
    composeFileChain,
    composeFilePath,
    composeFileText,
    mappings,
  ) {
    const composeByFile = new Map<string, unknown>();
    composeByFile.set(
      composeFilePath,
      yaml.parse(composeFileText, {
        maxAliasCount: YAML_MAX_ALIAS_COUNT,
      }),
    );
    for (const composeFile of composeFileChain) {
      if (composeFile !== composeFilePath) {
        composeByFile.set(
          composeFile,
          yaml.parse((await this.getComposeFile(composeFile)).toString(), {
            maxAliasCount: YAML_MAX_ALIAS_COUNT,
          }),
        );
      }
    }
    const compose = await this.getComposeFileChainAsObject(composeFileChain, composeByFile);
    const resolvedComposeImages = await this.getComposeResolvedImages(composeFileChain, compose);
    this.assertComposeRepositoryContinuity(
      composeFileChain.join(', '),
      mappings.map((mapping) => ({
        ...mapping,
        current: isPlainObject(compose?.services?.[mapping.service])
          ? (compose.services[mapping.service] as { image?: unknown }).image
          : undefined,
        currentResolved: resolveComposeImageForContinuity(
          isPlainObject(compose?.services?.[mapping.service])
            ? (compose.services[mapping.service] as { image?: unknown }).image
            : undefined,
          resolvedComposeImages.get(mapping.service),
        ),
      })),
    );
  }

  reconcileComposeMappings(composeFileChainSummary, versionMappings) {
    this.assertComposeRepositoryContinuity(composeFileChainSummary, versionMappings);
    const reconciliationMode = this.configuration.reconciliationMode || 'warn';
    if (reconciliationMode === 'off') {
      return;
    }
    for (const mapping of versionMappings) {
      const currentImage =
        mapping.currentResolved ?? resolveComposeImageForContinuity(mapping.current);
      if (typeof currentImage === 'string' && currentImage.includes('${')) {
        continue;
      }
      const currentResolvedNormalized = normalizeImplicitLatest(currentImage);
      if (mapping.runtimeNormalized === currentResolvedNormalized) {
        continue;
      }
      const reconciliationMessage =
        `Compose reconciliation mismatch for ${composeFileChainSummary} service ${mapping.service}: ` +
        `runtime=${mapping.runtimeImage} compose=${mapping.current}`;
      if (reconciliationMode === 'block') {
        throw new Error(
          `${reconciliationMessage} (blocking update because reconciliationMode=block)`,
        );
      }
      this.log.warn(`${reconciliationMessage} (continuing because reconciliationMode=warn)`);
    }
  }

  buildComposeServiceImageUpdates(mappingsNeedingComposeUpdate) {
    const serviceImageUpdates = new Map<string, string>();
    mappingsNeedingComposeUpdate.forEach(({ service, update, composeUpdate }) => {
      const updateImage = composeUpdate ?? update;
      const existingUpdate = serviceImageUpdates.get(service);
      if (existingUpdate !== undefined && existingUpdate !== updateImage) {
        throw new Error(
          `Conflicting compose image updates for service ${service} (${existingUpdate} vs ${updateImage})`,
        );
      }
      serviceImageUpdates.set(service, updateImage);
    });
    return serviceImageUpdates;
  }

  buildUpdatedComposeFileObjectForValidation(composeFileObject, serviceImageUpdates) {
    if (!isPlainObject(composeFileObject)) {
      return undefined;
    }

    const composeFileRecord = composeFileObject;
    const existingServices = composeFileRecord.services;
    const servicesRecord = isPlainObject(existingServices) ? existingServices : {};
    const updatedServices = { ...servicesRecord };

    for (const [serviceName, newImage] of serviceImageUpdates.entries()) {
      const serviceDefinition = updatedServices[serviceName];
      if (isPlainObject(serviceDefinition)) {
        updatedServices[serviceName] = {
          ...serviceDefinition,
          image: newImage,
        };
        continue;
      }
      updatedServices[serviceName] = {
        image: newImage,
      };
    }

    return {
      ...composeFileRecord,
      services: updatedServices,
    };
  }

  async getComposeFileChainAsObject(composeFiles, composeByFile = null) {
    const mergedCompose = {
      services: {},
    } as {
      services: Record<string, unknown>;
    };

    for (const composeFile of composeFiles) {
      const compose =
        composeByFile?.get(composeFile) || (await this.getComposeFileAsObject(composeFile));
      if (!compose?.services || typeof compose.services !== 'object') {
        continue;
      }
      Object.entries(compose.services).forEach(([serviceName, serviceDefinition]) => {
        const existingServiceDefinition = mergedCompose.services[serviceName];
        if (isPlainObject(existingServiceDefinition) && isPlainObject(serviceDefinition)) {
          mergedCompose.services[serviceName] = {
            ...existingServiceDefinition,
            ...serviceDefinition,
          };
          return;
        }
        mergedCompose.services[serviceName] = serviceDefinition;
      });
    }

    return mergedCompose;
  }

  async getWritableComposeFileForService(composeFiles, service, composeByFile = null) {
    if (!Array.isArray(composeFiles) || composeFiles.length === 0) {
      throw new Error(
        `Cannot resolve writable compose file for service ${service} because compose file chain is empty`,
      );
    }
    const filesContainingService = [];
    for (const composeFile of composeFiles) {
      const compose =
        composeByFile?.get(composeFile) || (await this.getComposeFileAsObject(composeFile));
      const composeServices = (compose as { services?: Record<string, unknown> } | null | undefined)
        ?.services;
      if (composeServices && composeServices[service] !== undefined) {
        filesContainingService.push(composeFile);
      }
    }
    const candidateFiles =
      filesContainingService.length > 0 ? [...filesContainingService].reverse() : [composeFiles[0]];
    let lastAccessError: unknown;
    for (const candidateFile of candidateFiles) {
      try {
        await fs.access(candidateFile, fsConstants.W_OK);
        return candidateFile;
      } catch (e: unknown) {
        lastAccessError = e;
      }
    }
    throw lastAccessError;
  }

  async groupComposeUpdatesByWritableFile(
    composeFiles,
    mappingsNeedingComposeUpdate,
    composeByFile = null,
  ) {
    const mappingsByComposeFile = new Map<string, unknown[]>();
    for (const mapping of mappingsNeedingComposeUpdate) {
      const composeFile = await this.getWritableComposeFileForService(
        composeFiles,
        mapping.service,
        composeByFile,
      );
      if (!mappingsByComposeFile.has(composeFile)) {
        mappingsByComposeFile.set(composeFile, []);
      }
      mappingsByComposeFile.get(composeFile)!.push(mapping);
    }
    return mappingsByComposeFile;
  }

  async maybeReleaseStaleComposeFileLock(lockFilePath) {
    return this._composeFileLockManager.maybeReleaseStaleComposeFileLock(lockFilePath);
  }

  async waitForComposeFileLockChange(lockFilePath, timeoutMs) {
    return this._composeFileLockManager.waitForComposeFileLockChange(lockFilePath, timeoutMs);
  }

  async withComposeFileLock(file, operation) {
    return this._composeFileLockManager.withComposeFileLock(file, operation);
  }

  async tryRenameComposeFile(temporaryFilePath, filePath) {
    try {
      await fs.rename(temporaryFilePath, filePath);
      return undefined;
    } catch (error: unknown) {
      return error;
    }
  }

  async handleBusyComposeRenameRetry(error, filePath, attempt) {
    if (getErrorCode(error) !== 'EBUSY' || attempt >= COMPOSE_RENAME_MAX_RETRIES) {
      return false;
    }
    this.log.warn(
      `Compose file ${filePath} is busy (EBUSY); retry ${attempt + 1}/${COMPOSE_RENAME_MAX_RETRIES}`,
    );
    await sleep(COMPOSE_RENAME_RETRY_MS);
    return true;
  }

  async cleanupComposeTemporaryFile(temporaryFilePath) {
    try {
      await fs.unlink(temporaryFilePath);
    } catch {
      // best-effort temp cleanup
    }
  }

  async handleBusyComposeRenameFallback(error, filePath, data, temporaryFilePath) {
    if (getErrorCode(error) !== 'EBUSY') {
      return false;
    }
    this.log.warn(
      `Atomic rename to ${filePath} failed after ${COMPOSE_RENAME_MAX_RETRIES} retries; falling back to direct write`,
    );
    try {
      await fs.writeFile(filePath, data);
    } finally {
      await this.cleanupComposeTemporaryFile(temporaryFilePath);
    }
    return true;
  }

  async writeComposeFileAtomic(filePath, data) {
    const composeDirectory = path.dirname(filePath);
    const composeFileName = path.basename(filePath);
    const temporaryFilePath = path.join(
      composeDirectory,
      `.${composeFileName}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    await fs.writeFile(temporaryFilePath, data);
    for (let attempt = 0; ; attempt++) {
      const renameError = await this.tryRenameComposeFile(temporaryFilePath, filePath);
      if (!renameError) {
        return;
      }
      if (await this.handleBusyComposeRenameRetry(renameError, filePath, attempt)) {
        continue;
      }
      // Rename exhausted or non-EBUSY — fall back to direct overwrite so
      // the update is not lost.  This sacrifices crash-atomicity but
      // guarantees the compose file is written (common on Docker bind
      // mounts where rename can fail persistently with EBUSY).
      if (
        await this.handleBusyComposeRenameFallback(renameError, filePath, data, temporaryFilePath)
      ) {
        return;
      }
      await this.cleanupComposeTemporaryFile(temporaryFilePath);
      throw renameError;
    }
  }

  async validateComposeConfiguration(
    composeFilePath,
    composeFileText,
    options: ValidateComposeConfigurationOptions = {},
  ) {
    const composeFileChain = this.normalizeComposeFileChain(composeFilePath, options.composeFiles);
    const effectiveComposeFileChain = composeFileChain.includes(composeFilePath)
      ? composeFileChain
      : [...composeFileChain, composeFilePath];
    try {
      const composeByFile = new Map<string, unknown>();
      for (const composeFile of effectiveComposeFileChain) {
        if (composeFile === composeFilePath) {
          if (options.parsedComposeFileObject !== undefined) {
            composeByFile.set(composeFile, options.parsedComposeFileObject);
          } else {
            composeByFile.set(
              composeFile,
              yaml.parse(composeFileText, {
                maxAliasCount: YAML_MAX_ALIAS_COUNT,
              }),
            );
          }
          continue;
        }
        composeByFile.set(composeFile, await this.getComposeFileAsObject(composeFile));
      }
      await this.getComposeFileChainAsObject(effectiveComposeFileChain, composeByFile);
    } catch (e: unknown) {
      throw new Error(
        `Error when validating compose configuration for ${composeFilePath} (${getErrorMessage(e)})`,
      );
    }
  }

  async mutateComposeFile(file, updateComposeText, options: MutateComposeFileOptions = {}) {
    return this.withComposeFileLock(file, async (filePath) => {
      const composeFileText = (await this.getComposeFile(filePath)).toString();
      const composeFileStat = await fs.stat(filePath);
      const composeFileChain = this.normalizeComposeFileChain(filePath, options.composeFiles);
      if (options.validateCurrentState) {
        await options.validateCurrentState(composeFileText, filePath, composeFileChain);
      }
      if (options.backupFilePath) {
        await this.backup(filePath, options.backupFilePath);
      }
      const updatedComposeFileText = updateComposeText(composeFileText, {
        filePath,
        mtimeMs: composeFileStat.mtimeMs,
      });
      if (updatedComposeFileText === composeFileText) {
        return false;
      }
      const validationOptions: ValidateComposeConfigurationOptions = {};
      if (composeFileChain.length > 1) {
        validationOptions.composeFiles = composeFileChain;
      }
      if (options.parsedComposeFileObject !== undefined) {
        validationOptions.parsedComposeFileObject = options.parsedComposeFileObject;
      }
      if (Object.keys(validationOptions).length === 0) {
        await this.validateComposeConfiguration(filePath, updatedComposeFileText);
      } else {
        await this.validateComposeConfiguration(
          filePath,
          updatedComposeFileText,
          validationOptions,
        );
      }
      await this.writeComposeFile(filePath, updatedComposeFileText);
      if (options.captureSnapshot) {
        return {
          filePath,
          originalText: composeFileText,
        };
      }
      return true;
    });
  }

  /**
   * Override: provide shared runtime dependencies once per lifecycle run.
   * Runtime container state is still resolved on demand per service refresh.
   */
  async createTriggerContext(
    container,
    logContainer,
    composeContext?: ComposeUpdateLifecycleContext,
  ) {
    const runtimeContext = composeContext?.runtimeContext;
    if (
      runtimeContext?.dockerApi &&
      runtimeContext?.registry &&
      runtimeContext?.auth !== undefined &&
      runtimeContext?.newImage
    ) {
      return {
        dockerApi: runtimeContext.dockerApi,
        registry: runtimeContext.registry,
        auth: runtimeContext.auth,
        newImage: runtimeContext.newImage,
        deferSignatureVerification: true,
        // The compose runtime update runs its gate from several call sites and
        // skips the hook entirely once the compose-file-once preflight has
        // gated, so it keeps the original ordering rather than hanging the
        // pre-update hook and prune/backup off that hook.
        deferPreRuntimeUpdateLifecycle: false,
        currentContainer: null,
        currentContainerSpec: null,
      };
    }

    const watcher = this.getWatcher(container);
    const { dockerApi } = watcher;
    const registry = getState().registry[container.image.registry.name];
    const auth = await registry.getAuthPull();
    const newImage = this.getNewImageFullName(registry, container);
    return {
      dockerApi,
      registry,
      auth,
      newImage,
      deferSignatureVerification: true,
      deferPreRuntimeUpdateLifecycle: false,
      currentContainer: null,
      currentContainerSpec: null,
    };
  }

  /**
   * Override: apply compose-specific hooks while performing runtime refresh
   * through the Docker Engine API.
   */
  requireComposeUpdateContext(
    container: { name?: string },
    composeCtx?: ComposeUpdateLifecycleContext,
  ): ComposeUpdateLifecycleContext {
    if (composeCtx) {
      return composeCtx;
    }
    throw new Error(`Missing compose context for container ${container.name}`);
  }

  buildComposeRuntimeContext(
    context: ComposeRuntimeContext | undefined,
    composeCtx: ComposeUpdateLifecycleContext,
  ): ComposeRuntimeContext {
    const runtimeContext: ComposeRuntimeContext = {};

    if (context?.dockerApi !== undefined) {
      runtimeContext.dockerApi = context.dockerApi;
    }
    if (context?.auth !== undefined) {
      runtimeContext.auth = context.auth;
    }
    if (context?.newImage !== undefined) {
      runtimeContext.newImage = context.newImage;
    }
    if (context?.imageIdentity !== undefined) {
      runtimeContext.imageIdentity = context.imageIdentity;
    }
    if (context?.operationId !== undefined) {
      runtimeContext.operationId = context.operationId;
    }
    if (context?.registry !== undefined) {
      runtimeContext.registry = context.registry;
    }

    if (composeCtx.runtimeContext) {
      Object.assign(runtimeContext, composeCtx.runtimeContext);
    }

    return runtimeContext;
  }

  async maybeRunPerServiceComposeRefresh(
    composeCtx: ComposeUpdateLifecycleContext,
    container,
    composeUpdateOptions: Pick<
      ComposeRuntimeRefreshOptions,
      'composeFiles' | 'skipPull' | 'runtimeContext' | 'postPullHook'
    >,
  ): Promise<boolean> {
    if (composeCtx.composeFileOnceApplied === true) {
      const logContainer = this.log.child({
        container: container.name,
      });
      logContainer.info(
        `Skip per-service compose refresh for ${composeCtx.service} because compose-file-once mode already refreshed ${composeCtx.composeFile}`,
      );
      return false;
    }

    await this.updateContainerWithCompose(
      composeCtx.composeFile,
      composeCtx.service,
      container,
      composeUpdateOptions,
    );
    return true;
  }

  /**
   * Compose updates mutate project-level state (compose file rewrites,
   * `docker compose up` orchestration), so two services in the same project
   * cannot recreate concurrently. Add a per-project lock on top of the
   * per-container lock from the Docker base class.
   */
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

  async performContainerUpdate(
    context,
    container,
    _logContainer,
    composeCtx?: ComposeUpdateLifecycleContext,
    postPullHook?: (operationId: string, imageIdentity?: string) => Promise<void>,
  ) {
    const requiredComposeCtx = this.requireComposeUpdateContext(container, composeCtx);
    const runtimeContext = this.buildComposeRuntimeContext(context, requiredComposeCtx);
    const composeUpdateOptions = this.buildPerformContainerUpdateOptions(
      requiredComposeCtx,
      runtimeContext,
      requiredComposeCtx.postPullGateCompleted ? undefined : postPullHook,
    );

    const composeRefreshRan = await this.maybeRunPerServiceComposeRefresh(
      requiredComposeCtx,
      container,
      composeUpdateOptions,
    );
    if (!composeRefreshRan && !requiredComposeCtx.postPullGateCompleted && postPullHook) {
      const operationId = getRequestedOperationId(container, runtimeContext) ?? '';
      if (runtimeContext.imageIdentity) {
        await postPullHook(operationId, runtimeContext.imageIdentity);
      } else {
        await postPullHook(operationId);
      }
    }
    if (!this.configuration.dryrun) {
      requiredComposeCtx.onRuntimeUpdateApplied?.();
    }

    await this.runServicePostStartHooks(
      container,
      requiredComposeCtx.service,
      requiredComposeCtx.serviceDefinition,
    );

    return !this.configuration.dryrun;
  }

  buildPerformContainerUpdateOptions(
    composeCtx: ComposeUpdateLifecycleContext,
    runtimeContext: ComposeRuntimeContext,
    postPullHook?: (operationId: string, imageIdentity?: string) => Promise<void>,
  ): Pick<
    ComposeRuntimeRefreshOptions,
    'composeFiles' | 'skipPull' | 'runtimeContext' | 'postPullHook'
  > {
    const composeUpdateOptions = {} as Pick<
      ComposeRuntimeRefreshOptions,
      'composeFiles' | 'skipPull' | 'runtimeContext' | 'postPullHook'
    >;

    if (Array.isArray(composeCtx.composeFiles) && composeCtx.composeFiles.length > 1) {
      composeUpdateOptions.composeFiles = composeCtx.composeFiles;
    }
    if (composeCtx.skipPull === true) {
      composeUpdateOptions.skipPull = true;
    }
    if (hasDefinedComposeRuntimeContextValue(runtimeContext)) {
      composeUpdateOptions.runtimeContext = runtimeContext;
    }
    if (postPullHook) {
      composeUpdateOptions.postPullHook = postPullHook;
    }

    return composeUpdateOptions;
  }

  /**
   * Keep compose dry-run side-effect free: no prune and no backup records.
   */
  async runPreRuntimeUpdateLifecycle(context, container, logContainer, _composeContext) {
    if (this.configuration.dryrun) {
      logContainer.info('Skip prune/backup in compose dry-run mode');
      return;
    }
    await super.runPreRuntimeUpdateLifecycle(context, container, logContainer, _composeContext);
  }

  /**
   * Self-update for compose-managed Drydock service. Delegate to the parent
   * self-update transition so the helper container can enforce startup/health
   * gates and rollback before retiring the old process.
   */
  async executeSelfUpdate(context, container, logContainer, operationId, composeCtx) {
    if (!composeCtx) {
      throw new Error(`Missing compose context for self-update container ${container.name}`);
    }

    if (this.configuration.dryrun) {
      logContainer.warn('Do not replace the existing container because dry-run mode is enabled');
      return false;
    }

    const currentContainer =
      context?.currentContainer ?? (await this.getCurrentContainer(context.dockerApi, container));
    const currentContainerSpec =
      context?.currentContainerSpec ??
      (await this.inspectContainer(currentContainer, logContainer));

    const selfUpdateContext = {
      ...context,
      currentContainer,
      currentContainerSpec,
    };

    return super.executeSelfUpdate(selfUpdateContext, container, logContainer, operationId);
  }

  /**
   * Update the container.
   * @param container the container
   * @returns {Promise<void>}
   */
  async trigger(container, runtimeContext?: unknown) {
    const triggerBatchResults =
      runtimeContext === undefined
        ? await this.triggerBatch([container])
        : await this.triggerBatch([container], runtimeContext);
    const hasRuntimeUpdates = triggerBatchResults.some((result) => result === true);
    /* v8 ignore next -- V8 mis-maps the false branch of this dryrun guard despite direct coverage */
    if (this.configuration.dryrun === true) {
      return;
    }

    if (container?.updateAvailable !== true) {
      return;
    }

    if (hasRuntimeUpdates) {
      return;
    }

    throw new Error(
      `No compose updates were applied for container ${container?.name || 'unknown'}`,
    );
  }

  isContainerEligibleForComposeFileGrouping(container: ComposeContainerReference): boolean {
    const watcher = this.getWatcher(container);
    const dockerApi = getDockerApiFromWatcher(watcher);
    if (dockerApi && dockerApi.modem.socketPath !== '') {
      return true;
    }

    this.log.warn(`Cannot update container ${container.name} because not running on local host`);
    return false;
  }

  async resolveComposeFilesForGrouping(
    container: ComposeContainerReference,
    configuredComposeFilePath: string | null,
  ): Promise<string[] | null> {
    const composeFiles = await this.resolveComposeFilesForContainer(container);
    if (composeFiles.length === 0) {
      this.log.warn(
        `No compose file found for container ${container.name} (no label '${this.configuration.composeFileLabel}' or '${COMPOSE_PROJECT_CONFIG_FILES_LABEL}' and no default file configured)`,
      );
      return null;
    }

    if (configuredComposeFilePath && !composeFiles.includes(configuredComposeFilePath)) {
      if (this.configuration.mountPrefixFallback) {
        const configuredTail = path.join(
          path.basename(path.dirname(configuredComposeFilePath)),
          path.basename(configuredComposeFilePath),
        );
        const tailMatch = composeFiles.some(
          (f) => path.join(path.basename(path.dirname(f)), path.basename(f)) === configuredTail,
        );
        if (tailMatch) {
          this.log.warn(
            `Container ${container.name} compose file path differs by mount prefix; using configured path ${configuredComposeFilePath} instead of label path(s) ${composeFiles.join(', ')} (issue #365 fallback)`,
          );
          return [configuredComposeFilePath];
        }
      }
      this.log.warn(
        `Skip container ${container.name} because compose files ${composeFiles.join(', ')} do not match configured file ${configuredComposeFilePath}`,
      );
      return null;
    }

    return composeFiles;
  }

  async getComposeFileAccessError(
    composeFile: string,
    composeFileAccessErrorByPath: Map<string, string | null>,
  ): Promise<string | null> {
    if (composeFileAccessErrorByPath.has(composeFile)) {
      return composeFileAccessErrorByPath.get(composeFile) ?? null;
    }

    try {
      await fs.access(composeFile);
      composeFileAccessErrorByPath.set(composeFile, null);
      return null;
    } catch (e: unknown) {
      const reason =
        getErrorCode(e) === 'EACCES'
          ? `permission denied (${ROOT_MODE_BREAK_GLASS_HINT})`
          : 'does not exist';
      composeFileAccessErrorByPath.set(composeFile, reason);
      return reason;
    }
  }

  async findMissingComposeFileForContainer(
    composeFiles: string[],
    composeFileAccessErrorByPath: Map<string, string | null>,
  ): Promise<{ file: string; reason: string } | null> {
    for (const composeFile of composeFiles) {
      const composeFileAccessError = await this.getComposeFileAccessError(
        composeFile,
        composeFileAccessErrorByPath,
      );
      if (composeFileAccessError) {
        return {
          file: composeFile,
          reason: composeFileAccessError,
        };
      }
    }
    return null;
  }

  addContainerToComposeFileGroup(
    containersByComposeFile: Map<string, ContainersByComposeFileEntry>,
    composeFiles: string[],
    container: ComposeContainerReference,
  ): void {
    const composeFile = composeFiles[0];
    const composeFileKey = composeFiles.join('\n');
    const existingEntry = containersByComposeFile.get(composeFileKey);
    if (existingEntry) {
      existingEntry.containers.push(container);
      return;
    }

    containersByComposeFile.set(composeFileKey, {
      composeFile,
      composeFiles,
      containers: [container],
    });
  }

  async resolveAndGroupContainersByComposeFile(
    containers: ComposeContainerReference[],
    configuredComposeFilePath: string | null,
  ): Promise<Map<string, ContainersByComposeFileEntry>> {
    const containersByComposeFile = new Map<string, ContainersByComposeFileEntry>();
    const composeFileAccessErrorByPath = new Map<string, string | null>();

    for (const container of containers) {
      if (!this.isContainerEligibleForComposeFileGrouping(container)) {
        continue;
      }

      const composeFiles = await this.resolveComposeFilesForGrouping(
        container,
        configuredComposeFilePath,
      );
      if (!composeFiles) {
        continue;
      }

      const missingComposeFile = await this.findMissingComposeFileForContainer(
        composeFiles,
        composeFileAccessErrorByPath,
      );
      if (missingComposeFile) {
        this.log.warn(
          `Compose file ${missingComposeFile.file} for container ${container.name} ${missingComposeFile.reason}`,
        );
        continue;
      }

      this.addContainerToComposeFileGroup(containersByComposeFile, composeFiles, container);
    }

    return containersByComposeFile;
  }

  /**
   * Update the docker-compose stack.
   * @param containers the containers
   * @returns {Promise<boolean[]>}
   */
  async triggerBatch(containers, runtimeContext?: unknown): Promise<boolean[]> {
    const configuredComposeFilePath = await this.resolveDefaultComposeFilePathForRuntime();
    const containersByComposeFile = await this.resolveAndGroupContainersByComposeFile(
      containers,
      configuredComposeFilePath,
    );

    if (containersByComposeFile.size === 0) {
      this.log.warn('No containers matched any compose file for this trigger');
    }

    // Process each compose file group
    const batchResults: boolean[] = [];
    for (const {
      composeFile,
      composeFiles,
      containers: containersInFile,
    } of containersByComposeFile.values()) {
      if (composeFiles.length > 1) {
        batchResults.push(
          runtimeContext === undefined
            ? await this.processComposeFile(composeFile, containersInFile, composeFiles)
            : await this.processComposeFile(
                composeFile,
                containersInFile,
                composeFiles,
                runtimeContext,
              ),
        );
      } else {
        batchResults.push(
          runtimeContext === undefined
            ? await this.processComposeFile(composeFile, containersInFile)
            : await this.processComposeFile(
                composeFile,
                containersInFile,
                undefined,
                runtimeContext,
              ),
        );
      }
    }
    return batchResults;
  }

  private async buildComposeFileOnceRuntimeContextByService(
    mappingsNeedingRuntimeUpdate: ComposeRuntimeUpdateMapping[],
  ): Promise<Map<string, NonNullable<ComposeRuntimeRefreshOptions['runtimeContext']>>> {
    const composeFileOnceRuntimeContextByService = new Map<
      string,
      NonNullable<ComposeRuntimeRefreshOptions['runtimeContext']>
    >();
    const firstContainerByService = new Map<string, ComposeRuntimeUpdateMapping>();
    for (const mapping of mappingsNeedingRuntimeUpdate) {
      if (!firstContainerByService.has(mapping.service)) {
        firstContainerByService.set(mapping.service, mapping);
      }
    }
    for (const [service, mapping] of firstContainerByService.entries()) {
      const runtimeContainer = mapping.container;
      const logContainer = this.log.child({
        container: runtimeContainer.name,
      });
      const watcher = this.getWatcher(runtimeContainer);
      const { dockerApi } = watcher;
      const registry = this.resolveRegistryManager(runtimeContainer, logContainer, {
        allowAnonymousFallback: true,
      });
      const auth = await registry.getAuthPull();
      const newImage = this.getNewImageFullName(registry, runtimeContainer);
      await this.pullImage(dockerApi, auth, newImage, logContainer);
      const identityOutcome = await this.capturePulledImageIdentity(
        dockerApi as DockerApiLike,
        newImage,
        runtimeContainer,
        logContainer,
      );
      composeFileOnceRuntimeContextByService.set(service, {
        dockerApi,
        registry,
        auth,
        newImage,
        ...(identityOutcome.imageIdentity ? { imageIdentity: identityOutcome.imageIdentity } : {}),
        ...(identityOutcome.unboundWarn
          ? {
              securityGateUnboundWarn: true,
              securityGateUnboundReason: identityOutcome.reason,
            }
          : {}),
      });
    }
    return composeFileOnceRuntimeContextByService;
  }

  private async runComposeFileOncePostPullGate(
    container,
    composeContext: ComposeUpdateLifecycleContext,
  ): Promise<void> {
    const logContainer = this.log.child({
      container: container.name,
    });
    const context = await this.createTriggerContext(container, logContainer, composeContext);
    if (!context) {
      throw new Error(
        `Unable to create update context for compose service ${composeContext.service}`,
      );
    }

    const operationId = getRequestedOperationId(container, composeContext.runtimeContext) ?? '';
    if (composeContext.runtimeContext?.securityGateUnboundWarn) {
      this.recordUnboundSecurityWarning(
        container,
        composeContext.runtimeContext.securityGateUnboundReason,
      );
      return;
    }
    const imageIdentity = composeContext.runtimeContext?.imageIdentity;
    const gateContext = imageIdentity ? { ...context, newImage: imageIdentity } : context;
    try {
      await this.verifySignaturePreUpdate(gateContext, container, logContainer);
      await this.scanAndGatePostPull(gateContext, container, logContainer, {
        setPhase: (phase) => {
          if (operationId) {
            updateOperationStore.updateOperation(operationId, { phase });
          }
        },
      });
    } catch (error: unknown) {
      if (operationId) {
        updateOperationStore.markOperationTerminal(operationId, {
          status: 'failed',
          phase: 'failed',
          lastError: getErrorMessage(error),
        });
      }
      throw error;
    }
  }

  private terminalizeComposeFileOncePreflightOperations(
    mappings: ComposeRuntimeUpdateMapping[],
    runtimeContext: Record<string, unknown> | undefined,
    error: unknown,
  ): void {
    const operationIds = new Set<string>();
    for (const { container } of mappings) {
      const operationId = getRequestedOperationId(container, runtimeContext);
      if (operationId) {
        operationIds.add(operationId);
      }
    }
    for (const operationId of operationIds) {
      const operation = updateOperationStore.getOperationById(operationId);
      if (operation?.status === 'queued' || operation?.status === 'in-progress') {
        updateOperationStore.markOperationTerminal(operationId, {
          status: 'failed',
          phase: 'failed',
          lastError: getErrorMessage(error),
        });
      }
    }
  }

  async loadComposeProcessingContext(composeFile, composeFiles = [composeFile]) {
    const composeFileChain = this.normalizeComposeFileChain(composeFile, composeFiles);
    const composeFileChainSummary = composeFileChain.join(', ');
    this.log.info(`Processing compose file: ${composeFileChainSummary}`);
    const composeByFile = new Map<string, unknown>();
    for (const composeFilePath of composeFileChain) {
      composeByFile.set(composeFilePath, await this.getComposeFileAsObject(composeFilePath));
    }
    const compose = await this.getComposeFileChainAsObject(composeFileChain, composeByFile);
    return {
      composeFileChain,
      composeFileChainSummary,
      composeByFile,
      compose,
    };
  }

  filterContainersBelongingToCompose(compose, containers, composeFileChainSummary) {
    return containers.filter((container) => {
      const belongs = doesContainerBelongToCompose(compose, container);
      if (!belongs) {
        this.log.warn(
          `Container ${container.name} not found in compose file ${composeFileChainSummary} (image mismatch)`,
        );
      }
      return belongs;
    });
  }

  async getComposeResolvedImages(composeFiles: string[], compose): Promise<Map<string, string>> {
    const composeServices = compose?.services ?? {};
    const hasInterpolatedImage = Object.values(composeServices).some(
      (service) =>
        isPlainObject(service) && typeof service.image === 'string' && service.image.includes('${'),
    );
    if (!hasInterpolatedImage || composeFiles.length === 0) {
      return new Map();
    }

    const environment: Record<string, string> = {};
    try {
      const projectEnvironmentFile = path.join(path.dirname(composeFiles[0]), '.env');
      const contents = await fs.readFile(projectEnvironmentFile, 'utf8');
      const environmentText =
        typeof contents === 'string'
          ? contents
          : new TextDecoder().decode(contents as unknown as Uint8Array);
      Object.assign(environment, parseComposeEnvironmentFile(environmentText));
    } catch {
      // An unavailable environment source cannot safely establish continuity.
    }

    const resolvedImages = new Map<string, string>();
    for (const [serviceName, service] of Object.entries(composeServices)) {
      if (!isPlainObject(service) || typeof service.image !== 'string') {
        continue;
      }
      const resolvedImage = resolveComposeInterpolation(service.image, environment);
      if (typeof resolvedImage === 'string' && !resolvedImage.includes('${')) {
        resolvedImages.set(serviceName, resolvedImage);
        continue;
      }
      const repositoryPart = getComposeRepositoryPart(service.image);
      const resolvedRepository = resolveComposeInterpolation(repositoryPart, environment);
      if (typeof resolvedRepository === 'string' && !resolvedRepository.includes('${')) {
        resolvedImages.set(
          serviceName,
          resolvedRepository + service.image.slice(repositoryPart.length),
        );
      }
    }
    return resolvedImages;
  }

  buildVersionMappingsForCompose(containersFiltered, compose, resolvedComposeImages = new Map()) {
    return containersFiltered
      .map((container) => {
        const map = this.mapCurrentVersionToUpdateVersion(compose, container);
        if (!map) {
          return undefined;
        }
        const runtimeImage = this.getContainerRuntimeImageReference(container);
        const composeUpdate = this.getComposeMutationImageReference(
          container,
          map.update,
          map.current,
        );
        return {
          container,
          runtimeImage,
          runtimeNormalized: normalizeImplicitLatest(runtimeImage),
          composeUpdate,
          composeUpdateNormalized: normalizeImplicitLatest(composeUpdate),
          currentResolved: resolveComposeImageForContinuity(
            map.current,
            resolvedComposeImages.get(map.service),
          ),
          ...map,
        };
      })
      .filter((entry) => entry !== undefined);
  }

  splitComposeAndRuntimeMappings(versionMappings) {
    const mappingsNeedingComposeUpdate = versionMappings.filter(
      ({ currentNormalized, composeUpdateNormalized }) =>
        currentNormalized !== composeUpdateNormalized,
    );
    const mappingsNeedingRuntimeUpdate = versionMappings.filter(
      ({ container, currentNormalized, updateNormalized }) =>
        container.updateAvailable === true ||
        container.updateKind?.kind === 'digest' ||
        currentNormalized !== updateNormalized,
    );
    return {
      mappingsNeedingComposeUpdate,
      mappingsNeedingRuntimeUpdate,
    };
  }

  logAllComposeContainersUpToDate(composeFileChainSummary, versionMappings): void {
    this.log.info(
      `All containers in ${composeFileChainSummary} are already up to date (checked: ${versionMappings.map((m) => m.container.name).join(', ') || 'none'})`,
    );
  }

  async applyComposeFileMutationsByWritableFile(
    writableComposeFile,
    composeUpdates,
    composeFileChain,
    composeByFile,
  ): Promise<ComposeFileMutationSnapshot | undefined> {
    // Replace only the targeted compose service image values.
    const serviceImageUpdates = this.buildComposeServiceImageUpdates(composeUpdates);
    const parsedComposeFileObject = this.buildUpdatedComposeFileObjectForValidation(
      composeByFile.get(writableComposeFile),
      serviceImageUpdates,
    );
    const mutationResult = await this.mutateComposeFile(
      writableComposeFile,
      (composeFileText, composeFileMetadata) =>
        updateComposeServiceImagesInText(
          composeFileText,
          serviceImageUpdates,
          this.getCachedComposeDocument(
            composeFileMetadata.filePath,
            composeFileMetadata.mtimeMs,
            composeFileText,
          ),
        ),
      {
        composeFiles: composeFileChain,
        parsedComposeFileObject,
        captureSnapshot: true,
        backupFilePath: this.configuration.backup ? `${writableComposeFile}.back` : undefined,
        validateCurrentState: (composeFileText, filePath, currentComposeFileChain) =>
          this.assertComposeRepositoryContinuityFromFreshChain(
            currentComposeFileChain,
            filePath,
            composeFileText,
            composeUpdates,
          ),
      },
    );
    return isPlainObject(mutationResult) &&
      typeof mutationResult.filePath === 'string' &&
      typeof mutationResult.originalText === 'string'
      ? (mutationResult as ComposeFileMutationSnapshot)
      : undefined;
  }

  async maybeApplyComposeFileMutations(
    composeFileChain,
    composeByFile,
    composeFileChainSummary,
    mappingsNeedingComposeUpdate,
  ): Promise<ComposeFileMutationSnapshot[]> {
    if (mappingsNeedingComposeUpdate.length === 0) {
      return [];
    }

    if (this.configuration.dryrun) {
      this.log.warn(
        `Do not replace existing docker-compose file ${composeFileChainSummary} (dry-run mode enabled)`,
      );
      return [];
    }

    const composeUpdatesByWritableFile = await this.groupComposeUpdatesByWritableFile(
      composeFileChain,
      mappingsNeedingComposeUpdate,
      composeByFile,
    );

    const mutationSnapshots: ComposeFileMutationSnapshot[] = [];
    for (const [writableComposeFile, composeUpdates] of composeUpdatesByWritableFile.entries()) {
      const mutationSnapshot = await this.applyComposeFileMutationsByWritableFile(
        writableComposeFile,
        composeUpdates,
        composeFileChain,
        composeByFile,
      );
      /* v8 ignore next 3 -- mutation helpers return snapshots only when a write was required. */
      if (mutationSnapshot) {
        mutationSnapshots.push(mutationSnapshot);
      }
    }
    return mutationSnapshots;
  }

  async restoreComposeFileMutations(
    mutationSnapshots: ComposeFileMutationSnapshot[],
    options: RestoreComposeFileMutationOptions = {},
  ): Promise<void> {
    /* v8 ignore next 7 -- preserve mappings are covered through compose mutation grouping tests. */
    const preservedUpdatesByWritableFile =
      options.mappingsToPreserve && options.mappingsToPreserve.length > 0
        ? await this.groupComposeUpdatesByWritableFile(
            options.composeFileChain ?? mutationSnapshots.map((snapshot) => snapshot.filePath),
            options.mappingsToPreserve,
            options.composeByFile,
          )
        : new Map<string, unknown[]>();
    const restoreErrors: string[] = [];

    for (const mutationSnapshot of [...mutationSnapshots].reverse()) {
      try {
        await this.withComposeFileLock(mutationSnapshot.filePath, async (filePath) => {
          const preservedUpdates = preservedUpdatesByWritableFile.get(filePath) ?? [];
          const restoreText =
            preservedUpdates.length > 0
              ? updateComposeServiceImagesInText(
                  mutationSnapshot.originalText,
                  this.buildComposeServiceImageUpdates(preservedUpdates),
                  this.getCachedComposeDocument(
                    filePath,
                    Date.now(),
                    mutationSnapshot.originalText,
                  ),
                )
              : mutationSnapshot.originalText;
          await this.writeComposeFile(filePath, restoreText);
          return true;
        });
      } catch (restoreError: unknown) {
        restoreErrors.push(`${mutationSnapshot.filePath}: ${getErrorMessage(restoreError)}`);
        this.log.warn(
          `Failed to restore compose file ${mutationSnapshot.filePath} after failed runtime refresh ` +
            `(${getErrorMessage(restoreError)}). Manual intervention may be required.`,
        );
      }
    }

    if (restoreErrors.length > 0) {
      throw new Error(`Failed to restore compose file mutations (${restoreErrors.join('; ')})`);
    }
  }

  async runRuntimeUpdatesForComposeMappings(
    composeFile,
    composeFileChain,
    compose,
    mappingsNeedingRuntimeUpdate,
    runtimeContext?: unknown,
    completedRuntimeUpdates: ComposeRuntimeUpdateCompletion[] = [],
    lifecycleAlreadyAcquired = false,
    onSelfUpdateOperationId?: (operationId: string, updated: boolean) => void,
    lifecycleClassifications?: Map<object, 'current' | 'peer' | 'indeterminate'>,
  ): Promise<void> {
    const requestedRuntimeContext =
      runtimeContext && typeof runtimeContext === 'object'
        ? (runtimeContext as Record<string, unknown>)
        : undefined;
    const composeFileOnceHandledServices = new Set<string>();
    const composeFileOnceEnabled =
      this.configuration.composeFileOnce === true && this.configuration.dryrun !== true;
    const orderedMappings = sortMappingsByDependencyOrder(mappingsNeedingRuntimeUpdate);
    let composeFileOnceRuntimeContextByService = new Map<
      string,
      NonNullable<ComposeRuntimeRefreshOptions['runtimeContext']>
    >();
    if (composeFileOnceEnabled) {
      try {
        composeFileOnceRuntimeContextByService =
          await this.buildComposeFileOnceRuntimeContextByService(mappingsNeedingRuntimeUpdate);
        for (const { container, service } of orderedMappings) {
          const composeFileOnceRuntimeContext = composeFileOnceRuntimeContextByService.get(service);
          const composeContext: ComposeUpdateLifecycleContext = {
            composeFile,
            composeFiles: composeFileChain,
            service,
            serviceDefinition: compose.services[service],
            runtimeContext:
              composeFileOnceRuntimeContext || requestedRuntimeContext
                ? {
                    ...(requestedRuntimeContext || {}),
                    ...(composeFileOnceRuntimeContext || {}),
                  }
                : undefined,
          };
          await this.runComposeFileOncePostPullGate(container, composeContext);
        }
      } catch (error: unknown) {
        this.terminalizeComposeFileOncePreflightOperations(
          orderedMappings,
          requestedRuntimeContext,
          error,
        );
        throw error;
      }
    }

    // Refresh all containers requiring a runtime update via the shared
    // lifecycle orchestrator (security gate, hooks, prune/backup, events), in
    // dependency-graph order (v1.7 Phase 6.1, #219) rather than discovery order.
    for (const { container, service } of orderedMappings) {
      const composeFileOnceApplied =
        composeFileOnceEnabled && composeFileOnceHandledServices.has(service);
      const composeFileOnceRuntimeContext = composeFileOnceRuntimeContextByService.get(service);
      const composeContext: ComposeUpdateLifecycleContext = {
        composeFile,
        composeFiles: composeFileChain,
        service,
        serviceDefinition: compose.services[service],
        composeFileOnceApplied,
        skipPull:
          composeFileOnceEnabled &&
          composeFileOnceApplied !== true &&
          composeFileOnceRuntimeContext !== undefined,
        runtimeContext:
          composeFileOnceRuntimeContext || requestedRuntimeContext
            ? {
                ...(requestedRuntimeContext || {}),
                ...(composeFileOnceRuntimeContext || {}),
              }
            : undefined,
        postPullGateCompleted: composeFileOnceEnabled,
      };
      let runtimeUpdateRecorded = false;
      const recordRuntimeUpdate = () => {
        if (runtimeUpdateRecorded) {
          return;
        }
        runtimeUpdateRecorded = true;
        completedRuntimeUpdates.push({
          service,
          /* v8 ignore next -- runtime update payloads usually include the container name. */
          ...(typeof container?.name === 'string' ? { containerName: container.name } : {}),
        });
      };
      composeContext.onRuntimeUpdateApplied = recordRuntimeUpdate;
      const selfUpdateOperationIdHandler =
        lifecycleClassifications?.get(container) === 'current'
          ? onSelfUpdateOperationId
          : undefined;
      await this.runContainerUpdateLifecycle(container, composeContext, {
        lifecycleAlreadyAcquired,
        selfUpdateClassification: lifecycleClassifications?.get(container),
        onSelfUpdateOperationId: selfUpdateOperationIdHandler,
      });
      recordRuntimeUpdate();
      if (composeFileOnceEnabled && !composeFileOnceApplied) {
        composeFileOnceHandledServices.add(service);
      }
    }
  }

  async applyComposeMutationsAndRuntimeUpdates(
    composeFile,
    composeFileChain,
    composeByFile,
    composeFileChainSummary,
    compose,
    mappingsNeedingComposeUpdate,
    mappingsNeedingRuntimeUpdate,
    runtimeContext,
    lifecycleAlreadyAcquired = false,
    onSelfUpdateOperationId?: (operationId: string, updated: boolean) => void,
    lifecycleClassifications?: Map<object, 'current' | 'peer' | 'indeterminate'>,
  ): Promise<boolean> {
    const mutationSnapshots = await this.maybeApplyComposeFileMutations(
      composeFileChain,
      composeByFile,
      composeFileChainSummary,
      mappingsNeedingComposeUpdate,
    );
    const completedRuntimeUpdates: ComposeRuntimeUpdateCompletion[] = [];
    try {
      await this.runRuntimeUpdatesForComposeMappings(
        composeFile,
        composeFileChain,
        compose,
        mappingsNeedingRuntimeUpdate,
        runtimeContext,
        completedRuntimeUpdates,
        lifecycleAlreadyAcquired,
        onSelfUpdateOperationId,
        lifecycleClassifications,
      );
    } catch (runtimeError: unknown) {
      if (completedRuntimeUpdates.length === 0) {
        try {
          await this.restoreComposeFileMutations(mutationSnapshots);
        } catch {
          // restoreComposeFileMutations already logged the restore failure. Keep the
          // original runtime error as the operation error surfaced to callers.
        }
      } else {
        /* v8 ignore next 4 -- service is a fallback for malformed runtime update payloads. */
        const completedServices = completedRuntimeUpdates
          .map((update) => update.containerName || update.service)
          .join(', ');
        const completedServiceNames = new Set(
          completedRuntimeUpdates.map((update) => update.service),
        );
        try {
          await this.restoreComposeFileMutations(mutationSnapshots, {
            composeFileChain,
            composeByFile,
            mappingsToPreserve: mappingsNeedingComposeUpdate.filter(({ service }) =>
              completedServiceNames.has(service),
            ),
          });
        } catch {
          // restoreComposeFileMutations already logged the restore failure. Keep the
          // original runtime error as the operation error surfaced to callers.
        }
        this.log.warn(
          `Restored compose file mutations for ${composeFileChainSummary} after failed runtime refresh while ` +
            `preserving completed services (${completedServices}). Manual intervention may be required.`,
        );
      }
      throw runtimeError;
    }
    return true;
  }

  /**
   * Process a specific compose file with its associated containers.
   * @param composeFile
   * @param containers
   * @returns {Promise<boolean>} true if runtime updates were applied, false otherwise
   */
  async processComposeFile(
    composeFile,
    containers,
    composeFiles = [composeFile],
    runtimeContext?: unknown,
  ): Promise<boolean> {
    const { composeFileChain, composeFileChainSummary, composeByFile, compose } =
      await this.loadComposeProcessingContext(composeFile, composeFiles);
    const containersFiltered = this.filterContainersBelongingToCompose(
      compose,
      containers,
      composeFileChainSummary,
    );

    if (containersFiltered.length === 0) {
      this.log.warn(`No containers found in compose file ${composeFileChainSummary}`);
      return false;
    }

    const resolvedComposeImages = await this.getComposeResolvedImages(composeFileChain, compose);
    const versionMappings = this.buildVersionMappingsForCompose(
      containersFiltered,
      compose,
      resolvedComposeImages,
    );
    this.reconcileComposeMappings(composeFileChainSummary, versionMappings);
    const { mappingsNeedingComposeUpdate, mappingsNeedingRuntimeUpdate } =
      this.splitComposeAndRuntimeMappings(versionMappings);

    if (mappingsNeedingRuntimeUpdate.length === 0) {
      this.logAllComposeContainersUpToDate(composeFileChainSummary, versionMappings);
      return false;
    }

    const lifecycleClassifications = new Map<object, 'current' | 'peer' | 'indeterminate'>();
    const lifecycleAccessOptions = await Promise.all(
      mappingsNeedingRuntimeUpdate.map(async ({ container }) => {
        const classification = await this.classifySelfUpdate(container);
        lifecycleClassifications.set(container, classification);
        if (classification === 'indeterminate') {
          throw new Error('Drydock container identity is indeterminate; refusing unsafe update');
        }
        const infrastructureUpdate = this.isInfrastructureUpdate(container);
        return {
          selfUpdate: classification === 'current',
          bypassGlobalCap: classification === 'current' || infrastructureUpdate,
          exclusive: classification === 'current' || infrastructureUpdate,
        };
      }),
    );
    const exclusiveLifecycleRequired = lifecycleAccessOptions.some(({ exclusive }) => exclusive);
    const bypassGlobalCap = lifecycleAccessOptions.some(
      ({ bypassGlobalCap: shouldBypassGlobalCap }) => shouldBypassGlobalCap,
    );
    const composeFileLockKeys = buildComposeFileLockKeys(containersFiltered[0], composeFileChain);
    const updateLockKeys: string[] = [
      ...composeFileLockKeys,
      ...new Set(
        mappingsNeedingRuntimeUpdate.flatMap(({ container }) => this.getUpdateLockKeys(container)),
      ),
    ] as string[];
    let selfUpdateOperationId: string | undefined;
    return withContainerUpdateLocks(
      updateLockKeys,
      async () => {
        const onSelfUpdateOperationId = (operationId: string, updated: boolean) => {
          if (updated) {
            selfUpdateOperationId = operationId;
          }
        };
        return this.applyComposeMutationsAndRuntimeUpdates(
          composeFile,
          composeFileChain,
          composeByFile,
          composeFileChainSummary,
          compose,
          mappingsNeedingComposeUpdate,
          mappingsNeedingRuntimeUpdate,
          runtimeContext,
          true,
          onSelfUpdateOperationId,
          lifecycleClassifications,
        );
      },
      {
        bypassGlobalCap,
        exclusive: exclusiveLifecycleRequired,
        retainExclusiveOnResult: (result) =>
          exclusiveLifecycleRequired && result === true && selfUpdateOperationId
            ? { operationId: selfUpdateOperationId }
            : undefined,
        retainExclusiveOnError: () =>
          exclusiveLifecycleRequired && selfUpdateOperationId
            ? { operationId: selfUpdateOperationId }
            : undefined,
      },
    );
  }

  async resolveComposeServiceContext(container, currentImage) {
    const composeFiles = await this.resolveComposeFilesForContainer(container);
    if (composeFiles.length === 0) {
      throw new Error(`No compose file configured for ${container.name}`);
    }

    const composeByFile = new Map<string, unknown>();
    for (const composeFilePath of composeFiles) {
      composeByFile.set(composeFilePath, await this.getComposeFileAsObject(composeFilePath));
    }
    const compose = await this.getComposeFileChainAsObject(composeFiles, composeByFile);
    const resolvedComposeImages = await this.getComposeResolvedImages(composeFiles, compose);
    const service = getServiceKey(compose, container, currentImage);
    if (!service || !compose?.services?.[service]) {
      const composeFileSummary = composeFiles.join(', ');
      throw new Error(
        `Unable to resolve compose service for ${container.name} from ${composeFileSummary}`,
      );
    }

    this.assertComposeRepositoryContinuity(composeFiles.join(', '), [
      {
        container,
        service,
        runtimeImage: currentImage,
        current: (compose as ComposeFileWithServices).services?.[service]?.image,
        currentResolved: resolveComposeImageForContinuity(
          (compose as ComposeFileWithServices).services?.[service]?.image,
          resolvedComposeImages.get(service),
        ),
      },
    ]);
    const composeFile = await this.getWritableComposeFileForService(
      composeFiles,
      service,
      composeByFile,
    );
    return { composeFile, composeFiles, compose, service };
  }

  async preview(container) {
    const preview = await super.preview(container);
    if (!preview || typeof preview !== 'object' || 'error' in preview) {
      return preview;
    }

    const registry = getState().registry[container.image.registry.name];
    const currentImage = registry.getImageFullName(container.image, container.image.tag.value);
    const { composeFile, composeFiles, compose, service } = await this.resolveComposeServiceContext(
      container,
      currentImage,
    );

    const mapping = this.mapCurrentVersionToUpdateVersion(compose, container);
    const currentServiceImage =
      mapping?.current || (compose as ComposeFileWithServices)?.services?.[service]?.image;
    const targetServiceImage = mapping
      ? this.getComposeMutationImageReference(container, mapping.update, currentServiceImage)
      : preview.newImage;
    const composePreview = {
      files: composeFiles,
      paths: composeFiles,
      service,
      mutation: {
        intent: 'update-compose-service-image',
        dryRun: Boolean(this.configuration.dryrun),
        willWrite: !this.configuration.dryrun,
      },
    } as {
      files: string[];
      paths: string[];
      service: string;
      mutation: {
        intent: string;
        dryRun: boolean;
        willWrite: boolean;
      };
      patch?: {
        path: string;
        format: string;
        diff: string;
      };
    };

    if (currentServiceImage && targetServiceImage && currentServiceImage !== targetServiceImage) {
      composePreview.patch = buildComposePatchPreview(
        composeFile,
        service,
        currentServiceImage,
        targetServiceImage,
      );
    }

    return {
      ...preview,
      compose: composePreview,
    };
  }

  async updateContainerWithCompose(composeFile, service, container, options = {}) {
    await this.refreshComposeServiceWithDockerApi(composeFile, service, container, options);
  }

  async createContainer(dockerApi, containerToCreate, containerName, logContainer) {
    logContainer.info(`Create container ${containerName}`);
    let newContainer: DockerContainerHandle | undefined;
    try {
      let containerToCreatePayload = containerToCreate;
      /* v8 ignore next -- Docker create payloads normally include NetworkingConfig.EndpointsConfig. */
      const endpointsConfig = containerToCreate.NetworkingConfig?.EndpointsConfig || {};
      const endpointNetworkNames = Object.keys(endpointsConfig);
      const additionalNetworkNames: string[] = [];

      if (endpointNetworkNames.length > 1) {
        const primaryNetworkName = this.runtimeConfigManager.getPrimaryNetworkName(
          containerToCreate,
          endpointNetworkNames,
        );

        containerToCreatePayload = {
          ...containerToCreate,
          NetworkingConfig: {
            EndpointsConfig: {
              [primaryNetworkName]: endpointsConfig[primaryNetworkName],
            },
          },
        };
        additionalNetworkNames.push(
          ...endpointNetworkNames.filter((networkName) => networkName !== primaryNetworkName),
        );
      }

      newContainer = await dockerApi.createContainer(containerToCreatePayload);

      for (const networkName of additionalNetworkNames) {
        logContainer.info(`Connect container ${containerName} to network ${networkName}`);
        const network = dockerApi.getNetwork(networkName);
        await network.connect({
          Container: containerName,
          EndpointConfig: endpointsConfig[networkName],
        });
        logContainer.info(
          `Container ${containerName} connected to network ${networkName} with success`,
        );
      }

      logContainer.info(`Container ${containerName} recreated on new image with success`);
      return newContainer;
    } catch (error: unknown) {
      attachCreatedContainerCandidate(error, newContainer);
      logContainer.warn(
        `Error when creating container ${containerName} (${getErrorMessage(error)})`,
      );
      throw error;
    }
  }

  /**
   * Normalize Docker image and daemon Architecture strings to Docker platform
   * architecture names. Returns undefined for unknown architectures (treated as
   * compatible to avoid false-positive blocks on exotic platforms).
   */
  private static normalizeDockerArchitecture(architecture: string): string | undefined {
    const map: Record<string, string> = {
      amd64: 'amd64',
      x86_64: 'amd64',
      x64: 'amd64',
      aarch64: 'arm64',
      arm64: 'arm64',
      arm: 'arm',
      armv6: 'arm',
      armv7: 'arm',
      armhf: 'arm',
      '386': '386',
      i386: '386',
      i686: '386',
      ia32: '386',
      ppc64le: 'ppc64le',
      ppc64: 'ppc64',
      s390x: 's390x',
      riscv64: 'riscv64',
    };
    return map[architecture.toLowerCase()];
  }

  private static async getDockerDaemonArchitecture(
    dockerApi: DockerApiLike,
  ): Promise<string | undefined> {
    if (typeof dockerApi.info !== 'function') {
      return undefined;
    }
    try {
      const info = await dockerApi.info();
      /* v8 ignore next 3 -- Docker info normally reports a nonblank Architecture string. */
      return typeof info?.Architecture === 'string' && info.Architecture.trim() !== ''
        ? info.Architecture.trim()
        : undefined;
    } catch {
      /* v8 ignore next -- Docker info failures skip the architecture gate. */
      return undefined;
    }
  }

  private static attachComposeRollbackOutcome(
    error: unknown,
    rollbackOutcome: ComposeRollbackOutcome,
  ): void {
    /* v8 ignore next 3 -- helper only receives object errors from compose rollback paths. */
    if (!error || typeof error !== 'object') {
      return;
    }
    (error as ComposeRollbackError).composeRollbackOutcome = rollbackOutcome;
  }

  /**
   * Pre-flight guard: inspect the just-pulled image and verify its architecture
   * matches the Docker daemon before performing any destructive step. Throws a clear,
   * actionable error on mismatch so the running container is left untouched.
   *
   * Skipped when dockerApi does not expose getImage/info (older mocks / proxies) —
   * in that case we fall through to the existing stop/create sequence and let
   * Docker surface its own error.
   */
  async verifyPulledImageCompatibility(
    dockerApi: DockerApiLike,
    newImage: string,
    logContainer: { info: (msg: string) => void; warn: (msg: string) => void },
  ): Promise<void> {
    if (typeof dockerApi.getImage !== 'function') {
      return;
    }
    let imageInspect: { Architecture?: string; Os?: string } | undefined;
    try {
      imageInspect = await dockerApi.getImage(newImage).inspect();
    } catch {
      // Image inspect failed — not a hard error; Docker will surface the real
      // problem during container creation.
      return;
    }
    if (!imageInspect?.Architecture) {
      return;
    }
    const imageArch = imageInspect.Architecture;
    const daemonArch = await Dockercompose.getDockerDaemonArchitecture(dockerApi);
    if (!daemonArch) {
      return;
    }
    const normalizedImageArch = Dockercompose.normalizeDockerArchitecture(imageArch);
    const normalizedDaemonArch = Dockercompose.normalizeDockerArchitecture(daemonArch);
    /* v8 ignore next 4 -- unknown architectures are treated as compatible by design. */
    if (normalizedImageArch === undefined || normalizedDaemonArch === undefined) {
      // Unknown architecture — treat as compatible to avoid false-positive blocks.
      return;
    }
    if (normalizedImageArch !== normalizedDaemonArch) {
      throw new Error(
        `Cannot update to ${newImage}: image architecture "${imageArch}" is not compatible with Docker daemon architecture "${daemonArch}". ` +
          `The running container has been left untouched.`,
      );
    }
    logContainer.info(
      `Image ${newImage} architecture "${imageArch}" is compatible with Docker daemon "${daemonArch}"`,
    );
  }

  /**
   * Rollback safety net: after the new container creation fails, attempt to
   * restore the original container from the captured spec. Logs the outcome
   * but does NOT swallow the original error — the caller re-throws it.
   */
  private async attemptRollbackRestoreOldContainer(
    dockerApi: DockerApiLike,
    originalContainerSpec,
    originalImage: string,
    container,
    logContainer: { info: (msg: string) => void; warn: (msg: string) => void },
    updateError: unknown,
  ): Promise<ComposeRollbackOutcome> {
    const containerName = container.name;
    const lastError = getErrorMessage(updateError);
    logContainer.warn(
      `Recreate failed for ${containerName}; attempting to restore the original container from captured spec`,
    );
    try {
      await super.recreateContainer(
        dockerApi,
        originalContainerSpec,
        originalImage,
        container,
        logContainer,
      );
      logContainer.info(
        `Original container ${containerName} restored successfully after failed update`,
      );
      return {
        status: 'rolled-back',
        phase: 'rolled-back',
        rollbackReason: 'compose_runtime_refresh_failed',
        lastError,
      };
    } catch (rollbackError: unknown) {
      logContainer.warn(
        `Failed to restore original container ${containerName} after failed update ` +
          `(${getErrorMessage(rollbackError)}). Manual intervention may be required.`,
      );
      // #macvlan incident: super.recreateContainer (Docker.recreateContainer)
      // attaches a created-but-unstarted/unconnected container handle to the
      // thrown error when create succeeds but start (or a network connect)
      // fails. Without recovering and cleaning it up here, that orphan is
      // dropped on the floor and squats the canonical container name.
      // Cleanup is best-effort (cleanupFailedReplacementCandidate swallows
      // its own stop/remove errors) so it never changes the rollback-failed
      // status returned below.
      const orphanCandidate = getCreatedContainerCandidate(rollbackError);
      await this.cleanupFailedReplacementCandidate(orphanCandidate, containerName, logContainer);
      return {
        status: 'rollback-failed',
        phase: 'rollback-failed',
        rollbackReason: 'compose_runtime_refresh_failed',
        lastError,
      };
    }
  }

  private async cleanupFailedReplacementCandidate(
    candidateContainer: unknown,
    containerName: string,
    logContainer: { warn: (msg: string) => void },
  ): Promise<void> {
    return cleanupCreatedContainerCandidate(candidateContainer, containerName, logContainer);
  }

  private ensureComposeRuntimeState(currentContainerSpec, composeFile, service): void {
    if (typeof currentContainerSpec?.State?.Running !== 'boolean') {
      throw new Error(
        `Unable to refresh compose service ${service} from ${composeFile} because Docker inspection data is missing runtime state`,
      );
    }
  }

  private async recreateReplacementContainerWithCleanup(
    dockerApi,
    currentContainerSpec,
    newImage,
    container,
    logContainer: { info: (msg: string) => void; warn: (msg: string) => void },
    cloneRuntimeConfigOptions,
  ): Promise<void> {
    const containerToCreateInspect = this.cloneContainer(
      currentContainerSpec,
      newImage,
      cloneRuntimeConfigOptions,
    );
    let newContainer: unknown;

    try {
      newContainer = await this.createContainer(
        dockerApi,
        containerToCreateInspect,
        container.name,
        logContainer,
      );

      if (currentContainerSpec.State.Running) {
        await this.startContainer(newContainer, container.name, logContainer);
      }
    } catch (recreateError: unknown) {
      await this.cleanupFailedReplacementCandidate(
        newContainer || getCreatedContainerCandidate(recreateError),
        container.name,
        logContainer,
      );
      throw recreateError;
    }
  }

  /**
   * Refresh one compose-managed service by using the Docker Engine API
   * directly. Shared by updateContainerWithCompose() and recreateContainer()
   * to keep the runtime recreation path explicit and non-recursive.
   */
  private async refreshComposeServiceWithDockerApi(
    composeFile,
    service,
    container,
    options: ComposeRuntimeRefreshOptions = {},
  ) {
    const logContainer = this.log.child({
      container: container.name,
    });

    const {
      shouldStart = undefined,
      skipPull = false,
      forceRecreate = false,
      postPullHook,
    } = options;

    if (this.configuration.dryrun) {
      logContainer.warn(
        `Do not refresh compose service ${service} from ${composeFile} because dry-run mode is enabled`,
      );
      if (postPullHook) {
        await postPullHook(getRequestedOperationId(container, options.runtimeContext) ?? '');
      }
      return;
    }

    const runtimeContext = options.runtimeContext || {};
    const dockerApi = runtimeContext.dockerApi || this.getWatcher(container).dockerApi;
    let auth = runtimeContext.auth;
    let newImage = runtimeContext.newImage;

    if (!newImage || (!skipPull && auth === undefined)) {
      const registry =
        runtimeContext.registry ||
        this.resolveRegistryManager(container, logContainer, {
          allowAnonymousFallback: true,
        });
      if (!newImage) {
        newImage = this.getNewImageFullName(registry, container);
      }
      if (!skipPull && auth === undefined) {
        auth = await registry.getAuthPull();
      }
    }
    const currentContainer = await this.getCurrentContainer(dockerApi, container);
    if (!currentContainer) {
      throw new Error(
        `Unable to refresh compose service ${service} from ${composeFile} because container ${container.name} no longer exists`,
      );
    }
    const currentContainerSpec = await this.inspectContainer(currentContainer, logContainer);
    this.ensureComposeRuntimeState(currentContainerSpec, composeFile, service);
    const serviceShouldStart =
      shouldStart !== undefined ? shouldStart : currentContainerSpec.State.Running;

    logContainer.info(
      `Refresh compose service ${service} from ${composeFile} using Docker Engine API`,
    );
    if (!skipPull) {
      await this.pullImage(dockerApi, auth, newImage, logContainer);
    } else {
      logContainer.debug(`Skip image pull for ${service} from ${composeFile}`);
    }
    let imageIdentity = runtimeContext.imageIdentity;
    let securityGateUnboundWarn = runtimeContext.securityGateUnboundWarn === true;
    let securityGateUnboundReason = runtimeContext.securityGateUnboundReason;
    if (!imageIdentity && !securityGateUnboundWarn) {
      const identityOutcome = await this.capturePulledImageIdentity(
        dockerApi as DockerApiLike,
        newImage,
        container,
        logContainer,
      );
      imageIdentity = identityOutcome.imageIdentity;
      securityGateUnboundWarn = identityOutcome.unboundWarn;
      securityGateUnboundReason = identityOutcome.reason;
    }
    const pinnedImage = imageIdentity || newImage;
    if (securityGateUnboundWarn) {
      this.recordUnboundSecurityWarning(container, securityGateUnboundReason);
    } else if (postPullHook) {
      const operationId = getRequestedOperationId(container, runtimeContext) ?? '';
      if (imageIdentity) {
        await postPullHook(operationId, imageIdentity);
      } else {
        await postPullHook(operationId);
      }
    }
    if (forceRecreate) {
      logContainer.debug(
        `Force recreate requested for ${service}; Docker Engine API path always recreates containers`,
      );
    }

    // (a) PRE-FLIGHT GUARD — verify the target image is usable on this host
    // before performing any destructive step. On arch mismatch the old
    // container is left running and we throw without touching it.
    await this.verifyPulledImageCompatibility(
      dockerApi as DockerApiLike,
      pinnedImage,
      logContainer,
    );
    const cloneRuntimeConfigOptions = await this.runtimeConfigManager.getCloneRuntimeConfigOptions(
      dockerApi,
      currentContainerSpec,
      pinnedImage,
      logContainer,
    );

    // Capture the original container spec for rollback before we do anything
    // destructive. The Config.Image field holds the old image reference.
    const originalImage: string = currentContainerSpec?.Config?.Image ?? newImage;
    const rollbackSpec = {
      ...currentContainerSpec,
      State: {
        ...currentContainerSpec.State,
        Running: currentContainerSpec.State.Running,
      },
    };

    const recreationContainerSpec = {
      ...currentContainerSpec,
      State: {
        ...currentContainerSpec.State,
        Running: serviceShouldStart,
      },
    };

    // (b) ROLLBACK SAFETY NET — if recreateContainer throws after we have
    // already removed the old container, try to restore it from the captured
    // spec before re-throwing so the service is not left with zero containers.
    // Intentionally bypass Dockercompose.stopAndRemoveContainer() no-op: this
    // internal Engine API refresh path must perform the real stop/remove.
    await super.stopAndRemoveContainer(
      currentContainer,
      currentContainerSpec,
      container,
      logContainer,
    );
    try {
      await this.recreateReplacementContainerWithCleanup(
        dockerApi,
        recreationContainerSpec,
        pinnedImage,
        container,
        logContainer,
        cloneRuntimeConfigOptions,
      );
    } catch (recreateError: unknown) {
      const rollbackOutcome = await this.attemptRollbackRestoreOldContainer(
        dockerApi as DockerApiLike,
        rollbackSpec,
        originalImage,
        container,
        logContainer,
        recreateError,
      );
      Dockercompose.attachComposeRollbackOutcome(recreateError, rollbackOutcome);
      throw recreateError;
    }
  }

  /**
   * No-op for generic callers that invoke stop/remove and recreate as two
   * separate steps (for example health-monitor rollback paths). In compose
   * mode, recreateContainer() owns the full mutation + runtime refresh and
   * would otherwise duplicate stop/remove work.
   *
   * When a compose refresh must actually stop/remove, we bypass this override
   * via super.stopAndRemoveContainer() in refreshComposeServiceWithDockerApi().
   */
  async stopAndRemoveContainer(_currentContainer, _currentContainerSpec, container, logContainer) {
    logContainer.info(
      `Skip direct stop/remove for compose-managed container ${container.name}; using compose lifecycle`,
    );
  }

  async recreateContainer(_dockerApi, currentContainerSpec, newImage, container, logContainer) {
    const registry = getState().registry[container.image.registry.name];
    const fallbackCurrentImage = registry.getImageFullName(
      container.image,
      container.image.tag.value,
    );
    const currentImage = currentContainerSpec?.Config?.Image || fallbackCurrentImage;
    const { composeFile, composeFiles, service } = await this.resolveComposeServiceContext(
      container,
      currentImage,
    );

    const mutationResult = await this.mutateComposeFile(
      composeFile,
      (composeFileText, composeFileMetadata) =>
        updateComposeServiceImageInText(
          composeFileText,
          service,
          newImage,
          this.getCachedComposeDocument(
            composeFileMetadata.filePath,
            composeFileMetadata.mtimeMs,
            composeFileText,
          ),
        ),
      {
        composeFiles,
        captureSnapshot: true,
        validateCurrentState: (composeFileText, filePath, currentComposeFileChain) =>
          this.assertComposeRepositoryContinuityFromFreshChain(
            currentComposeFileChain,
            filePath,
            composeFileText,
            [{ container, service, runtimeImage: currentImage }],
          ),
      },
    );
    const mutationSnapshots =
      isPlainObject(mutationResult) &&
      typeof mutationResult.filePath === 'string' &&
      typeof mutationResult.originalText === 'string'
        ? [mutationResult as ComposeFileMutationSnapshot]
        : [];

    const composeUpdateOptions = {
      shouldStart: currentContainerSpec?.State?.Running === true,
      skipPull: true,
      forceRecreate: true,
    } as ComposeRuntimeRefreshOptions;
    if (composeFiles.length > 1) {
      composeUpdateOptions.composeFiles = composeFiles;
    }

    try {
      await this.refreshComposeServiceWithDockerApi(
        composeFile,
        service,
        container,
        composeUpdateOptions,
      );
    } catch (runtimeError: unknown) {
      try {
        await this.restoreComposeFileMutations(mutationSnapshots);
      } catch {
        Dockercompose.attachComposeRollbackOutcome(runtimeError, {
          status: 'rollback-failed',
          phase: 'rollback-failed',
          rollbackReason: 'compose_runtime_refresh_failed',
          lastError: getErrorMessage(runtimeError),
        });
      }
      throw runtimeError;
    }
  }

  async runServicePostStartHooks(container, serviceKey, service) {
    return this._postStartExecutor.runServicePostStartHooks(container, serviceKey, service);
  }

  /**
   * Backup a file.
   * @param file
   * @param backupFile
   * @returns {Promise<void>}
   */
  async backup(file, backupFile) {
    try {
      this.log.debug(`Backup ${file} as ${backupFile}`);
      await fs.copyFile(file, backupFile);
    } catch (e: unknown) {
      this.log.warn(
        `Error when trying to backup file ${file} to ${backupFile} (${getErrorMessage(e)})`,
      );
    }
  }

  /**
   * Return a map containing the image declaration
   * with the current version
   * and the image declaration with the update version.
   * @param compose
   * @param container
   * @returns {{service, current, update}|undefined}
   */
  mapCurrentVersionToUpdateVersion(compose, container) {
    // Get registry configuration
    this.log.debug(`Get ${container.image.registry.name} registry manager`);
    const registry = getState().registry[container.image.registry.name];

    // Rebuild image definition string
    const currentFullImage = registry.getImageFullName(container.image, container.image.tag.value);

    const serviceKeyToUpdate = getServiceKey(compose, container, currentFullImage);

    if (!serviceKeyToUpdate) {
      this.log.warn(
        `Could not find service for container ${container.name} with image ${currentFullImage}`,
      );
      return undefined;
    }
    const serviceToUpdate = compose.services[serviceKeyToUpdate];
    if (!serviceToUpdate?.image) {
      this.log.warn(
        `Could not update service ${serviceKeyToUpdate} for container ${container.name} because image is missing`,
      );
      return undefined;
    }

    const updateImage = this.getNewImageFullName(registry, container);
    const currentImage = serviceToUpdate.image;

    return {
      service: serviceKeyToUpdate,
      current: currentImage,
      update: updateImage,
      currentNormalized: normalizeImplicitLatest(currentImage),
      updateNormalized: normalizeImplicitLatest(updateImage),
    };
  }

  /**
   * Write docker-compose file.
   * @param file
   * @param data
   * @returns {Promise<void>}
   */
  async writeComposeFile(file, data) {
    const filePath = this.resolveComposeFilePath(file);
    try {
      await this.withComposeFileLock(filePath, async () => {
        await this.writeComposeFileAtomic(filePath, data);
      });
      this.invalidateComposeCaches(filePath);
    } catch (e: unknown) {
      this.log.error(`Error when writing ${filePath} (${getErrorMessage(e)})`);
      this.log.debug(e);
      throw e;
    }
  }

  invalidateComposeCaches(filePath) {
    this._composeFileParser.invalidateComposeCaches(filePath);
  }

  setComposeCacheEntry(cache, filePath, value) {
    this._composeFileParser.setComposeCacheEntry(cache, filePath, value);
  }

  getCachedComposeDocument(filePath, mtimeMs, composeFileText) {
    return this._composeFileParser.getCachedComposeDocument(filePath, mtimeMs, composeFileText);
  }

  /**
   * Read docker-compose file as a buffer.
   * @param file - Optional file path, defaults to configuration file
   * @returns {Promise<Buffer>}
   */
  getComposeFile(file = null) {
    return this._composeFileParser.getComposeFile(file);
  }

  /**
   * Read docker-compose file as an object.
   * @param file - Optional file path, defaults to configuration file
   * @returns {Promise<unknown>}
   */
  async getComposeFileAsObject(file = null) {
    const configuredFilePath = file || this.configuration.file;
    try {
      const filePath = this.resolveComposeFilePath(configuredFilePath);
      const composeFileStat = await fs.stat(filePath);
      const cachedComposeObject = this._composeObjectCache.get(filePath);
      if (cachedComposeObject && cachedComposeObject.mtimeMs === composeFileStat.mtimeMs) {
        this.setComposeCacheEntry(this._composeObjectCache, filePath, cachedComposeObject);
        return cachedComposeObject.compose;
      }
      const compose = yaml.parse((await this.getComposeFile(filePath)).toString(), {
        maxAliasCount: YAML_MAX_ALIAS_COUNT,
      });
      this.setComposeCacheEntry(this._composeObjectCache, filePath, {
        mtimeMs: composeFileStat.mtimeMs,
        compose,
      });
      return compose;
    } catch (e: unknown) {
      this.log.error(
        `Error when parsing the docker-compose yaml file ${configuredFilePath} (${getErrorMessage(e)})`,
      );
      throw e;
    }
  }
}

export default Dockercompose;

export {
  getImageRepositoryKey as testable_getImageRepositoryKey,
  hasExplicitRegistryHost as testable_hasExplicitRegistryHost,
  normalizeImplicitLatest as testable_normalizeImplicitLatest,
  normalizePostStartEnvironmentValue as testable_normalizePostStartEnvironmentValue,
  normalizePostStartHooks as testable_normalizePostStartHooks,
  resolveComposeInterpolation as testable_resolveComposeInterpolation,
  updateComposeServiceImageInText as testable_updateComposeServiceImageInText,
};
