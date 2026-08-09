import path from 'node:path';
import ComposeFileParser from '../triggers/providers/dockercompose/ComposeFileParser.js';
import {
  type DockerApiBindMountInspector,
  getSelfContainerBindMounts,
  type HostToContainerBindMount,
  mapComposePathToContainerBindMount,
} from '../triggers/providers/dockercompose/ComposePathBindMounts.js';

/**
 * Read-only compose `depends_on` detection (#219, Phase 6.1).
 *
 * Reuses `ComposeFileParser` (the same cached, ReDoS-safe YAML parser the
 * `dockercompose` action trigger uses to read/patch compose files) so
 * dependency detection never re-implements compose-file parsing. This module
 * only READS the file to discover a service's `depends_on` key — it never
 * writes, and it works whether or not a `dockercompose` trigger is
 * configured, since the compose project/service/config-files labels are set
 * by `docker compose` itself, independent of drydock's trigger config.
 *
 * Scope: only the standard `com.docker.compose.project.config_files` (+
 * `com.docker.compose.project.working_dir`) labels are consulted to locate
 * the compose file. The legacy trigger-configured compose-file label and the
 * single-default-file fallback that `Dockercompose.ts` supports are
 * trigger-configuration concerns that don't apply outside a configured
 * trigger, so they're intentionally not replicated here.
 *
 * Host-path translation: the compose project labels always hold the HOST's
 * view of the compose file path, set by `docker compose` itself — when
 * drydock runs containerized, that path doesn't exist inside drydock's own
 * filesystem unless it's also bind-mounted in. This reuses the same
 * self-container bind-mount inspection `Dockercompose.ts` uses
 * (`getSelfContainerBindMounts` / `mapComposePathToContainerBindMount` from
 * `ComposePathBindMounts.ts`) to translate each label path to its
 * in-container equivalent before reading, so detection doesn't silently
 * no-op behind an ENOENT. A path with no matching bind mount is left
 * untouched (graceful degradation, same as the trigger's own behavior).
 */

const COMPOSE_PROJECT_CONFIG_FILES_LABEL = 'com.docker.compose.project.config_files';
const COMPOSE_PROJECT_WORKING_DIR_LABEL = 'com.docker.compose.project.working_dir';
const COMPOSE_SERVICE_LABEL = 'com.docker.compose.service';

export interface ComposeDependsOnResult {
  dependsOn: string[];
  warnings: string[];
}

interface ComposeServiceDefinition {
  depends_on?: unknown;
}

interface ParsedComposeFile {
  services?: Record<string, ComposeServiceDefinition>;
}

const defaultComposeFileParser = new ComposeFileParser({
  resolveComposeFilePath: (file: string) => path.resolve(file),
});

// The self (drydock) container's own bind mounts never change for the life
// of the process, so — same as `Dockercompose.ts`'s instance-level cache —
// they're fetched at most once per `dockerApi` instance rather than on every
// container's dependency resolution. Cached by dockerApi identity (via
// WeakMap) so injected fakes in tests never share state across cases, and a
// failed inspect caches to `[]` rather than retrying every call.
const selfContainerBindMountsByDockerApi = new WeakMap<
  DockerApiBindMountInspector,
  Promise<HostToContainerBindMount[]>
>();

function loadSelfContainerBindMounts(
  dockerApi: DockerApiBindMountInspector | undefined,
): Promise<HostToContainerBindMount[]> {
  if (!dockerApi) {
    return Promise.resolve([]);
  }
  const cached = selfContainerBindMountsByDockerApi.get(dockerApi);
  if (cached) {
    return cached;
  }
  const bindMountsPromise = getSelfContainerBindMounts(dockerApi).catch(() => []);
  selfContainerBindMountsByDockerApi.set(dockerApi, bindMountsPromise);
  return bindMountsPromise;
}

function getComposeFilePathsForContainer(labels: Record<string, string> | undefined): string[] {
  const configFilesLabel = labels?.[COMPOSE_PROJECT_CONFIG_FILES_LABEL];
  if (!configFilesLabel) {
    return [];
  }
  const workingDirectory = labels?.[COMPOSE_PROJECT_WORKING_DIR_LABEL];
  return configFilesLabel
    .split(',')
    .map((filePath) => filePath.trim())
    .filter((filePath) => filePath.length > 0)
    .map((filePath) =>
      workingDirectory && !path.isAbsolute(filePath)
        ? path.resolve(workingDirectory, filePath)
        : filePath,
    );
}

/**
 * Flatten compose `depends_on` short form (`[a, b]`) and long form
 * (`{a: {condition: service_healthy}, b: {}}`) into a plain name list.
 * v1.7 ignores the `condition` key entirely (non-goal, see design §7).
 */
