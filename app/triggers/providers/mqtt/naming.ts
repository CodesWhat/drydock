import { getComposeProjectService } from '../../../model/container.js';

const RECREATED_CONTAINER_NAME_PATTERN = /^([a-f0-9]{12})_(.+)$/i;

function getContainerId(container: { id?: unknown }) {
  if (typeof container?.id !== 'string' || container.id === '') {
    return undefined;
  }
  return container.id;
}

function getContainerName(container: { name?: unknown }) {
  if (typeof container?.name !== 'string') {
    return '';
  }
  return container.name;
}

function sanitizeContainerName(name: string) {
  return name.replaceAll('.', '-');
}

function getRecreatedAliasBaseName(container: { id?: unknown; name?: unknown }) {
  const containerId = getContainerId(container);
  const containerName = getContainerName(container);
  if (!containerId || containerName === '') {
    return undefined;
  }

  const recreatedAliasMatch = containerName.match(RECREATED_CONTAINER_NAME_PATTERN);
  if (!recreatedAliasMatch) {
    return undefined;
  }

  const [, shortIdPrefix, baseName] = recreatedAliasMatch;
  if (!baseName || !containerId.toLowerCase().startsWith(shortIdPrefix.toLowerCase())) {
    return undefined;
  }

  return baseName;
}

export function getCanonicalContainerName(container: { id?: unknown; name?: unknown }) {
  return getRecreatedAliasBaseName(container) || getContainerName(container);
}

export function getSanitizedCanonicalContainerName(container: { id?: unknown; name?: unknown }) {
  return sanitizeContainerName(getCanonicalContainerName(container));
}

export function getSanitizedRawContainerName(container: { name?: unknown }) {
  return sanitizeContainerName(getContainerName(container));
}

function getLegacyAliasNameCandidate(container: { id?: unknown; name?: unknown }) {
  const containerId = getContainerId(container);
  const canonicalContainerName = getCanonicalContainerName(container);
  if (!containerId || canonicalContainerName === '') {
    return undefined;
  }

  const shortIdPrefix = containerId.slice(0, 12);
  if (!/^[a-f0-9]{12}$/i.test(shortIdPrefix)) {
    return undefined;
  }

  return `${shortIdPrefix}_${canonicalContainerName}`;
}

export function getStaleSanitizedContainerNameCandidates(container: {
  id?: unknown;
  name?: unknown;
}) {
  const canonicalContainerName = getSanitizedCanonicalContainerName(container);
  const staleContainerNames = new Set<string>();
  const rawContainerName = getSanitizedRawContainerName(container);
  if (rawContainerName !== '' && rawContainerName !== canonicalContainerName) {
    staleContainerNames.add(rawContainerName);
  }

  const legacyAliasCandidate = getLegacyAliasNameCandidate(container);
  if (legacyAliasCandidate) {
    staleContainerNames.add(sanitizeContainerName(legacyAliasCandidate));
  }

  return Array.from(staleContainerNames);
}

/**
 * Encode one Compose project/service component for `getContainerIdentitySlug`
 * (roadmap 7-STORE review, MQTT slice 10 finding 4). A literal `-` is doubled
 * first so it survives distinctly from a `.`, which is then collapsed to a
 * single `-` the same way `sanitizeContainerName` does elsewhere; a lone `-`
 * in the result can therefore only have come from a `.`, never from an
 * original `-`. Without the doubling step, project `a.b` and project `a-b`
 * both sanitised to the same `a-b`, so pairing either with service `c`
 * produced the identical slug `a-b-c` — two different Compose stacks sharing
 * one state topic and one discovery topic, with `resolveHassCommandContainer`
 * then refusing commands for both as ambiguous.
 */
function encodeIdentitySlugComponent(value: string): string {
  return value.replaceAll('-', '--').replaceAll('.', '-');
}

/**
 * The MQTT topic segment identifying a container by durable identity rather
 * than by name: the Compose `project.service` pair when the container
 * carries both `com.docker.compose.*` labels (this pair survives a
 * `docker compose up` recreate, unlike the container name and id), falling
 * back to the current sanitised container name for a container Compose never
 * labeled. The project and service components are each escaped by
 * `encodeIdentitySlugComponent` before being joined with `.` — a character
 * the escape never emits — so the join is lossless and two distinct
 * project/service pairs can never collide on the same slug.
 *
 * Only the Compose-labeled branch is rename-stable: the pair does not change
 * when a Compose container is renamed or recreated with a different name, it
 * changes only when the project/service pair itself changes, which is
 * effectively a different container. The fallback branch has no such
 * guarantee — `getSanitizedCanonicalContainerName` IS the container's current
 * name, so it changes on every rename exactly like the name it is derived
 * from. See `Hass.ts`'s `getHassUniqueId` doc comment and
 * `content/docs/current/configuration/triggers/mqtt/index.mdx` for what that
 * means for topic and `unique_id` stability on a non-Compose container.
 */
export function getContainerIdentitySlug(
  container: { id?: unknown; name?: unknown } & Parameters<typeof getComposeProjectService>[0],
): string {
  const composeProjectService = getComposeProjectService(container);
  if (composeProjectService) {
    return `${encodeIdentitySlugComponent(composeProjectService.project)}.${encodeIdentitySlugComponent(composeProjectService.service)}`;
  }
  return getSanitizedCanonicalContainerName(container);
}
