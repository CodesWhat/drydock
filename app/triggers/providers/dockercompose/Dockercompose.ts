// @ts-nocheck
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'yaml';
import { getState } from '../../../registry/index.js';
import { resolveConfiguredPath } from '../../../runtime/paths.js';
import Docker from '../docker/Docker.js';

const COMPOSE_COMMAND_TIMEOUT_MS = 60_000;
const COMPOSE_COMMAND_MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const COMPOSE_FILE_LOCK_SUFFIX = '.drydock.lock';
const COMPOSE_FILE_LOCK_RETRY_MS = 100;
const COMPOSE_FILE_LOCK_MAX_WAIT_MS = 10_000;
const COMPOSE_FILE_LOCK_STALE_MS = 120_000;
const ROOT_MODE_BREAK_GLASS_HINT =
  'use socket proxy or adjust file permissions/group_add; break-glass root mode requires DD_RUN_AS_ROOT=true + DD_ALLOW_INSECURE_ROOT=true';

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
    return (
      serviceImage === imageToMatch ||
      normalizedServiceImage === imageToMatch ||
      serviceImage.includes(imageToMatch) ||
      normalizedServiceImage.includes(imageToMatch)
    );
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

function normalizePostStartEnvironment(environment) {
  if (!environment) {
    return undefined;
  }
  if (Array.isArray(environment)) {
    return environment.map((value) => `${value}`);
  }
  return Object.entries(environment).map(
    ([key, value]) => `${key}=${normalizePostStartEnvironmentValue(value)}`,
  );
}

function sleep(durationMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
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
  const lineBreakIndex = text.lastIndexOf('\n', beforeOffset);
  return lineBreakIndex < 0 ? 0 : lineBreakIndex + 1;
}

function getLineIndentationAtOffset(text, offset) {
  const lineStart = getLineStartOffset(text, offset);
  return text.slice(lineStart, offset);
}

function getPreferredChildIndentation(parentIndentation) {
  if (parentIndentation.includes('\t')) {
    return `${parentIndentation}\t`;
  }
  return `${parentIndentation}  `;
}

function getMapPairByKey(mapNode, keyName) {
  if (!yaml.isMap(mapNode)) {
    return undefined;
  }
  return mapNode.items.find((pair) => {
    const pairKeyValue = pair?.key?.value ?? pair?.key?.source;
    return `${pairKeyValue}` === keyName;
  });
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

/**
 * Update only one compose service image line while preserving original
 * formatting, comments, and key ordering elsewhere in the file.
 */
function updateComposeServiceImageInText(composeFileText, serviceName, newImage) {
  const newline = composeFileText.includes('\r\n') ? '\r\n' : '\n';
  const composeDoc = yaml.parseDocument(composeFileText, {
    maxAliasCount: 10000,
    keepSourceTokens: true,
    keepNodeTypes: true,
  });
  if (composeDoc.errors?.length > 0) {
    throw composeDoc.errors[0];
  }

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
      const imageValueRange = imagePair?.value?.range;
      if (!Array.isArray(imageValueRange) || imageValueRange.length < 2) {
        throw new Error(`Unable to locate compose image value for service ${serviceName}`);
      }
      const imageValueStart = imageValueRange[0];
      const imageValueEnd = imageValueRange[1];
      const currentImageValueText = composeFileText.slice(imageValueStart, imageValueEnd);
      const formattedImage = formatReplacementImageValue(currentImageValueText, newImage);
      return `${composeFileText.slice(0, imageValueStart)}${formattedImage}${composeFileText.slice(
        imageValueEnd,
      )}`;
    }

    if (serviceValueNode?.srcToken?.type === 'flow-collection') {
      throw new Error(
        `Unable to insert compose image for flow-style service ${serviceName} without image key`,
      );
    }
  } else if (!(yaml.isScalar(serviceValueNode) && serviceValueNode.value === null)) {
    throw new Error(`Unable to patch compose service ${serviceName} because it is not a map`);
  }

  const serviceKeyOffset = servicePair?.key?.range?.[0];
  if (typeof serviceKeyOffset !== 'number') {
    throw new Error(`Unable to locate compose service ${serviceName}`);
  }

  const serviceIndentation = getLineIndentationAtOffset(composeFileText, serviceKeyOffset);
  const imageIndentation = getPreferredChildIndentation(serviceIndentation);
  const lineBreakOffset = composeFileText.indexOf('\n', serviceKeyOffset);

  if (lineBreakOffset >= 0) {
    const insertionOffset = lineBreakOffset + 1;
    return `${composeFileText.slice(0, insertionOffset)}${imageIndentation}image: ${newImage}${newline}${composeFileText.slice(insertionOffset)}`;
  }

  const needsLeadingNewline = composeFileText.length > 0;
  const separator = needsLeadingNewline ? newline : '';
  return `${composeFileText}${separator}${imageIndentation}image: ${newImage}`;
}

