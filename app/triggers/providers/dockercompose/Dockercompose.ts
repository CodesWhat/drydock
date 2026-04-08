import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'yaml';
import type { ContainerImage } from '../../../model/container.js';
import type Registry from '../../../registries/Registry.js';
import { getState } from '../../../registry/index.js';
import { resolveConfiguredPath, resolveConfiguredPathWithinBase } from '../../../runtime/paths.js';
import { sleep } from '../../../util/sleep.js';
import Docker from '../docker/Docker.js';
import ComposeFileLockManager from './ComposeFileLockManager.js';
import ComposeFileParser, {
  COMPOSE_CACHE_MAX_ENTRIES,
  updateComposeServiceImageInText,
  updateComposeServiceImagesInText,
  YAML_MAX_ALIAS_COUNT,
} from './ComposeFileParser.js';
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
const SELF_CONTAINER_IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
const ROOT_MODE_BREAK_GLASS_HINT =
  'use socket proxy or adjust file permissions/group_add; break-glass root mode requires DD_RUN_AS_ROOT=true + DD_ALLOW_INSECURE_ROOT=true';

interface DockerApiLike {
  modem: {
    socketPath: string;
  };
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
  name?: string;
  labels?: Record<string, string>;
  watcher?: string;
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
  operationId?: string;
  registry?: unknown;
};

type ComposeUpdateLifecycleContext = {
  composeFile: string;
  service: string;
  serviceDefinition?: unknown;
  composeFiles?: string[];
  composeFileOnceApplied?: boolean;
  skipPull?: boolean;
  runtimeContext?: ComposeRuntimeContext;
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
};

function hasDefinedComposeRuntimeContextValue(runtimeContext: ComposeRuntimeContext): boolean {
  return Object.values(runtimeContext).some((value) => value !== undefined);
}

