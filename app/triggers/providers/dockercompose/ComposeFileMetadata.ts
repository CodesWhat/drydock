import fs from 'node:fs/promises';
import { getErrorMessage } from '../../../util/error.js';

interface ComposeMetadataLogger {
  warn: (message: string) => void;
  debug: (message: string) => void;
}

const PERMISSION_BITS = 0o7777;

/**
 * Copy permission bits and ownership from an existing file onto a freshly
 * written one (temp file before rename, or a backup copy), so replacing a
 * compose file does not reset its mode or owner.
 *
 * Best effort: a missing source is skipped, and chmod/chown failures (chown
 * needs root or CAP_CHOWN to change ownership) are logged and never fatal.
 */
export async function copyComposeFileMetadata(
  sourcePath: string,
  targetPath: string,
  log: ComposeMetadataLogger,
): Promise<void> {
  let sourceStat;
  try {
    sourceStat = await fs.stat(sourcePath);
  } catch (error: unknown) {
    log.debug(
      `Skip preserving metadata from ${sourcePath}; unable to stat it (${getErrorMessage(error)})`,
    );
    return;
  }

  try {
    await fs.chmod(targetPath, sourceStat.mode & PERMISSION_BITS);
  } catch (error: unknown) {
    log.warn(`Unable to preserve mode of ${sourcePath} (${getErrorMessage(error)})`);
  }

  try {
    await fs.chown(targetPath, sourceStat.uid, sourceStat.gid);
  } catch (error: unknown) {
    log.warn(`Unable to preserve owner of ${sourcePath} (${getErrorMessage(error)})`);
  }
}