function updateComposeServiceImagesInText(composeFileText, serviceImageUpdates) {
  let updatedComposeText = composeFileText;
  for (const [serviceName, newImage] of serviceImageUpdates.entries()) {
    updatedComposeText = updateComposeServiceImageInText(updatedComposeText, serviceName, newImage);
  }
  return updatedComposeText;
}

/**
 * Update a Docker compose stack with an updated one.
 */
class Dockercompose extends Docker {
  /**
   * Per-container compose context stashed by processComposeFile for use
   * inside performContainerUpdate (which runs via the shared lifecycle).
   */
  _composeContextMap = new Map<
    string,
    { composeFile: string; service: string; serviceDefinition: any }
  >();

  _composeFileLocksHeld = new Set<string>();

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

  /**
   * Get the compose file path for a specific container.
   * First checks for a label, then falls back to default configuration.
   * @param container
   * @returns {string|null}
   */
  getComposeFileForContainer(container) {
    // Check if container has a compose file label (dd.* primary, wud.* fallback)
    const composeFileLabel = this.configuration.composeFileLabel;
    const wudFallbackLabel = composeFileLabel.replace(/^dd\./, 'wud.');
    const labelValue = container.labels?.[composeFileLabel] || container.labels?.[wudFallbackLabel];
    if (labelValue) {
      try {
        return resolveConfiguredPath(labelValue, {
          label: `Compose file label ${composeFileLabel}`,
        });
      } catch (e) {
        this.log.warn(
          `Compose file label ${composeFileLabel} on container ${container.name} is invalid (${e.message})`,
        );
        return null;
      }
    }

    // Fall back to default configuration file
    if (!this.configuration.file) {
      return null;
    }
    try {
      return resolveConfiguredPath(this.configuration.file, {
        label: 'Default compose file path',
      });
    } catch (e) {
      this.log.warn(`Default compose file path is invalid (${e.message})`);
      return null;
    }
  }

  buildComposeServiceImageUpdates(mappingsNeedingComposeUpdate) {
    const serviceImageUpdates = new Map<string, string>();
    mappingsNeedingComposeUpdate.forEach(({ service, update }) => {
      const existingUpdate = serviceImageUpdates.get(service);
      if (existingUpdate !== undefined && existingUpdate !== update) {
        throw new Error(
          `Conflicting compose image updates for service ${service} (${existingUpdate} vs ${update})`,
        );
      }
      serviceImageUpdates.set(service, update);
    });
    return serviceImageUpdates;
  }

  async maybeReleaseStaleComposeFileLock(lockFilePath) {
    try {
      const lockFileStats = await fs.stat(lockFilePath);
      const lockAgeMs = Date.now() - lockFileStats.mtimeMs;
      if (lockAgeMs <= COMPOSE_FILE_LOCK_STALE_MS) {
        return false;
      }
      await fs.unlink(lockFilePath);
      this.log.warn(`Removed stale compose file lock ${lockFilePath}`);
      return true;
    } catch (e) {
      if (e?.code === 'ENOENT') {
        return true;
      }
      this.log.warn(`Could not inspect compose file lock ${lockFilePath} (${e.message})`);
      return false;
    }
  }