function flattenDependsOn(rawDependsOn: unknown): string[] {
  if (Array.isArray(rawDependsOn)) {
    return rawDependsOn.filter((value): value is string => typeof value === 'string');
  }
  if (rawDependsOn && typeof rawDependsOn === 'object') {
    return Object.keys(rawDependsOn as Record<string, unknown>);
  }
  return [];
}

/**
 * Resolve a compose-managed container's `depends_on` service names from its
 * already-authored compose file. Returns an empty `dependsOn` (never throws)
 * when the container isn't compose-managed, the compose file can't be
 * located/read, or the service defines no `depends_on`.
 *
 * Self-references and target names not defined as a service in the same
 * compose file are dropped here, with a warning message returned for the
 * caller to log — this is a purely static check against the compose file's
 * own service map and doesn't require any other discovered containers.
 * Cross-fleet validation (unknown live target, cross-agent edges) is a
 * separate concern handled later by the graph engine
 * (`app/dependencies/dependency-graph.ts`), which has the full container list.
 */
export async function resolveComposeDependsOn(
  container: { labels?: Record<string, string> },
  options: {
    composeFileParser?: Pick<ComposeFileParser, 'getComposeFileAsObject'>;
    dockerApi?: DockerApiBindMountInspector;
  } = {},
): Promise<ComposeDependsOnResult> {
  const labels = container.labels;
  const serviceName = labels?.[COMPOSE_SERVICE_LABEL];
  if (!serviceName) {
    return { dependsOn: [], warnings: [] };
  }

  const labelComposeFilePaths = getComposeFilePathsForContainer(labels);
  if (labelComposeFilePaths.length === 0) {
    return { dependsOn: [], warnings: [] };
  }

  const selfContainerBindMounts = await loadSelfContainerBindMounts(options.dockerApi);
  const composeFilePaths = labelComposeFilePaths.map((filePath) =>
    mapComposePathToContainerBindMount(filePath, selfContainerBindMounts),
  );

  const composeFileParser = options.composeFileParser || defaultComposeFileParser;
  const warnings: string[] = [];

  // `docker compose -f a.yml -f b.yml` merges every file in config_files
  // into one project. Per compose merge semantics, `depends_on` is a mapping
  // (short-form arrays are normalized to it too), so entries declared for
  // the same service across multiple files are UNIONED, not overridden by
  // the last file. Read every file (keeping the read-failure warning +
  // continue), union `knownServiceNames` across all of them, and union the
  // normalized depends_on targets from every file that declares the service.
  const knownServiceNames = new Set<string>();
  const readFilePaths: string[] = [];
  const rawNames: string[] = [];
  const seenRawNames = new Set<string>();
  let serviceFound = false;

  for (const composeFilePath of composeFilePaths) {
    let compose: ParsedComposeFile;
    try {
      compose = (await composeFileParser.getComposeFileAsObject(
        composeFilePath,
      )) as ParsedComposeFile;
    } catch {
      // ComposeFileParser already logs the read/parse error internally.
      warnings.push(
        `Unable to read compose file "${composeFilePath}" for dependency detection of service "${serviceName}"`,
      );
      continue;
    }

    readFilePaths.push(composeFilePath);
    for (const name of Object.keys(compose?.services ?? {})) {
      knownServiceNames.add(name);
    }

    const service = compose?.services?.[serviceName];
    if (!service) {
      continue;
    }
    serviceFound = true;

    for (const targetName of flattenDependsOn(service.depends_on)) {
      if (!seenRawNames.has(targetName)) {
        seenRawNames.add(targetName);
        rawNames.push(targetName);
      }
    }
  }

  if (readFilePaths.length === 0) {
    // Every configured compose file was unreadable — depends_on detection is
    // fully disabled for this container. The per-file warnings above are
    // easy to lose in the noise, so add one explicit summary naming every
    // path tried; this is the most common signal of an untranslated
    // host-path bind mount when drydock runs containerized.
    warnings.push(
      `Compose dependency detection for service "${serviceName}" is disabled: none of the configured compose files could be read (tried: ${composeFilePaths.join(', ')}). If drydock is running in a container, verify the compose file's host path is bind-mounted into it.`,
    );
    return { dependsOn: [], warnings };
  }

  if (!serviceFound || rawNames.length === 0) {
    return { dependsOn: [], warnings };
  }

  const fileList = readFilePaths.join(', ');
  const dependsOn: string[] = [];
  for (const targetName of rawNames) {
    if (targetName === serviceName) {
      warnings.push(
        `Compose service "${serviceName}" lists itself in "depends_on" (${fileList}) — self-reference dropped.`,
      );
      continue;
    }
    if (!knownServiceNames.has(targetName)) {
      warnings.push(
        `Compose service "${serviceName}" depends on unknown service "${targetName}" not defined in ${fileList} — edge dropped.`,
      );
      continue;
    }
    dependsOn.push(targetName);
  }

  return { dependsOn, warnings };
}
