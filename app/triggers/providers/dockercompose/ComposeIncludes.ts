import path from 'node:path';
import { getErrorMessage } from '../../../util/error.js';

/**
 * Compose `include:` support.
 *
 * Compose never lists included files in a container's
 * `com.docker.compose.project.config_files` label: only the files named on the
 * command line are recorded, and the included files are merged in by the
 * loader. A service defined in an included file is therefore invisible to the
 * file chain built from that label, and its `image:` could not be found or
 * rewritten. This expands the labelled chain with the files it includes,
 * recursively, so the service is found in the file that really defines it.
 *
 * `extends.file` is deliberately not followed. An extending service usually
 * inherits its `image:` from the base service, so rewriting the base file would
 * change every service that extends it, not just the one being updated. Those
 * services keep being refused rather than guessed at.
 */

const MAX_INCLUDE_DEPTH = 8;
const MAX_INCLUDED_FILES = 64;

/**
 * Raw `path` values of a compose document's top-level `include:`. Accepts the
 * short form (`- other.yaml`), the long form (`- path: other.yaml`) and a path
 * list inside the long form (`- path: [a.yaml, b.yaml]`).
 */
export function extractComposeIncludePaths(compose: unknown): string[] {
  const include = (compose as { include?: unknown } | null | undefined)?.include;
  const entries = Array.isArray(include) ? include : include === undefined ? [] : [include];
  const includePaths: string[] = [];
  for (const entry of entries) {
    const rawPath = typeof entry === 'string' ? entry : (entry as { path?: unknown } | null)?.path;
    const rawPaths = Array.isArray(rawPath) ? rawPath : [rawPath];
    for (const candidate of rawPaths) {
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        includePaths.push(candidate.trim());
      }
    }
  }
  return includePaths;
}

type ExpandComposeFilesOptions = {
  composeFiles: string[];
  readCompose: (composeFile: string) => Promise<unknown>;
  /** Translate a host path into the path Drydock sees (bind mount mapping). */
  mapPath: (composeFilePath: string) => string;
  /** Whether Drydock may read and write the path (the same roots the labels are held to). */
  isAllowed: (composeFilePath: string) => boolean;
  warn: (message: string) => void;
};

/**
 * Return `composeFiles` with every file they include, directly or through other
 * included files, placed immediately after the file that includes it. Compose
 * merges later files over earlier ones, so an override file listed after its
 * parent must stay after the parent's includes: the writer edits the last file
 * that defines a service, which is then the one whose value actually wins. The
 * first labelled file stays first because it anchors project-level lookups. An
 * included file that is unreadable, outside the allowed roots or named through
 * an interpolated path is skipped with a warning; its services stay refused.
 */
export async function expandComposeFilesWithIncludes(
  options: ExpandComposeFilesOptions,
): Promise<string[]> {
  const { composeFiles, readCompose, mapPath, isAllowed, warn } = options;
  const expanded: string[] = [];
  const known = new Set(composeFiles);
  let includedCount = 0;
  let capReached = false;

  async function visit(composeFile: string, depth: number): Promise<void> {
    expanded.push(composeFile);
    if (depth >= MAX_INCLUDE_DEPTH) {
      return;
    }
    let compose: unknown;
    try {
      compose = await readCompose(composeFile);
    } catch (error: unknown) {
      warn(
        `Unable to read ${composeFile} while looking for included compose files (${getErrorMessage(error)})`,
      );
      return;
    }
    for (const includePath of extractComposeIncludePaths(compose)) {
      if (capReached) {
        return;
      }
      if (includePath.includes('$')) {
        warn(
          `Ignoring include '${includePath}' in ${composeFile}: interpolated include paths are not resolved`,
        );
        continue;
      }
      const resolved = path.isAbsolute(includePath)
        ? mapPath(includePath)
        : path.resolve(path.dirname(composeFile), includePath);
      if (known.has(resolved)) {
        continue;
      }
      if (!isAllowed(resolved)) {
        warn(
          `Ignoring include '${includePath}' in ${composeFile}: ${resolved} is outside the allowed compose roots`,
        );
        continue;
      }
      if (includedCount >= MAX_INCLUDED_FILES) {
        capReached = true;
        warn(`Stopped following compose includes after ${MAX_INCLUDED_FILES} files`);
        return;
      }
      includedCount++;
      known.add(resolved);
      await visit(resolved, depth + 1);
    }
  }

  for (const composeFile of composeFiles) {
    await visit(composeFile, 0);
  }
  return expanded;
}