  async withComposeFileLock(file, operation) {
    const filePath = resolveConfiguredPath(file, {
      label: 'Compose file path',
    });
    if (this._composeFileLocksHeld.has(filePath)) {
      return operation(filePath);
    }

    const lockFilePath = `${filePath}${COMPOSE_FILE_LOCK_SUFFIX}`;
    const lockWaitStartedAt = Date.now();
    while (true) {
      try {
        await fs.writeFile(lockFilePath, `${process.pid}:${Date.now()}\n`, { flag: 'wx' });
        this._composeFileLocksHeld.add(filePath);
        break;
      } catch (e) {
        if (e?.code !== 'EEXIST') {
          throw e;
        }
        const staleLockReleased = await this.maybeReleaseStaleComposeFileLock(lockFilePath);
        if (staleLockReleased) {
          continue;
        }
        if (Date.now() - lockWaitStartedAt >= COMPOSE_FILE_LOCK_MAX_WAIT_MS) {
          throw new Error(`Timed out waiting for compose file lock ${lockFilePath}`);
        }
        await sleep(COMPOSE_FILE_LOCK_RETRY_MS);
      }
    }

    try {
      return await operation(filePath);
    } finally {
      this._composeFileLocksHeld.delete(filePath);
      try {
        await fs.unlink(lockFilePath);
      } catch (e) {
        if (e?.code !== 'ENOENT') {
          this.log.warn(`Could not remove compose file lock ${lockFilePath} (${e.message})`);
        }
      }
    }
  }

