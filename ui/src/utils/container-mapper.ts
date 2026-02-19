/**
 * Maps API container objects to the UI Container type used by templates.
 *
 * API shape (from /api/containers):
 *   id, name, displayName, status, watcher, agent,
 *   image: { registry: { name, url }, name, tag: { value }, ... },
 *   result?: { tag, digest, ... },
 *   updateAvailable, updateKind: { kind, semverDiff, ... },
 *   security?: { scan?: { status, blockingCount, summary, ... } },
 *   labels?: Record<string, string>
 *
 * UI shape (what templates expect):
 *   id, name, image, currentTag, newTag, status, registry, updateKind,
 *   bouncer, server, details: { ports, volumes, env, labels }
 */

import type { Container } from '../types/container';

/** Derive a human-readable server/host name from watcher + agent fields. */
function deriveServer(apiContainer: any): string {
  if (apiContainer.agent) {
    return apiContainer.agent;
  }
  return 'Local';
}

/** Map the API registry name to the UI registry category. */
function deriveRegistry(apiContainer: any): 'dockerhub' | 'ghcr' | 'custom' {
  const registryName = apiContainer.image?.registry?.name ?? '';
  const registryUrl = apiContainer.image?.registry?.url ?? '';

  if (registryName === 'hub' || registryUrl.includes('docker.io')) return 'dockerhub';
  if (registryName === 'ghcr' || registryUrl.includes('ghcr.io')) return 'ghcr';
  return 'custom';
}

/** Derive bouncer status from security scan data. */
function deriveBouncer(apiContainer: any): 'safe' | 'unsafe' | 'blocked' {
  const scan = apiContainer.security?.scan;
  if (!scan) return 'safe';
  if (scan.status === 'blocked') return 'blocked';
  const summary = scan.summary;
  if (summary && (summary.critical > 0 || summary.high > 0)) return 'unsafe';
  return 'safe';
}

/** Derive the simplified updateKind string from the API updateKind object. */
function deriveUpdateKind(apiContainer: any): 'major' | 'minor' | 'patch' | 'digest' | null {
  if (!apiContainer.updateAvailable) return null;
  const uk = apiContainer.updateKind;
  if (!uk) return null;
  if (uk.kind === 'digest') return 'digest';
  if (uk.semverDiff === 'major') return 'major';
  if (uk.semverDiff === 'minor') return 'minor';
  if (uk.semverDiff === 'patch') return 'patch';
  if (uk.semverDiff === 'prerelease') return 'patch';
  // Unknown tag change -- treat as patch
  if (uk.kind === 'tag') return 'patch';
  return null;
}

/** Derive the new tag (remote version) when an update is available. */
function deriveNewTag(apiContainer: any): string | null {
  if (!apiContainer.updateAvailable) return null;
  return apiContainer.result?.tag ?? null;
}

/** Extract labels from the API labels object into an array of "key=value" strings. */
function deriveLabels(apiContainer: any): string[] {
  const labels = apiContainer.labels;
  if (!labels || typeof labels !== 'object') return [];
  return Object.entries(labels).map(([k, v]) => v ? `${k}=${v}` : k);
}

/** Map a single API container to the UI Container type. */
export function mapApiContainer(apiContainer: any): Container {
  return {
    id: apiContainer.id,
    name: apiContainer.displayName || apiContainer.name,
    image: apiContainer.image?.name ?? '',
    currentTag: apiContainer.image?.tag?.value ?? 'latest',
    newTag: deriveNewTag(apiContainer),
    status: apiContainer.status === 'running' ? 'running' : 'stopped',
    registry: deriveRegistry(apiContainer),
    updateKind: deriveUpdateKind(apiContainer),
    bouncer: deriveBouncer(apiContainer),
    server: deriveServer(apiContainer),
    details: {
      ports: [],
      volumes: [],
      env: [],
      labels: deriveLabels(apiContainer),
    },
  };
}

/** Map an array of API containers to UI containers. */
export function mapApiContainers(apiContainers: any[]): Container[] {
  return apiContainers.map(mapApiContainer);
}
