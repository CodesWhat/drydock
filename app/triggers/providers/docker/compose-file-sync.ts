/**
 * Compose file sync for the Docker trigger.
 *
 * When the Docker trigger updates a compose-managed container with a tag
 * change, this module updates the image tag in the compose file so that
 * subsequent `docker-compose up` commands don't revert the update.
 *
 * GitHub Discussion #178
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import { updateComposeServiceImageInText } from '../dockercompose/ComposeFileParser.js';
import {
  type DockerApiBindMountInspector,
  getSelfContainerBindMounts,
  mapComposePathToContainerBindMount,
} from '../dockercompose/ComposePathBindMounts.js';

const COMPOSE_PROJECT_CONFIG_FILES_LABEL = 'com.docker.compose.project.config_files';
const COMPOSE_PROJECT_WORKING_DIR_LABEL = 'com.docker.compose.project.working_dir';
const COMPOSE_SERVICE_LABEL = 'com.docker.compose.service';

interface ComposeFileSyncOptions {
  dockerApi?: DockerApiBindMountInspector;
  labels: Record<string, string> | undefined;
  newImage: string;
  logContainer: {
    info: (message: string) => void;
    warn: (message: string) => void;
    debug: (message: string) => void;
  };
  selfContainerIdentifier?: string;
}

async function resolveComposeFilePath(
  configFilesLabel: string,
  workingDirLabel: string | undefined,
  options: Pick<ComposeFileSyncOptions, 'dockerApi' | 'logContainer' | 'selfContainerIdentifier'>,
): Promise<string> {
  const firstFile = configFilesLabel.split(',')[0].trim();
  if (!firstFile) {
    return '';
  }
  const resolvedComposeFilePath =
    workingDirLabel && !path.isAbsolute(firstFile)
      ? path.resolve(workingDirLabel, firstFile)
      : firstFile;

  if (!path.isAbsolute(resolvedComposeFilePath) || !options.dockerApi) {
    return resolvedComposeFilePath;
  }

  try {
    const bindMounts = await getSelfContainerBindMounts(
      options.dockerApi,
      options.selfContainerIdentifier,
    );
    return mapComposePathToContainerBindMount(resolvedComposeFilePath, bindMounts);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    options.logContainer.debug(
      `Unable to inspect bind mounts for compose file sync path remapping (${message})`,
    );
    return resolvedComposeFilePath;
  }
}

async function writeComposeFileAtomic(
  filePath: string,
  data: string,
  logContainer: ComposeFileSyncOptions['logContainer'],
): Promise<void> {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmpPath = path.join(
    dir,
    `.${base}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );

  await fs.writeFile(tmpPath, data);

  try {
    await fs.rename(tmpPath, filePath);
  } catch {
    // Rename can fail on Docker bind mounts (EBUSY); fall back to direct overwrite
    logContainer.debug(`Atomic rename failed for ${filePath}; falling back to direct overwrite`);
    try {
      await fs.writeFile(filePath, data);
    } catch (writeError: unknown) {
      // Clean up temp file before propagating
      await fs.unlink(tmpPath).catch(() => {});
      throw writeError;
    }
    await fs.unlink(tmpPath).catch(() => {});
  }
}

/**
 * Sync the image tag in the compose file after a Docker trigger update.
 *
 * Returns true if the compose file was updated, false if skipped or on error.
 * Errors are logged as warnings — a compose sync failure should never block
 * an otherwise successful container update.
 */
export async function syncComposeFileTag(options: ComposeFileSyncOptions): Promise<boolean> {
  const { labels, newImage, logContainer } = options;

  if (!labels) {
    return false;
  }

  const configFilesLabel = labels[COMPOSE_PROJECT_CONFIG_FILES_LABEL];
  const serviceName = labels[COMPOSE_SERVICE_LABEL];

  if (!configFilesLabel || !serviceName) {
    return false;
  }

  const workingDir = labels[COMPOSE_PROJECT_WORKING_DIR_LABEL];
  const composeFilePath = await resolveComposeFilePath(configFilesLabel, workingDir, options);

  if (!composeFilePath) {
    return false;
  }

  try {
    const composeText = await fs.readFile(composeFilePath, 'utf8');
    const updatedText = updateComposeServiceImageInText(composeText, serviceName, newImage);

    if (updatedText === composeText) {
      logContainer.debug(`Compose file ${composeFilePath} already has image ${newImage}`);
      return false;
    }

    await writeComposeFileAtomic(composeFilePath, updatedText, logContainer);
    logContainer.info(
      `Updated compose file ${composeFilePath} service '${serviceName}' to ${newImage}`,
    );
    return true;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logContainer.warn(
      `Unable to sync compose file ${composeFilePath} for service '${serviceName}' (${message})`,
    );
    return false;
  }
}
