import { execFile } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import yaml, { type Pair, type ParsedNode } from 'yaml';
import { getState } from '../../../registry/index.js';
import { buildComposeCommandEnvironment } from '../../../runtime/child-process-env.js';
import { resolveConfiguredPath, resolveConfiguredPathWithinBase } from '../../../runtime/paths.js';
import { sleep } from '../../../util/sleep.js';
import Docker from '../docker/Docker.js';
import ComposeFileLockManager from './ComposeFileLockManager.js';

const COMPOSE_COMMAND_TIMEOUT_MS = 60_000;
const COMPOSE_COMMAND_MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const YAML_MAX_ALIAS_COUNT = 10_000;
const COMPOSE_RENAME_MAX_RETRIES = 5;
const COMPOSE_RENAME_RETRY_MS = 200;
const COMPOSE_PROJECT_CONFIG_FILES_LABEL = 'com.docker.compose.project.config_files';
const COMPOSE_PROJECT_WORKING_DIR_LABEL = 'com.docker.compose.project.working_dir';
const COMPOSE_CACHE_MAX_ENTRIES = 256;
const POST_START_ENVIRONMENT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
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
  if (composeServiceName && compose.services?.[composeServiceName]) {
    return composeServiceName;
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

function normalizePostStartHooks(postStart) {
  if (!postStart) {
    return [];
  }
  if (Array.isArray(postStart)) {
    return postStart;
  }
  return [postStart];
}

function normalizePostStartCommand(command) {
  if (Array.isArray(command)) {
    return command.map((value) => `${value}`);
  }
  return ['sh', '-c', `${command}`];
}

function normalizePostStartEnvironmentValue(value) {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
  return `${value}`;
}

function validatePostStartEnvironmentKey(key) {
  if (!POST_START_ENVIRONMENT_KEY_PATTERN.test(key)) {
    throw new Error(`Invalid compose post_start environment variable key "${key}"`);
  }
}

function normalizePostStartEnvironment(environment) {
  if (!environment) {
    return undefined;
  }
  if (Array.isArray(environment)) {
    return environment.map((value) => {
      const normalized = `${value}`;
      const separatorIndex = normalized.indexOf('=');
      const key = separatorIndex >= 0 ? normalized.slice(0, separatorIndex) : normalized;
      validatePostStartEnvironmentKey(key);
      return normalized;
    });
  }
  return Object.entries(environment).map(([key, value]) => {
    validatePostStartEnvironmentKey(key);
    return `${key}=${normalizePostStartEnvironmentValue(value)}`;
  });
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

function getLineStartOffset(text, offset) {
  const beforeOffset = Math.max(0, offset - 1);
  return text.lastIndexOf('\n', beforeOffset) + 1;
}

function getLineIndentationAtOffset(text, offset) {
  const lineStart = getLineStartOffset(text, offset);
  return text.slice(lineStart, offset);
}

function getPreferredChildIndentation(parentIndentation) {
  return `${parentIndentation}  `;
}

function getMapPairByKey(
  mapNode: unknown,
  keyName: string,
): Pair<ParsedNode | null, ParsedNode | null> | undefined {
  return (mapNode as { items: Pair<ParsedNode | null, ParsedNode | null>[] }).items.find(
    (pair): pair is Pair<ParsedNode | null, ParsedNode | null> => {
      const pairKeyValue = (pair?.key as { value?: unknown })?.value;
      return `${pairKeyValue}` === keyName;
    },
  );
}

function formatReplacementImageValue(currentImageValueText, newImage) {
  if (currentImageValueText.startsWith("'") && currentImageValueText.endsWith("'")) {
    return `'${newImage.replace(/'/g, "''")}'`;
  }
  if (currentImageValueText.startsWith('"') && currentImageValueText.endsWith('"')) {
    return JSON.stringify(newImage);
  }
  return newImage;
}

function parseComposeDocument(composeFileText) {
  const parseDocumentOptions = {
    keepSourceTokens: true,
    maxAliasCount: YAML_MAX_ALIAS_COUNT,
  };
  const composeDoc = yaml.parseDocument(composeFileText, {
    ...(parseDocumentOptions as unknown as { keepSourceTokens: true }),
  });
  if (composeDoc.errors?.length > 0) {
    throw composeDoc.errors[0];
  }
  return composeDoc;
}

function buildComposeServiceImageTextEdit(composeFileText, composeDoc, serviceName, newImage) {
  const newline = composeFileText.includes('\r\n') ? '\r\n' : '\n';
  const servicesNode = composeDoc.get('services', true);
  if (!yaml.isMap(servicesNode)) {
    throw new Error('Unable to locate services section in compose file');
  }

  const servicePair = getMapPairByKey(servicesNode, serviceName);
  if (!servicePair) {
    throw new Error(`Unable to locate compose service ${serviceName}`);
  }

  const serviceValueNode = servicePair.value;
  if (yaml.isMap(serviceValueNode)) {
    const imagePair = getMapPairByKey(serviceValueNode, 'image');
    if (imagePair) {
      const imageValueRange = imagePair.value!.range!;
      const imageValueStart = imageValueRange[0];
      const imageValueEnd = imageValueRange[1];
      const currentImageValueText = composeFileText.slice(imageValueStart, imageValueEnd);
      const formattedImage = formatReplacementImageValue(currentImageValueText, newImage);
      return {
        start: imageValueStart,
        end: imageValueEnd,
        text: formattedImage,
      };
    }

    if (serviceValueNode?.srcToken?.type === 'flow-collection') {
      throw new Error(
        `Unable to insert compose image for flow-style service ${serviceName} without image key`,
      );
    }
  } else if (!(yaml.isScalar(serviceValueNode) && serviceValueNode.value === null)) {
    throw new Error(`Unable to patch compose service ${serviceName} because it is not a map`);
  }

  const serviceKeyOffset = servicePair.key!.range![0];
  const serviceIndentation = getLineIndentationAtOffset(composeFileText, serviceKeyOffset);
  const imageIndentation = getPreferredChildIndentation(serviceIndentation);
  const lineBreakOffset = composeFileText.indexOf('\n', serviceKeyOffset);

  if (lineBreakOffset >= 0) {
    const insertionOffset = lineBreakOffset + 1;
    return {
      start: insertionOffset,
      end: insertionOffset,
      text: `${imageIndentation}image: ${newImage}${newline}`,
    };
  }

  return {
    start: composeFileText.length,
    end: composeFileText.length,
    text: `${newline}${imageIndentation}image: ${newImage}`,
  };
}

function applyComposeTextEdits(composeFileText, composeTextEdits) {
  const sortedEdits = [...composeTextEdits].sort(
    (left, right) => right.start - left.start || right.end - left.end,
  );
  let lastAppliedStart = composeFileText.length;
  let updatedComposeText = composeFileText;
  for (const composeTextEdit of sortedEdits) {
    if (composeTextEdit.end > lastAppliedStart) {
      throw new Error('Unable to apply overlapping compose edits');
    }
    updatedComposeText = `${updatedComposeText.slice(0, composeTextEdit.start)}${composeTextEdit.text}${updatedComposeText.slice(composeTextEdit.end)}`;
    lastAppliedStart = composeTextEdit.start;
  }
  return updatedComposeText;
}

/**
 * Update only one compose service image line while preserving original
 * formatting, comments, and key ordering elsewhere in the file.
 */
function updateComposeServiceImageInText(
  composeFileText,
  serviceName,
  newImage,
  composeDoc = null,
) {
  const doc = composeDoc || parseComposeDocument(composeFileText);
  const composeTextEdit = buildComposeServiceImageTextEdit(
    composeFileText,
    doc,
    serviceName,
    newImage,
  );
  return applyComposeTextEdits(composeFileText, [composeTextEdit]);
}

function updateComposeServiceImagesInText(composeFileText, serviceImageUpdates, composeDoc = null) {
  if (serviceImageUpdates.size === 0) {
    return composeFileText;
  }
  const doc = composeDoc || parseComposeDocument(composeFileText);
  const composeTextEdits = [];
  for (const [serviceName, newImage] of serviceImageUpdates.entries()) {
    composeTextEdits.push(
      buildComposeServiceImageTextEdit(composeFileText, doc, serviceName, newImage),
    );
  }
  return applyComposeTextEdits(composeFileText, composeTextEdits);
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
  _composeCacheMaxEntries = COMPOSE_CACHE_MAX_ENTRIES;
  _composeObjectCache = new Map<string, { mtimeMs: number; compose: unknown }>();
  _composeDocumentCache = new Map<string, { mtimeMs: number; composeDoc: unknown }>();

  get _composeFileLocksHeld() {
    return this._composeFileLockManager._composeFileLocksHeld;
  }

  /**
   * Get the Trigger configuration schema.
   * @returns {*}
   */
  getConfigurationSchema() {
    const schemaDocker = super.getConfigurationSchema();
    return schemaDocker.append({
      // Make file optional since we now support per-container compose files
      file: this.joi.string().optional(),
      backup: this.joi.boolean().default(false),
      // Add configuration for the label name to look for
      composeFileLabel: this.joi.string().default('dd.compose.file'),
      reconciliationMode: this.joi.string().valid('warn', 'block', 'off').default('warn'),
      digestPinning: this.joi.boolean().default(false),
      composeFileOnce: this.joi.boolean().default(false),
    });
  }

  async initTrigger() {
    // Force mode=batch to avoid docker-compose concurrent operations
    this.configuration.mode = 'batch';

    // Check default docker-compose file exists if specified
    if (this.configuration.file) {
      try {
        await fs.access(this.configuration.file);
      } catch (e) {
        const reason =
          e.code === 'EACCES'
            ? `permission denied (${ROOT_MODE_BREAK_GLASS_HINT})`
            : 'does not exist';
        this.log.error(`The default file ${this.configuration.file} ${reason}`);
        throw e;
      }
    }
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
      } catch (e) {
        this.log.warn(
          `Compose file label ${composeFileLabel} on container ${container.name} is invalid (${e.message})`,
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
    } catch (e) {
      this.log.warn(`Default compose file path is invalid (${e.message})`);
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
      } catch (e) {
        this.log.warn(
          `Compose file label ${COMPOSE_PROJECT_WORKING_DIR_LABEL} on container ${containerName} is invalid (${e.message})`,
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
          composeFiles.add(
            this.resolveComposeFilePath(composeFilePath, {
              label: `Compose file label ${COMPOSE_PROJECT_CONFIG_FILES_LABEL}`,
            }),
          );
        } catch (e) {
          this.log.warn(
            `Compose file label ${COMPOSE_PROJECT_CONFIG_FILES_LABEL} on container ${containerName} is invalid (${e.message})`,
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
    } catch (e) {
      this.log.debug(
        `Unable to inspect compose labels for container ${container.name}; falling back to default compose file resolution (${e.message})`,
      );
      return [];
    }
  }

  async resolveComposeFilesForContainer(container: ComposeContainerReference): Promise<string[]> {
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

    const composeFileFromDefault = this.getDefaultComposeFilePath();
    if (!composeFileFromDefault) {
      return [];
    }
    return [composeFileFromDefault];
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
  ): string {
    if (this.configuration.digestPinning !== true) {
      return runtimeUpdateImage;
    }
    const digestPinningCandidate =
      container?.result?.digest ||
      (container?.updateKind?.kind === 'digest' ? container?.updateKind?.remoteValue : undefined);
    const digestToPin = this.normalizeDigestPinningValue(digestPinningCandidate);
    if (!digestToPin) {
      return runtimeUpdateImage;
    }
    const imageName = this.getImageNameFromReference(runtimeUpdateImage);
    if (!imageName) {
      return runtimeUpdateImage;
    }
    return `${imageName}@${digestToPin}`;
  }

  getContainerRuntimeImageReference(container: RegistryImageContainerReference): string {
    const registry = getState().registry[container.image.registry.name];
    return registry.getImageFullName(container.image, container.image.tag.value);
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
        if (
          existingServiceDefinition &&
          typeof existingServiceDefinition === 'object' &&
          !Array.isArray(existingServiceDefinition) &&
          serviceDefinition &&
          typeof serviceDefinition === 'object' &&
          !Array.isArray(serviceDefinition)
        ) {
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
      if (compose?.services?.[service] !== undefined) {
        filesContainingService.push(composeFile);
      }
    }
    const candidateFiles =
      filesContainingService.length > 0 ? [...filesContainingService].reverse() : [composeFiles[0]];
    let lastAccessError;
    for (const candidateFile of candidateFiles) {
      try {
        await fs.access(candidateFile, fsConstants.W_OK);
        return candidateFile;
      } catch (e) {
        lastAccessError = e;
      }
    }
    if (lastAccessError) {
      throw lastAccessError;
    }
    return composeFiles[0];
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
    } catch (error) {
      return error;
    }
  }

  async handleBusyComposeRenameRetry(error, filePath, attempt) {
    if (error?.code !== 'EBUSY' || attempt >= COMPOSE_RENAME_MAX_RETRIES) {
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
    if (error?.code !== 'EBUSY') {
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

  async validateComposeConfiguration(composeFilePath, composeFileText, options = {}) {
    const composeFileChain = this.normalizeComposeFileChain(
      composeFilePath,
      (options as { composeFiles?: string[] }).composeFiles,
    );
    const effectiveComposeFileChain = composeFileChain.includes(composeFilePath)
      ? composeFileChain
      : [...composeFileChain, composeFilePath];

    const composeDirectory = path.dirname(composeFilePath);
    const composeFileName = path.basename(composeFilePath);
    const validationFilePath = path.join(
      composeDirectory,
      `.${composeFileName}.validate-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );

    await fs.writeFile(validationFilePath, composeFileText);
    const validationArguments = [
      ...effectiveComposeFileChain.flatMap((composeFile) => [
        '-f',
        composeFile === composeFilePath ? validationFilePath : composeFile,
      ]),
      'config',
      '--quiet',
    ];
    const commandsToTry = [
      {
        command: 'docker',
        args: ['compose', ...validationArguments],
        label: 'docker compose',
      },
      {
        command: 'docker-compose',
        args: validationArguments,
        label: 'docker-compose',
      },
    ];

    try {
      for (const composeCommand of commandsToTry) {
        try {
          await this.executeCommand(composeCommand.command, composeCommand.args, {
            cwd: composeDirectory,
            env: buildComposeCommandEnvironment(),
          });
          return;
        } catch (e) {
          const stderr = `${e?.stderr || ''}`;
          const dockerComposePluginMissing =
            composeCommand.command === 'docker' &&
            /docker: ['"]?compose['"]? is not a docker command/i.test(stderr);
          const executableMissing = e?.code === 'ENOENT';

          if (
            composeCommand.command === 'docker' &&
            (dockerComposePluginMissing || executableMissing)
          ) {
            this.log.warn(
              `Cannot use docker compose for compose validation on ${composeFilePath} (${e.message}); trying docker-compose`,
            );
            continue;
          }

          throw new Error(
            `Error when validating compose configuration for ${composeFilePath} using ${composeCommand.label} (${e.message})`,
          );
        }
      }
    } finally {
      await this.cleanupComposeTemporaryFile(validationFilePath);
    }

    throw new Error(`Unable to validate compose configuration for ${composeFilePath}`);
  }

  async updateComposeServicesWithCompose(composeFile, services, options = {}) {
    if (services.length === 0) {
      return;
    }

    const { composeFiles = [composeFile], serviceRunningStates = new Map<string, boolean>() } =
      options as {
        composeFiles?: string[];
        serviceRunningStates?: Map<string, boolean>;
      };
    const composeFileChain = this.normalizeComposeFileChain(composeFile, composeFiles);
    const runWithComposeFileChain = composeFileChain.length > 1;

    const logContainer = this.log.child({
      composeFile,
      services,
    });

    if (this.configuration.dryrun) {
      logContainer.info(
        `Do not refresh compose services ${services.join(', ')} from ${composeFile} because dry-run mode is enabled`,
      );
      return;
    }

    if (runWithComposeFileChain) {
      await this.runComposeCommand(
        composeFile,
        ['pull', ...services],
        logContainer,
        composeFileChain,
      );
    } else {
      await this.runComposeCommand(composeFile, ['pull', ...services], logContainer);
    }

    const servicesToStart: string[] = [];
    const servicesToKeepStopped: string[] = [];
    for (const service of services) {
      if (serviceRunningStates.get(service) === false) {
        servicesToKeepStopped.push(service);
      } else {
        servicesToStart.push(service);
      }
    }

    if (servicesToStart.length > 0) {
      if (runWithComposeFileChain) {
        await this.runComposeCommand(
          composeFile,
          ['up', '-d', '--no-deps', ...servicesToStart],
          logContainer,
          composeFileChain,
        );
      } else {
        await this.runComposeCommand(
          composeFile,
          ['up', '-d', '--no-deps', ...servicesToStart],
          logContainer,
        );
      }
    }
    if (servicesToKeepStopped.length > 0) {
      if (runWithComposeFileChain) {
        await this.runComposeCommand(
          composeFile,
          ['up', '--no-start', '--no-deps', ...servicesToKeepStopped],
          logContainer,
          composeFileChain,
        );
      } else {
        await this.runComposeCommand(
          composeFile,
          ['up', '--no-start', '--no-deps', ...servicesToKeepStopped],
          logContainer,
        );
      }
    }
  }

  async mutateComposeFile(file, updateComposeText, options = {}) {
    return this.withComposeFileLock(file, async (filePath) => {
      const composeFileText = (await this.getComposeFile(filePath)).toString();
      const composeFileStat = await fs.stat(filePath);
      const composeFileChain = this.normalizeComposeFileChain(
        filePath,
        (options as { composeFiles?: string[] }).composeFiles,
      );
      const updatedComposeFileText = updateComposeText(composeFileText, {
        filePath,
        mtimeMs: composeFileStat.mtimeMs,
      });
      if (updatedComposeFileText === composeFileText) {
        return false;
      }
      if (composeFileChain.length > 1) {
        await this.validateComposeConfiguration(filePath, updatedComposeFileText, {
          composeFiles: composeFileChain,
        });
      } else {
        await this.validateComposeConfiguration(filePath, updatedComposeFileText);
      }
      await this.writeComposeFile(filePath, updatedComposeFileText);
      return true;
    });
  }

  /**
   * Override: compose doesn't need to inspect the existing container
   * (compose CLI handles the container lifecycle). Lighter context.
   */
  async createTriggerContext(container, logContainer, _composeContext) {
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
   * Override: use compose CLI for pull/recreate instead of Docker API.
   */
  async performContainerUpdate(_context, container, _logContainer, composeCtx) {
    if (!composeCtx) {
      throw new Error(`Missing compose context for container ${container.name}`);
    }
    if (composeCtx.composeFileOnceApplied === true) {
      const logContainer = this.log.child({
        container: container.name,
      });
      logContainer.info(
        `Skip per-service compose refresh for ${composeCtx.service} because compose-file-once mode already refreshed ${composeCtx.composeFile}`,
      );
    } else {
      if (Array.isArray(composeCtx.composeFiles) && composeCtx.composeFiles.length > 1) {
        await this.updateContainerWithCompose(
          composeCtx.composeFile,
          composeCtx.service,
          container,
          {
            composeFiles: composeCtx.composeFiles,
          },
        );
      } else {
        await this.updateContainerWithCompose(
          composeCtx.composeFile,
          composeCtx.service,
          container,
        );
      }
    }
    await this.runServicePostStartHooks(
      container,
      composeCtx.service,
      composeCtx.serviceDefinition,
    );

    return !this.configuration.dryrun;
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
   * Self-update for compose-managed Drydock service. This must stay in compose
   * lifecycle instead of Docker API recreate to preserve compose ownership.
   */
  async executeSelfUpdate(context, container, logContainer, _operationId, composeCtx) {
    if (!composeCtx) {
      throw new Error(`Missing compose context for self-update container ${container.name}`);
    }

    if (this.configuration.dryrun) {
      logContainer.info('Do not replace the existing container because dry-run mode is enabled');
      return false;
    }

    this.insertContainerImageBackup(context, container);
    if (Array.isArray(composeCtx.composeFiles) && composeCtx.composeFiles.length > 1) {
      await this.updateContainerWithCompose(composeCtx.composeFile, composeCtx.service, container, {
        composeFiles: composeCtx.composeFiles,
      });
    } else {
      await this.updateContainerWithCompose(composeCtx.composeFile, composeCtx.service, container);
    }
    await this.runServicePostStartHooks(
      container,
      composeCtx.service,
      composeCtx.serviceDefinition,
    );
    return true;
  }

  /**
   * Update the container.
   * @param container the container
   * @returns {Promise<void>}
   */
  async trigger(container) {
    await this.triggerBatch([container]);
  }

  /**
   * Update the docker-compose stack.
   * @param containers the containers
   * @returns {Promise<void>}
   */
  async triggerBatch(containers): Promise<unknown[]> {
    // Group containers by their ordered compose file chain
    const containersByComposeFile = new Map<string, ContainersByComposeFileEntry>();

    for (const container of containers) {
      // Filter on containers running on local host
      const watcher = this.getWatcher(container);
      const dockerApi = getDockerApiFromWatcher(watcher);
      if (!dockerApi || dockerApi.modem.socketPath === '') {
        this.log.warn(
          `Cannot update container ${container.name} because not running on local host`,
        );
        continue;
      }

      const composeFiles = await this.resolveComposeFilesForContainer(container);
      if (composeFiles.length === 0) {
        this.log.warn(
          `No compose file found for container ${container.name} (no label '${this.configuration.composeFileLabel}' or '${COMPOSE_PROJECT_CONFIG_FILES_LABEL}' and no default file configured)`,
        );
        continue;
      }

      let missingComposeFile = null as string | null;
      for (const composeFile of composeFiles) {
        try {
          await fs.access(composeFile);
        } catch (e) {
          const reason =
            e.code === 'EACCES'
              ? `permission denied (${ROOT_MODE_BREAK_GLASS_HINT})`
              : 'does not exist';
          this.log.warn(`Compose file ${composeFile} for container ${container.name} ${reason}`);
          missingComposeFile = composeFile;
          break;
        }
      }
      if (missingComposeFile) {
        continue;
      }

      const composeFile = composeFiles[0];
      const composeFileKey = composeFiles.join('\n');

      if (!containersByComposeFile.has(composeFileKey)) {
        containersByComposeFile.set(composeFileKey, {
          composeFile,
          composeFiles,
          containers: [],
        });
      }
      containersByComposeFile.get(composeFileKey).containers.push(container);
    }

    // Process each compose file group
    const batchResults: unknown[] = [];
    for (const {
      composeFile,
      composeFiles,
      containers: containersInFile,
    } of containersByComposeFile.values()) {
      if (composeFiles.length > 1) {
        batchResults.push(
          await this.processComposeFile(composeFile, containersInFile, composeFiles),
        );
      } else {
        batchResults.push(await this.processComposeFile(composeFile, containersInFile));
      }
    }
    return batchResults;
  }

  /**
   * Process a specific compose file with its associated containers.
   * @param composeFile
   * @param containers
   * @returns {Promise<void>}
   */
  async processComposeFile(composeFile, containers, composeFiles = [composeFile]) {
    const composeFileChain = this.normalizeComposeFileChain(composeFile, composeFiles);
    const composeFileChainSummary = composeFileChain.join(', ');
    this.log.info(`Processing compose file: ${composeFileChainSummary}`);
    const composeByFile = new Map<string, unknown>();
    for (const composeFilePath of composeFileChain) {
      composeByFile.set(composeFilePath, await this.getComposeFileAsObject(composeFilePath));
    }
    const compose = await this.getComposeFileChainAsObject(composeFileChain, composeByFile);

    // Filter containers that belong to this compose file
    const containersFiltered = containers.filter((container) =>
      doesContainerBelongToCompose(compose, container),
    );

    if (containersFiltered.length === 0) {
      this.log.warn(`No containers found in compose file ${composeFileChainSummary}`);
      return;
    }

    // [{ container, current: '1.0.0', update: '2.0.0' }, {...}]
    const versionMappings = containersFiltered
      .map((container) => {
        const map = this.mapCurrentVersionToUpdateVersion(compose, container);
        if (!map) {
          return undefined;
        }
        const runtimeImage = this.getContainerRuntimeImageReference(container);
        const composeUpdate = this.getComposeMutationImageReference(container, map.update);
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

    this.reconcileComposeMappings(composeFileChainSummary, versionMappings);

    // Compose mutations are needed when the declared compose image differs from
    // the computed target (tag updates and optional digest pinning paths).
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

    if (mappingsNeedingRuntimeUpdate.length === 0) {
      this.log.info(`All containers in ${composeFileChainSummary} are already up to date`);
      return;
    }

    // Dry-run?
    if (this.configuration.dryrun) {
      if (mappingsNeedingComposeUpdate.length > 0) {
        this.log.info(
          `Do not replace existing docker-compose file ${composeFileChainSummary} (dry-run mode enabled)`,
        );
      }
    } else if (mappingsNeedingComposeUpdate.length > 0) {
      const composeUpdatesByWritableFile = await this.groupComposeUpdatesByWritableFile(
        composeFileChain,
        mappingsNeedingComposeUpdate,
        composeByFile,
      );

      for (const [writableComposeFile, composeUpdates] of composeUpdatesByWritableFile.entries()) {
        // Backup docker-compose file
        if (this.configuration.backup) {
          const backupFile = `${writableComposeFile}.back`;
          await this.backup(writableComposeFile, backupFile);
        }

        // Replace only the targeted compose service image values.
        const serviceImageUpdates = this.buildComposeServiceImageUpdates(composeUpdates);
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
          },
        );
      }
    }

    let composeFileOnceHandledServices = new Set<string>();
    if (
      this.configuration.composeFileOnce === true &&
      this.configuration.dryrun !== true &&
      mappingsNeedingRuntimeUpdate.length > 1
    ) {
      const serviceRunningStates = new Map<string, boolean>();
      const servicesToRefresh: string[] = [];
      for (const { container, service } of mappingsNeedingRuntimeUpdate) {
        if (serviceRunningStates.has(service)) {
          continue;
        }
        const runningStateLogger = this.log.child({
          container: container.name,
        });
        serviceRunningStates.set(
          service,
          await this.getContainerRunningState(container, runningStateLogger),
        );
        servicesToRefresh.push(service);
      }
      await this.updateComposeServicesWithCompose(composeFile, servicesToRefresh, {
        composeFiles: composeFileChain,
        serviceRunningStates,
      });
      composeFileOnceHandledServices = new Set(servicesToRefresh);
      this.log.info(
        `Compose-file-once mode refreshed ${servicesToRefresh.length} service(s) for ${composeFileChainSummary}`,
      );
    }

    // Refresh all containers requiring a runtime update via the shared
    // lifecycle orchestrator (security gate, hooks, prune/backup, events).
    for (const { container, service } of mappingsNeedingRuntimeUpdate) {
      const composeContext = {
        composeFile,
        composeFiles: composeFileChain,
        service,
        serviceDefinition: compose.services[service],
        composeFileOnceApplied: composeFileOnceHandledServices.has(service),
      };
      await this.runContainerUpdateLifecycle(container, composeContext);
    }
  }

  async executeCommand(command, args, options = {}) {
    return new Promise((resolve, reject) => {
      execFile(
        command,
        args,
        {
          ...options,
          timeout: COMPOSE_COMMAND_TIMEOUT_MS,
          maxBuffer: COMPOSE_COMMAND_MAX_BUFFER_BYTES,
        },
        (error, stdout, stderr) => {
          if (error) {
            error.stdout = stdout;
            error.stderr = stderr;
            reject(error);
            return;
          }
          resolve({
            stdout: stdout || '',
            stderr: stderr || '',
          });
        },
      );
    });
  }

  async runComposeCommand(composeFile, composeArgs, logContainer, composeFiles = [composeFile]) {
    const composeFileChain = this.normalizeComposeFileChain(composeFile, composeFiles);
    const composeFilePaths = composeFileChain.map((composeFilePathToResolve) =>
      this.resolveComposeFilePath(composeFilePathToResolve, {
        enforceWorkingDirectoryBoundary: true,
      }),
    );
    const composeFileArgs = composeFilePaths.flatMap((composeFilePath) => ['-f', composeFilePath]);
    const composeWorkingDirectory = path.dirname(composeFilePaths[0]);
    const composeFilePathSummary = composeFilePaths.join(', ');
    const commandsToTry = [
      {
        command: 'docker',
        args: ['compose', ...composeFileArgs, ...composeArgs],
        label: 'docker compose',
      },
      {
        command: 'docker-compose',
        args: [...composeFileArgs, ...composeArgs],
        label: 'docker-compose',
      },
    ];

    for (const composeCommand of commandsToTry) {
      try {
        const { stdout, stderr } = (await this.executeCommand(
          composeCommand.command,
          composeCommand.args,
          {
            cwd: composeWorkingDirectory,
            env: buildComposeCommandEnvironment(),
          },
        )) as { stdout: string; stderr: string };
        if (stdout.trim()) {
          logContainer.debug(
            `${composeCommand.label} ${composeArgs.join(' ')} stdout:\n${stdout.trim()}`,
          );
        }
        if (stderr.trim()) {
          logContainer.debug(
            `${composeCommand.label} ${composeArgs.join(' ')} stderr:\n${stderr.trim()}`,
          );
        }
        return;
      } catch (e) {
        const stderr = `${e?.stderr || ''}`;
        const dockerComposePluginMissing =
          composeCommand.command === 'docker' &&
          /docker: ['"]?compose['"]? is not a docker command/i.test(stderr);
        const executableMissing = e?.code === 'ENOENT';

        if (
          composeCommand.command === 'docker' &&
          (dockerComposePluginMissing || executableMissing)
        ) {
          logContainer.warn(
            `Cannot use docker compose for ${composeFilePathSummary} (${e.message}); trying docker-compose`,
          );
          continue;
        }

        throw new Error(
          `Error when running ${composeCommand.label} ${composeArgs.join(' ')} for ${composeFilePathSummary} (${e.message})`,
        );
      }
    }
  }

  async getContainerRunningState(container, logContainer) {
    try {
      const watcher = this.getWatcher(container);
      const dockerApi = getDockerApiFromWatcher(watcher);
      if (!dockerApi) {
        return true;
      }
      const containerToInspect = dockerApi.getContainer(container.name);
      const containerState = await containerToInspect.inspect();
      return containerState?.State?.Running !== false;
    } catch (e) {
      logContainer.warn(
        `Unable to inspect running state for ${container.name}; assuming running (${e.message})`,
      );
      return true;
    }
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
    const currentServiceImage = mapping?.current || compose?.services?.[service]?.image;
    const targetServiceImage = mapping
      ? this.getComposeMutationImageReference(container, mapping.update)
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
    const logContainer = this.log.child({
      container: container.name,
    });

    const {
      shouldStart = undefined,
      skipPull = false,
      forceRecreate = false,
    } = options as {
      shouldStart?: boolean;
      skipPull?: boolean;
      forceRecreate?: boolean;
      composeFiles?: string[];
    };
    const composeFileChain = this.normalizeComposeFileChain(composeFile, options?.composeFiles);
    const runWithComposeFileChain = composeFileChain.length > 1;

    if (this.configuration.dryrun) {
      logContainer.info(
        `Do not refresh compose service ${service} from ${composeFile} because dry-run mode is enabled`,
      );
      return;
    }

    const serviceShouldStart =
      shouldStart !== undefined
        ? shouldStart
        : await this.getContainerRunningState(container, logContainer);

    logContainer.info(`Refresh compose service ${service} from ${composeFile}`);
    if (!skipPull) {
      if (runWithComposeFileChain) {
        await this.runComposeCommand(
          composeFile,
          ['pull', service],
          logContainer,
          composeFileChain,
        );
      } else {
        await this.runComposeCommand(composeFile, ['pull', service], logContainer);
      }
    } else {
      logContainer.debug(`Skip compose pull for ${service} from ${composeFile}`);
    }

    const upArgs = ['up'];
    if (serviceShouldStart) {
      upArgs.push('-d');
    } else {
      upArgs.push('--no-start');
    }
    upArgs.push('--no-deps');
    if (forceRecreate) {
      upArgs.push('--force-recreate');
    }
    upArgs.push(service);
    if (runWithComposeFileChain) {
      await this.runComposeCommand(composeFile, upArgs, logContainer, composeFileChain);
    } else {
      await this.runComposeCommand(composeFile, upArgs, logContainer);
    }
  }

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
    } as {
      shouldStart: boolean;
      skipPull: boolean;
      forceRecreate: boolean;
      composeFiles?: string[];
    };
    if (composeFiles.length > 1) {
      composeUpdateOptions.composeFiles = composeFiles;
    }

    await this.updateContainerWithCompose(composeFile, service, container, composeUpdateOptions);
  }

  async runServicePostStartHooks(container, serviceKey, service) {
    if (this.configuration.dryrun || !service?.post_start) {
      return;
    }

    const hooks = normalizePostStartHooks(service.post_start);
    if (hooks.length === 0) {
      return;
    }

    const watcher = this.getWatcher(container);
    const dockerApi = getDockerApiFromWatcher(watcher);
    if (!dockerApi) {
      this.log.warn(
        `Skip compose post_start hooks for ${container.name} (${serviceKey}) because watcher Docker API is unavailable`,
      );
      return;
    }
    const containerToUpdate = dockerApi.getContainer(container.name);
    const containerState = await containerToUpdate.inspect();

    if (!containerState?.State?.Running) {
      this.log.info(
        `Skip compose post_start hooks for ${container.name} (${serviceKey}) because container is not running`,
      );
      return;
    }

    for (const hook of hooks) {
      const hookConfiguration = typeof hook === 'string' ? { command: hook } : hook;
      if (!hookConfiguration?.command) {
        this.log.warn(
          `Skip invalid compose post_start hook for ${container.name} (${serviceKey}) because command is missing`,
        );
        // eslint-disable-next-line no-continue
        continue;
      }

      const execOptions = {
        AttachStdout: true,
        AttachStderr: true,
        Cmd: normalizePostStartCommand(hookConfiguration.command),
        User: hookConfiguration.user,
        WorkingDir: hookConfiguration.working_dir,
        Privileged: hookConfiguration.privileged,
        Env: normalizePostStartEnvironment(hookConfiguration.environment),
      };

      this.log.info(`Run compose post_start hook for ${container.name} (${serviceKey})`);

      const exec = await containerToUpdate.exec(execOptions);
      const execStream = await exec.start({
        Detach: false,
        Tty: false,
      });
      if (execStream?.resume) {
        execStream.resume();
      }

      await new Promise((resolve, reject) => {
        if (!execStream?.once) {
          resolve(undefined);
          return;
        }
        const onError = (e) => {
          execStream.removeListener('end', onDone);
          execStream.removeListener('close', onDone);
          reject(e);
        };
        const onDone = () => {
          execStream.removeListener('end', onDone);
          execStream.removeListener('close', onDone);
          execStream.removeListener('error', onError);
          resolve(undefined);
        };
        execStream.once('end', onDone);
        execStream.once('close', onDone);
        execStream.once('error', onError);
      });

      const execResult = await exec.inspect();
      if (execResult.ExitCode !== 0) {
        throw new Error(
          `Compose post_start hook failed for ${container.name} (${serviceKey}) with exit code ${execResult.ExitCode}`,
        );
      }
    }
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
    } catch (e) {
      this.log.warn(`Error when trying to backup file ${file} to ${backupFile} (${e.message})`);
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
    } catch (e) {
      this.log.error(`Error when writing ${filePath} (${e.message})`);
      this.log.debug(e);
      throw e;
    }
  }

  invalidateComposeCaches(filePath) {
    this._composeObjectCache.delete(filePath);
    this._composeDocumentCache.delete(filePath);
  }

  setComposeCacheEntry(cache, filePath, value) {
    if (this._composeCacheMaxEntries < 1) {
      cache.clear();
      return;
    }
    if (cache.has(filePath)) {
      cache.delete(filePath);
    }
    cache.set(filePath, value);
    while (cache.size > this._composeCacheMaxEntries) {
      const oldestCacheKey = cache.keys().next().value;
      if (oldestCacheKey === undefined) {
        break;
      }
      cache.delete(oldestCacheKey);
    }
  }

  getCachedComposeDocument(filePath, mtimeMs, composeFileText) {
    const cachedComposeDocument = this._composeDocumentCache.get(filePath);
    if (cachedComposeDocument && cachedComposeDocument.mtimeMs === mtimeMs) {
      this.setComposeCacheEntry(this._composeDocumentCache, filePath, cachedComposeDocument);
      return cachedComposeDocument.composeDoc;
    }
    const composeDoc = parseComposeDocument(composeFileText);
    this.setComposeCacheEntry(this._composeDocumentCache, filePath, {
      mtimeMs,
      composeDoc,
    });
    return composeDoc;
  }

  /**
   * Read docker-compose file as a buffer.
   * @param file - Optional file path, defaults to configuration file
   * @returns {Promise<Buffer>}
   */
  getComposeFile(file = null) {
    const filePath = this.resolveComposeFilePath(file || this.configuration.file);
    try {
      return fs.readFile(filePath);
    } catch (e) {
      this.log.error(`Error when reading the docker-compose yaml file ${filePath} (${e.message})`);
      throw e;
    }
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
    } catch (e) {
      this.log.error(
        `Error when parsing the docker-compose yaml file ${configuredFilePath} (${e.message})`,
      );
      throw e;
    }
  }
}

export default Dockercompose;

export {
  normalizeImplicitLatest as testable_normalizeImplicitLatest,
  normalizePostStartHooks as testable_normalizePostStartHooks,
  normalizePostStartEnvironmentValue as testable_normalizePostStartEnvironmentValue,
  updateComposeServiceImageInText as testable_updateComposeServiceImageInText,
};
