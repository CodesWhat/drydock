import path from 'node:path';

const SELF_CONTAINER_IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

export type HostToContainerBindMount = {
  source: string;
  destination: string;
};

export interface DockerApiBindMountInspector {
  getContainer: (containerName: string) => {
    inspect: () => Promise<{
      HostConfig?: {
        Binds?: string[];
      };
    }>;
  };
}

export function parseHostToContainerBindMount(
  bindDefinition: string,
): HostToContainerBindMount | null {
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

export function getSelfContainerIdentifier(hostname = process.env.HOSTNAME): string | null {
  const normalizedHostname = hostname?.trim();
  if (!normalizedHostname || !SELF_CONTAINER_IDENTIFIER_PATTERN.test(normalizedHostname)) {
    return null;
  }
  return normalizedHostname;
}

export async function getSelfContainerBindMounts(
  dockerApi: DockerApiBindMountInspector | undefined,
  selfContainerIdentifier = getSelfContainerIdentifier(),
): Promise<HostToContainerBindMount[]> {
  if (!dockerApi || !selfContainerIdentifier) {
    return [];
  }

  const selfContainerInspect = await dockerApi.getContainer(selfContainerIdentifier).inspect();
  const bindDefinitions = selfContainerInspect?.HostConfig?.Binds;
  if (!Array.isArray(bindDefinitions)) {
    return [];
  }

  return bindDefinitions
    .map((bindDefinition) => parseHostToContainerBindMount(bindDefinition))
    .filter((bindMount): bindMount is HostToContainerBindMount => bindMount !== null)
    .sort((left, right) => right.source.length - left.source.length);
}

export function mapComposePathToContainerBindMount(
  composeFilePath: string,
  bindMounts: readonly HostToContainerBindMount[],
): string {
  if (!path.isAbsolute(composeFilePath) || bindMounts.length === 0) {
    return composeFilePath;
  }
  const normalizedComposeFilePath = path.resolve(composeFilePath);

  for (const bindMount of bindMounts) {
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