type ValidateComposeConfigurationOptions = {
  composeFiles?: string[];
  parsedComposeFileObject?: unknown;
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
    const normalizedServiceImage = normalizeImplicitLatest(serviceImage);

    // Match priority (most strict to most lenient):
    // 1) Exact `service.image` match.
    if (serviceImage === imageToMatch) {
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
  /* v8 ignore next -- non-string fs/network error codes are defensive and treated as absent */
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
class Dockercompose extends Docker {
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
    // Docker bind mounts follow "<source>:<destination>[:options]".
    // We only need source + destination; mount options (for example :rw/:ro) are ignored.
    const [sourceRaw, destinationRaw] = bindDefinition.split(':', 2);
    const source = sourceRaw?.trim();
    const destination = destinationRaw?.trim();
    if (!source || !destination) {
      return null;
    }
    if (!path.isAbsolute(source) || !path.isAbsolute(destination)) {
      return null;
    }
    return {
      source: path.resolve(source),
      destination: path.resolve(destination),
    };
  }

  getSelfContainerIdentifier(): string | null {
    const hostname = process.env.HOSTNAME?.trim();
    if (!hostname || !SELF_CONTAINER_IDENTIFIER_PATTERN.test(hostname)) {
      return null;
    }
    return hostname;
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
        const selfContainerInspect = await dockerApi
          .getContainer(selfContainerIdentifier)
          .inspect();
        const bindDefinitions = selfContainerInspect?.HostConfig?.Binds;
        if (!Array.isArray(bindDefinitions)) {
          return;
        }
        this._hostToContainerBindMounts = bindDefinitions
          .map((bindDefinition) => this.parseHostToContainerBindMount(bindDefinition))
          .filter((bindMount): bindMount is HostToContainerBindMount => bindMount !== null)
          .sort((left, right) => right.source.length - left.source.length);
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
    if (!path.isAbsolute(composeFilePath) || this._hostToContainerBindMounts.length === 0) {
      return composeFilePath;
    }
    const normalizedComposeFilePath = path.resolve(composeFilePath);

    for (const bindMount of this._hostToContainerBindMounts) {
      if (normalizedComposeFilePath === bindMount.source) {
        return bindMount.destination;
      }
      const sourcePrefix = bindMount.source.endsWith(path.sep)
        ? bindMount.source
        : `${bindMount.source}${path.sep}`;
      if (!normalizedComposeFilePath.startsWith(sourcePrefix)) {
        continue;
      }
      const relativeComposePath = path.relative(bindMount.source, normalizedComposeFilePath);
      if (!relativeComposePath || relativeComposePath === '.') {
        return bindMount.destination;
      }
      if (relativeComposePath.startsWith('..') || path.isAbsolute(relativeComposePath)) {
        continue;
      }
      return path.join(bindMount.destination, relativeComposePath);
    }

    return composeFilePath;
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
    // Check if container has a compose file label (dd.* primary, wud.* fallback)
    const composeFileLabel = this.configuration.composeFileLabel;
    const wudFallbackLabel = composeFileLabel.replace(/^dd\./, 'wud.');
    const labelValue = container.labels?.[composeFileLabel] || container.labels?.[wudFallbackLabel];
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

  reconcileComposeMappings(composeFileChainSummary, versionMappings) {
    const reconciliationMode = this.configuration.reconciliationMode || 'warn';
    if (reconciliationMode === 'off') {
      return;
    }
    for (const mapping of versionMappings) {
      if (mapping.runtimeNormalized === mapping.currentNormalized) {
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

  async mutateComposeFile(
    file,
    updateComposeText,
    options: ValidateComposeConfigurationOptions = {},
  ) {
    return this.withComposeFileLock(file, async (filePath) => {
      const composeFileText = (await this.getComposeFile(filePath)).toString();
      const composeFileStat = await fs.stat(filePath);
      const composeFileChain = this.normalizeComposeFileChain(filePath, options.composeFiles);
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
      'composeFiles' | 'skipPull' | 'runtimeContext'
    >,
  ): Promise<void> {
    if (composeCtx.composeFileOnceApplied === true) {
      const logContainer = this.log.child({
        container: container.name,
      });
      logContainer.info(
        `Skip per-service compose refresh for ${composeCtx.service} because compose-file-once mode already refreshed ${composeCtx.composeFile}`,
      );
      return;
    }

    await this.updateContainerWithCompose(
      composeCtx.composeFile,
      composeCtx.service,
      container,
      composeUpdateOptions,
    );
  }

  async performContainerUpdate(
    context,
    container,
    _logContainer,
    composeCtx?: ComposeUpdateLifecycleContext,
  ) {
    const requiredComposeCtx = this.requireComposeUpdateContext(container, composeCtx);
    const runtimeContext = this.buildComposeRuntimeContext(context, requiredComposeCtx);
    const composeUpdateOptions = this.buildPerformContainerUpdateOptions(
      requiredComposeCtx,
      runtimeContext,
    );

    await this.maybeRunPerServiceComposeRefresh(
      requiredComposeCtx,
      container,
      composeUpdateOptions,
    );
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
  ): Pick<ComposeRuntimeRefreshOptions, 'composeFiles' | 'skipPull' | 'runtimeContext'> {
    const composeUpdateOptions = {} as Pick<
      ComposeRuntimeRefreshOptions,
      'composeFiles' | 'skipPull' | 'runtimeContext'
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
      logContainer.info('Do not replace the existing container because dry-run mode is enabled');
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
      composeFileOnceRuntimeContextByService.set(service, {
        dockerApi,
        registry,
        auth,
        newImage,
      });
      await this.pullImage(dockerApi, auth, newImage, logContainer);
    }
    return composeFileOnceRuntimeContextByService;
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

  buildVersionMappingsForCompose(containersFiltered, compose) {
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
  ) {
    // Backup docker-compose file
    if (this.configuration.backup) {
      const backupFile = `${writableComposeFile}.back`;
      await this.backup(writableComposeFile, backupFile);
    }

    // Replace only the targeted compose service image values.
    const serviceImageUpdates = this.buildComposeServiceImageUpdates(composeUpdates);
    const parsedComposeFileObject = this.buildUpdatedComposeFileObjectForValidation(
      composeByFile.get(writableComposeFile),
      serviceImageUpdates,
    );
    await this.mutateComposeFile(
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
      },
    );
  }

  async maybeApplyComposeFileMutations(
    composeFileChain,
    composeByFile,
    composeFileChainSummary,
    mappingsNeedingComposeUpdate,
  ): Promise<void> {
    if (mappingsNeedingComposeUpdate.length === 0) {
      return;
    }

    if (this.configuration.dryrun) {
      this.log.info(
        `Do not replace existing docker-compose file ${composeFileChainSummary} (dry-run mode enabled)`,
      );
      return;
    }

    const composeUpdatesByWritableFile = await this.groupComposeUpdatesByWritableFile(
      composeFileChain,
      mappingsNeedingComposeUpdate,
      composeByFile,
    );

    for (const [writableComposeFile, composeUpdates] of composeUpdatesByWritableFile.entries()) {
      await this.applyComposeFileMutationsByWritableFile(
        writableComposeFile,
        composeUpdates,
        composeFileChain,
        composeByFile,
      );
    }
  }

  async runRuntimeUpdatesForComposeMappings(
    composeFile,
    composeFileChain,
    compose,
    mappingsNeedingRuntimeUpdate,
    runtimeContext?: unknown,
  ): Promise<void> {
    const requestedRuntimeContext =
      runtimeContext && typeof runtimeContext === 'object'
        ? (runtimeContext as Record<string, unknown>)
        : undefined;
    const composeFileOnceHandledServices = new Set<string>();
    const composeFileOnceEnabled =
      this.configuration.composeFileOnce === true && this.configuration.dryrun !== true;
    const composeFileOnceRuntimeContextByService = composeFileOnceEnabled
      ? await this.buildComposeFileOnceRuntimeContextByService(mappingsNeedingRuntimeUpdate)
      : new Map<string, NonNullable<ComposeRuntimeRefreshOptions['runtimeContext']>>();

    // Refresh all containers requiring a runtime update via the shared
    // lifecycle orchestrator (security gate, hooks, prune/backup, events).
    for (const { container, service } of mappingsNeedingRuntimeUpdate) {
      const composeFileOnceApplied =
        composeFileOnceEnabled && composeFileOnceHandledServices.has(service);
      const composeFileOnceRuntimeContext = composeFileOnceRuntimeContextByService.get(service);
      const composeContext = {
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
      };
      await this.runContainerUpdateLifecycle(container, composeContext);
      if (composeFileOnceEnabled && !composeFileOnceApplied) {
        composeFileOnceHandledServices.add(service);
      }
    }
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

    const versionMappings = this.buildVersionMappingsForCompose(containersFiltered, compose);
    this.reconcileComposeMappings(composeFileChainSummary, versionMappings);
    const { mappingsNeedingComposeUpdate, mappingsNeedingRuntimeUpdate } =
      this.splitComposeAndRuntimeMappings(versionMappings);

    if (mappingsNeedingRuntimeUpdate.length === 0) {
      this.logAllComposeContainersUpToDate(composeFileChainSummary, versionMappings);
      return false;
    }

    await this.maybeApplyComposeFileMutations(
      composeFileChain,
      composeByFile,
      composeFileChainSummary,
      mappingsNeedingComposeUpdate,
    );
    await this.runRuntimeUpdatesForComposeMappings(
      composeFile,
      composeFileChain,
      compose,
      mappingsNeedingRuntimeUpdate,
      runtimeContext,
    );
    return true;
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
    const service = getServiceKey(compose, container, currentImage);
    if (!service || !compose?.services?.[service]) {
      const composeFileSummary = composeFiles.join(', ');
      throw new Error(
        `Unable to resolve compose service for ${container.name} from ${composeFileSummary}`,
      );
    }

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

  private ensureComposeRuntimeState(currentContainerSpec, composeFile, service): void {
    if (typeof currentContainerSpec?.State?.Running !== 'boolean') {
      throw new Error(
        `Unable to refresh compose service ${service} from ${composeFile} because Docker inspection data is missing runtime state`,
      );
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

    const { shouldStart = undefined, skipPull = false, forceRecreate = false } = options;

    if (this.configuration.dryrun) {
      logContainer.info(
        `Do not refresh compose service ${service} from ${composeFile} because dry-run mode is enabled`,
      );
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
    if (forceRecreate) {
      logContainer.debug(
        `Force recreate requested for ${service}; Docker Engine API path always recreates containers`,
      );
    }

    const recreationContainerSpec = {
      ...currentContainerSpec,
      State: {
        ...currentContainerSpec.State,
        Running: serviceShouldStart,
      },
    };
    // Intentionally bypass Dockercompose.stopAndRemoveContainer() no-op: this
    // internal Engine API refresh path must perform the real stop/remove.
    await super.stopAndRemoveContainer(
      currentContainer,
      currentContainerSpec,
      container,
      logContainer,
    );
    await super.recreateContainer(
      dockerApi,
      recreationContainerSpec,
      newImage,
      container,
      logContainer,
    );
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

    await this.mutateComposeFile(
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
      },
    );

    const composeUpdateOptions = {
      shouldStart: currentContainerSpec?.State?.Running === true,
      skipPull: true,
      forceRecreate: true,
    } as ComposeRuntimeRefreshOptions;
    if (composeFiles.length > 1) {
      composeUpdateOptions.composeFiles = composeFiles;
    }

    await this.refreshComposeServiceWithDockerApi(
      composeFile,
      service,
      container,
      composeUpdateOptions,
    );
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
  hasExplicitRegistryHost as testable_hasExplicitRegistryHost,
  normalizeImplicitLatest as testable_normalizeImplicitLatest,
  normalizePostStartEnvironmentValue as testable_normalizePostStartEnvironmentValue,
  normalizePostStartHooks as testable_normalizePostStartHooks,
  updateComposeServiceImageInText as testable_updateComposeServiceImageInText,
};
