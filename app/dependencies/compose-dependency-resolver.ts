import path from 'node:path';
import ComposeFileParser from '../triggers/providers/dockercompose/ComposeFileParser.js';

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
  options: { composeFileParser?: Pick<ComposeFileParser, 'getComposeFileAsObject'> } = {},
): Promise<ComposeDependsOnResult> {
  const labels = container.labels;
  const serviceName = labels?.[COMPOSE_SERVICE_LABEL];
  if (!serviceName) {
    return { dependsOn: [], warnings: [] };
  }

  const composeFilePaths = getComposeFilePathsForContainer(labels);
  if (composeFilePaths.length === 0) {
    return { dependsOn: [], warnings: [] };
  }

  const composeFileParser = options.composeFileParser || defaultComposeFileParser;
  const warnings: string[] = [];

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

    const service = compose?.services?.[serviceName];
    if (!service) {
      continue;
    }

    const rawNames = flattenDependsOn(service.depends_on);
    if (rawNames.length === 0) {
      return { dependsOn: [], warnings };
    }

    // compose.services is guaranteed defined here — `service` was already
    // read from it above.
    const knownServiceNames = new Set(Object.keys(compose.services as Record<string, unknown>));
    const dependsOn: string[] = [];
    for (const targetName of rawNames) {
      if (targetName === serviceName) {
        warnings.push(
          `Compose service "${serviceName}" lists itself in "depends_on" (${composeFilePath}) — self-reference dropped.`,
        );
        continue;
      }
      if (!knownServiceNames.has(targetName)) {
        warnings.push(
          `Compose service "${serviceName}" depends on unknown service "${targetName}" not defined in ${composeFilePath} — edge dropped.`,
        );
        continue;
      }
      dependsOn.push(targetName);
    }

    return { dependsOn, warnings };
  }

  return { dependsOn: [], warnings };
}
