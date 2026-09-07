import type { Stats } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import os from 'node:os';
import yaml from 'yaml';
import { logWarn } from '../../log/warn.js';
import { resolveConfiguredPath } from '../../runtime/paths.js';
import { flattenConfigTree } from './flatten.js';
import { setConfigFileLayer } from './layer.js';

/**
 * Discover, parse and flatten a `drydock.yml` beneath `/config`, then hand
 * the flattened `DD_*` map to `./layer.ts` for `../index.ts` to merge beneath
 * the real environment. `loadConfigFileIntoLayer` runs once, in `../../index.ts`'s
 * (the app entrypoint's) bootstrap, before `../index.ts` is ever reached —
 * not inside a top-level await of `../index.ts` itself, which would run this
 * module's `stat`/`readFile` calls during every one of ~450 test files'
 * import of configuration. A default path that's absent stays silent either
 * way, so the mitigation for that risk (the only syscall on the silent path
 * is a `stat`) still holds for whichever process actually calls this.
 */

const MAX_CONFIG_FILE_SIZE_BYTES = 1024 * 1024;
const DEFAULT_CONFIG_FILE_YML = '/config/drydock.yml';
const DEFAULT_CONFIG_FILE_YAML = '/config/drydock.yaml';

// Pinned rather than left at the library default, so an alias-expansion bomb
// is bounded by our number and not whatever `yaml` ships next.
const CONFIG_FILE_MAX_ALIAS_COUNT = 100;

export interface LoadConfigFileOptions {
  /**
   * Override for the two default discovery paths, `[ymlPath, yamlPath]`.
   * Test-only seam — production always resolves against the real
   * `/config/drydock.yml` / `/config/drydock.yaml`, matching the
   * `MigrateCliIo` injection pattern already used in `../migrate-cli.ts`.
   */
  defaultPaths?: readonly [string, string];
}

interface ResolvedConfigFile {
  path: string;
}

function configFileError(message: string): Error {
  return new Error(message);
}

async function statIfExists(candidatePath: string): Promise<Stats | undefined> {
  try {
    return await stat(candidatePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

async function resolveConfigFile(
  env: Record<string, string | undefined>,
  defaultPaths: readonly [string, string],
): Promise<ResolvedConfigFile | undefined> {
  const override = env.DD_CONFIG_FILE?.trim();
  if (override) {
    const resolvedOverridePath = resolveConfiguredPath(override, { label: 'DD_CONFIG_FILE' });
    const stats = await statIfExists(resolvedOverridePath);
    if (!stats) {
      throw configFileError(
        `DD_CONFIG_FILE points at "${resolvedOverridePath}", which does not exist`,
      );
    }
    return { path: resolvedOverridePath };
  }

  const [ymlPath, yamlPath] = defaultPaths;
  const [ymlStats, yamlStats] = await Promise.all([statIfExists(ymlPath), statIfExists(yamlPath)]);

  if (ymlStats && yamlStats) {
    throw configFileError(
      `Both "${ymlPath}" and "${yamlPath}" exist; remove one, since which one wins is ambiguous`,
    );
  }
  if (ymlStats) {
    return { path: ymlPath };
  }
  if (yamlStats) {
    return { path: yamlPath };
  }
  return undefined;
}

function checkConfigFilePermissions(resolvedPath: string, stats: Stats): void {
  // Mode bits are synthetic on Windows and don't reflect ACL-based access
  // control, same reasoning as replaceSecrets's identical skip in ../index.ts.
  if (os.platform() === 'win32') {
    return;
  }

  const modeOctal = (stats.mode & 0o777).toString(8).padStart(3, '0');

  if ((stats.mode & 0o022) !== 0) {
    throw configFileError(
      `Config file "${resolvedPath}" is group- or world-writable (mode 0${modeOctal}). ` +
        `Any local process in that group, or any local process at all, could rewrite it ` +
        `between two starts. Restrict permissions with: chmod 600 "${resolvedPath}"`,
    );
  }

  if ((stats.mode & 0o044) !== 0) {
    logWarn(
      `Config file "${resolvedPath}" is readable by group or others ` +
        `(mode 0${modeOctal}). Restrict permissions with: chmod 600 "${resolvedPath}"`,
    );
  }
}

export async function loadConfigFile(
  env: Record<string, string | undefined> = process.env,
  options: LoadConfigFileOptions = {},
): Promise<Record<string, string>> {
  const defaultPaths = options.defaultPaths ?? [DEFAULT_CONFIG_FILE_YML, DEFAULT_CONFIG_FILE_YAML];
  const resolved = await resolveConfigFile(env, defaultPaths);
  if (!resolved) {
    return {};
  }

  const { path: resolvedPath } = resolved;

  // Discovery above only decides which path to use; every check that gates
  // what actually gets read runs against the same open handle below, so
  // nothing about the file (its target, size, or permissions) can change
  // between the check and the read.
  const handle = await open(resolvedPath, 'r');
  let raw: string;
  try {
    const stats = await handle.stat();

    if (!stats.isFile()) {
      throw configFileError(`Config file "${resolvedPath}" must be a regular file`);
    }
    if (stats.size > MAX_CONFIG_FILE_SIZE_BYTES) {
      throw configFileError(
        `Config file "${resolvedPath}" exceeds maximum size of ${MAX_CONFIG_FILE_SIZE_BYTES} bytes`,
      );
    }

    checkConfigFilePermissions(resolvedPath, stats);

    raw = await handle.readFile({ encoding: 'utf-8' });
  } finally {
    await handle.close();
  }

  let parsed: unknown;
  try {
    parsed = yaml.parse(raw, {
      uniqueKeys: true,
      merge: false,
      maxAliasCount: CONFIG_FILE_MAX_ALIAS_COUNT,
    });
  } catch (error) {
    throw configFileError(
      `Config file "${resolvedPath}" is not valid YAML: ${(error as Error).message}`,
    );
  }

  try {
    return flattenConfigTree(parsed);
  } catch (error) {
    throw configFileError(`Config file "${resolvedPath}": ${(error as Error).message}`);
  }
}

/**
 * `loadConfigFile` plus the `setConfigFileLayer` call that publishes its
 * result to `./layer.ts`. This is the only function `app/index.ts`'s
 * bootstrap calls — everything else in this module exists to support it (or
 * `loader.test.ts`, which exercises the pieces directly against real temp
 * files).
 */
export async function loadConfigFileIntoLayer(
  env: Record<string, string | undefined> = process.env,
  options: LoadConfigFileOptions = {},
): Promise<void> {
  setConfigFileLayer(await loadConfigFile(env, options));
}