  async writeComposeFileAtomic(filePath, data) {
    const composeDirectory = path.dirname(filePath);
    const composeFileName = path.basename(filePath);
    const temporaryFilePath = path.join(
      composeDirectory,
      `.${composeFileName}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    await fs.writeFile(temporaryFilePath, data);
    try {
      await fs.rename(temporaryFilePath, filePath);
    } catch (e) {
      try {
        await fs.unlink(temporaryFilePath);
      } catch {
        // ignore temp cleanup errors to preserve the original write error
      }
      throw e;
    }
  }

  async mutateComposeFile(file, updateComposeText) {
    return this.withComposeFileLock(file, async (filePath) => {
      const composeFileText = (await this.getComposeFile(filePath)).toString();
      const updatedComposeFileText = updateComposeText(composeFileText);
      if (updatedComposeFileText === composeFileText) {
        return false;
      }
      await this.writeComposeFile(filePath, updatedComposeFileText);
      return true;
    });
  }

  /**
   * Override: compose doesn't need to inspect the existing container
   * (compose CLI handles the container lifecycle). Lighter context.
   */
  async createTriggerContext(container, logContainer) {
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
  async performContainerUpdate(_context, container) {
    const composeCtx = this._composeContextMap.get(container.name);
    if (!composeCtx) {
      throw new Error(`Missing compose context for container ${container.name}`);
    }
    await this.updateContainerWithCompose(composeCtx.composeFile, composeCtx.service, container);
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
  async runPreRuntimeUpdateLifecycle(context, container, logContainer) {
    if (this.configuration.dryrun) {
      logContainer.info('Skip prune/backup in compose dry-run mode');
      return;
    }
    await super.runPreRuntimeUpdateLifecycle(context, container, logContainer);
  }

  /**
   * Self-update for compose-managed Drydock service. This must stay in compose
   * lifecycle instead of Docker API recreate to preserve compose ownership.
   */
  async executeSelfUpdate(context, container, logContainer) {
    const composeCtx = this._composeContextMap.get(container.name);
    if (!composeCtx) {
      throw new Error(`Missing compose context for self-update container ${container.name}`);
    }

    if (this.configuration.dryrun) {
      logContainer.info('Do not replace the existing container because dry-run mode is enabled');
      return false;
    }

    this.insertContainerImageBackup(context, container);
    await this.updateContainerWithCompose(composeCtx.composeFile, composeCtx.service, container);
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
  async triggerBatch(containers) {
    // Group containers by their compose file
    const containersByComposeFile = new Map();

    for (const container of containers) {
      // Filter on containers running on local host
      const watcher = this.getWatcher(container);
      if (watcher.dockerApi.modem.socketPath === '') {
        this.log.warn(
          `Cannot update container ${container.name} because not running on local host`,
        );
        continue;
      }

      const composeFile = this.getComposeFileForContainer(container);
      if (!composeFile) {
        this.log.warn(
          `No compose file found for container ${container.name} (no label '${this.configuration.composeFileLabel}' and no default file configured)`,
        );
        continue;
      }

      // Check if compose file exists
      try {
        await fs.access(composeFile);
      } catch (e) {
        const reason =
          e.code === 'EACCES'
            ? `permission denied (${ROOT_MODE_BREAK_GLASS_HINT})`
            : 'does not exist';
        this.log.warn(`Compose file ${composeFile} for container ${container.name} ${reason}`);
        continue;
      }

      if (!containersByComposeFile.has(composeFile)) {
        containersByComposeFile.set(composeFile, []);
      }
      containersByComposeFile.get(composeFile).push(container);
    }

    // Process each compose file group
    for (const [composeFile, containersInFile] of containersByComposeFile) {
      await this.processComposeFile(composeFile, containersInFile);
    }
  }

  /**
   * Process a specific compose file with its associated containers.
   * @param composeFile
   * @param containers
   * @returns {Promise<void>}
   */
  async processComposeFile(composeFile, containers) {
    this.log.info(`Processing compose file: ${composeFile}`);

    const compose = await this.getComposeFileAsObject(composeFile);

    // Filter containers that belong to this compose file
    const containersFiltered = containers.filter((container) =>
      doesContainerBelongToCompose(compose, container),
    );

    if (containersFiltered.length === 0) {
      this.log.warn(`No containers found in compose file ${composeFile}`);
      return;
    }

    // [{ container, current: '1.0.0', update: '2.0.0' }, {...}]
    const versionMappings = containersFiltered
      .map((container) => {
        const map = this.mapCurrentVersionToUpdateVersion(compose, container);
        if (!map) {
          return undefined;
        }
        return { container, ...map };
      })
      .filter((entry) => entry !== undefined);

    // Update containers on:
    // - tag changes (compose file + runtime update), or
    // - digest updates (runtime update only; compose file remains unchanged).
    const mappingsNeedingComposeUpdate = versionMappings.filter(
      ({ container, currentNormalized, updateNormalized }) =>
        container.updateKind?.kind !== 'digest' && currentNormalized !== updateNormalized,
    );
    const mappingsNeedingRuntimeUpdate = versionMappings.filter(
      ({ container, currentNormalized, updateNormalized }) =>
        container.updateAvailable === true ||
        container.updateKind?.kind === 'digest' ||
        currentNormalized !== updateNormalized,
    );

    if (mappingsNeedingRuntimeUpdate.length === 0) {
      this.log.info(`All containers in ${composeFile} are already up to date`);
      return;
    }

    // Dry-run?
    if (this.configuration.dryrun) {
      if (mappingsNeedingComposeUpdate.length > 0) {
        this.log.info(
          `Do not replace existing docker-compose file ${composeFile} (dry-run mode enabled)`,
        );
      }
    } else if (mappingsNeedingComposeUpdate.length > 0) {
      // Backup docker-compose file
      if (this.configuration.backup) {
        const backupFile = `${composeFile}.back`;
        await this.backup(composeFile, backupFile);
      }

      // Replace only the targeted compose service image values.
      const serviceImageUpdates = this.buildComposeServiceImageUpdates(
        mappingsNeedingComposeUpdate,
      );
      await this.mutateComposeFile(composeFile, (composeFileText) =>
        updateComposeServiceImagesInText(composeFileText, serviceImageUpdates),
      );
    }

    // Refresh all containers requiring a runtime update via the shared
    // lifecycle orchestrator (security gate, hooks, prune/backup, events).
    for (const { container, service } of mappingsNeedingRuntimeUpdate) {
      this._composeContextMap.set(container.name, {
        composeFile,
        service,
        serviceDefinition: compose.services[service],
      });
      try {
        await this.runContainerUpdateLifecycle(container);
      } finally {
        this._composeContextMap.delete(container.name);
      }
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

  async runComposeCommand(composeFile, composeArgs, logContainer) {
    const composeFilePath = resolveConfiguredPath(composeFile, {
      label: 'Compose file path',
    });
    const composeWorkingDirectory = path.dirname(composeFilePath);
    const commandsToTry = [
      {
        command: 'docker',
        args: ['compose', '-f', composeFilePath, ...composeArgs],
        label: 'docker compose',
      },
      {
        command: 'docker-compose',
        args: ['-f', composeFilePath, ...composeArgs],
        label: 'docker-compose',
      },
    ];

    for (const composeCommand of commandsToTry) {
      try {
        const { stdout, stderr } = await this.executeCommand(
          composeCommand.command,
          composeCommand.args,
          {
            cwd: composeWorkingDirectory,
            env: process.env,
          },
        );
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
            `Cannot use docker compose for ${composeFilePath} (${e.message}); trying docker-compose`,
          );
          continue;
        }

        throw new Error(
          `Error when running ${composeCommand.label} ${composeArgs.join(' ')} for ${composeFilePath} (${e.message})`,
        );
      }
    }
  }

  async getContainerRunningState(container, logContainer) {
    try {
      const watcher = this.getWatcher(container);
      const { dockerApi } = watcher;
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
    const composeFile = this.getComposeFileForContainer(container);
    if (!composeFile) {
      throw new Error(`No compose file configured for ${container.name}`);
    }

    const compose = await this.getComposeFileAsObject(composeFile);
    const service = getServiceKey(compose, container, currentImage);
    if (!service || !compose?.services?.[service]) {
      throw new Error(
        `Unable to resolve compose service for ${container.name} from ${composeFile}`,
      );
    }

    return { composeFile, compose, service };
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
    };

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
      await this.runComposeCommand(composeFile, ['pull', service], logContainer);
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
    await this.runComposeCommand(composeFile, upArgs, logContainer);
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
    const { composeFile, service } = await this.resolveComposeServiceContext(
      container,
      currentImage,
    );

    await this.mutateComposeFile(composeFile, (composeFileText) =>
      updateComposeServiceImageInText(composeFileText, service, newImage),
    );

    await this.updateContainerWithCompose(composeFile, service, container, {
      shouldStart: currentContainerSpec?.State?.Running === true,
      skipPull: true,
      forceRecreate: true,
    });
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
    const { dockerApi } = watcher;
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
    const filePath = resolveConfiguredPath(file, {
      label: 'Compose file path',
    });
    try {
      await this.withComposeFileLock(filePath, async () => {
        await this.writeComposeFileAtomic(filePath, data);
      });
    } catch (e) {
      this.log.error(`Error when writing ${filePath} (${e.message})`);
      this.log.debug(e);
      throw e;
    }
  }

  /**
   * Read docker-compose file as a buffer.
   * @param file - Optional file path, defaults to configuration file
   * @returns {Promise<any>}
   */
  getComposeFile(file = null) {
    const filePath = resolveConfiguredPath(file || this.configuration.file, {
      label: 'Compose file path',
    });
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
   * @returns {Promise<any>}
   */
  async getComposeFileAsObject(file = null) {
    try {
      return yaml.parse((await this.getComposeFile(file)).toString(), { maxAliasCount: 10000 });
    } catch (e) {
      const filePath = file || this.configuration.file;
      this.log.error(`Error when parsing the docker-compose yaml file ${filePath} (${e.message})`);
      throw e;
    }
  }
}

export default Dockercompose;

export {
  getServiceKey as testable_getServiceKey,
  normalizeImplicitLatest as testable_normalizeImplicitLatest,
  normalizePostStartHooks as testable_normalizePostStartHooks,
  normalizePostStartEnvironmentValue as testable_normalizePostStartEnvironmentValue,
  updateComposeServiceImageInText as testable_updateComposeServiceImageInText,
};
