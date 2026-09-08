import type Dockerode from 'dockerode';

export const PODMAN_COMPAT_DOCS_URL =
  'https://getdrydock.com/docs/configuration/watchers#known-limitations-and-tested-versions';

interface DockerVersionComponent {
  Name?: unknown;
}

interface DockerVersionPayload {
  Version?: unknown;
  Components?: unknown;
  Platform?: unknown;
}

export interface PodmanDetectionResult {
  isPodman: boolean;
  podmanVersion?: string;
}

/**
 * Inspect a `GET /version` payload (Dockerode's `dockerApi.version()`
 * response) for signs of Podman's Docker-compatible API.
 *
 * Podman reports itself two ways, and different Podman releases have been
 * observed to populate only one of them: a `Components` entry whose `Name`
 * starts with "Podman", and/or a `Platform.Name` containing "Podman".
 * Either is treated as sufficient. A malformed or missing `Components`/
 * `Platform` field (real Docker doesn't send `Platform` on older API
 * versions) is tolerated rather than throwing.
 */
export function detectPodmanFromVersionPayload(payload: unknown): PodmanDetectionResult {
  if (!payload || typeof payload !== 'object') {
    return { isPodman: false };
  }

  const { Components, Platform, Version } = payload as DockerVersionPayload;

  const hasPodmanComponent =
    Array.isArray(Components) &&
    Components.some((component: DockerVersionComponent) => {
      return typeof component?.Name === 'string' && component.Name.startsWith('Podman');
    });

  const platformName =
    Platform && typeof Platform === 'object' ? (Platform as { Name?: unknown }).Name : undefined;
  const hasPodmanPlatform = typeof platformName === 'string' && platformName.includes('Podman');

  if (!hasPodmanComponent && !hasPodmanPlatform) {
    return { isPodman: false };
  }

  return {
    isPodman: true,
    podmanVersion: typeof Version === 'string' ? Version : undefined,
  };
}

export interface PodmanDetectionWatcher {
  dockerApi: Pick<Dockerode, 'version'>;
  isPodman?: boolean;
  podmanVersion?: string;
  log: { warn: (message: string) => void };
}

/**
 * Detect Podman at watcher init and record `isPodman`/`podmanVersion` on
 * the watcher — not surfaced in any API response yet, just data for future
 * API/UI work to read. Best-effort: a failed `version()` call (e.g. a
 * blocked remote watcher) leaves both fields unset rather than throwing,
 * matching `detectLocalDaemonServerName`'s best-effort contract in
 * docker-remote-auth.ts. Docker itself never triggers the warning. Warns
 * only on the transition into Podman, not on every call, so a second
 * `detectPodmanCompatibility` on a watcher that was already Podman doesn't
 * re-log the same warning.
 */
export async function detectPodmanCompatibility(watcher: PodmanDetectionWatcher): Promise<void> {
  if (typeof watcher.dockerApi?.version !== 'function') {
    return;
  }

  let payload: unknown;
  try {
    payload = await watcher.dockerApi.version();
  } catch {
    return;
  }

  const wasPodman = watcher.isPodman === true;
  const { isPodman, podmanVersion } = detectPodmanFromVersionPayload(payload);
  watcher.isPodman = isPodman;
  watcher.podmanVersion = podmanVersion;

  if (isPodman && !wasPodman) {
    watcher.log.warn(
      `Podman detected (${podmanVersion ?? 'unknown version'}): Drydock uses the Docker-compatible API; ` +
        'known limits: rootless networking, volume driver differences, containers managed by a systemd ' +
        'unit (Quadlet) are recreated by the Docker action outside their unit — exclude them from actions ' +
        `or use a command action that restarts the unit instead. See ${PODMAN_COMPAT_DOCS_URL}`,
    );
  }
}
