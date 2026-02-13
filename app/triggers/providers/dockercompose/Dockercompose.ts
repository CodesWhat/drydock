// @ts-nocheck
import fs from 'node:fs/promises';
import yaml from 'yaml';
import { getState } from '../../../registry/index.js';
import { resolveConfiguredPath } from '../../../runtime/paths.js';
import Docker from '../docker/Docker.js';

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

/**
 * Update a Docker compose stack with an updated one.
 */
class Dockercompose extends Docker {
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
            ? 'permission denied (run as root or adjust file permissions)'
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
            ? 'permission denied (run as root or adjust file permissions)'
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

    // Only update/trigger containers where the compose image actually changes.
    const mappingsNeedingUpdate = versionMappings.filter(
      ({ currentNormalized, updateNormalized }) => currentNormalized !== updateNormalized,
    );

    if (mappingsNeedingUpdate.length === 0) {
      this.log.info(`All containers in ${composeFile} are already up to date`);
      return;
    }

    // Dry-run?
    if (this.configuration.dryrun) {
      this.log.info(
        `Do not replace existing docker-compose file ${composeFile} (dry-run mode enabled)`,
      );
    } else {
      // Backup docker-compose file
      if (this.configuration.backup) {
        const backupFile = `${composeFile}.back`;
        await this.backup(composeFile, backupFile);
      }

      // Read the compose file as a string
      let composeFileStr = (await this.getComposeFile(composeFile)).toString();

      // Replace only versions requiring updates
      mappingsNeedingUpdate.forEach(({ current, update }) => {
        composeFileStr = composeFileStr.replaceAll(current, update);
      });

      // Write docker-compose.yml file back
      await this.writeComposeFile(composeFile, composeFileStr);
    }

    // Update only containers requiring an image change
    // (super.notify will take care of the dry-run mode for each container as well)
    await Promise.all(
      mappingsNeedingUpdate.map(async ({ container, service }) => {
        await super.trigger(container);
        await this.runServicePostStartHooks(container, service, compose.services[service]);
      }),
    );
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
      await fs.writeFile(filePath, data);
    } catch (e) {
      this.log.error(`Error when writing ${filePath} (${e.message})`);
      this.log.debug(e);
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
};
