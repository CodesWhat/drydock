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
    const sanitizedLegacyAliasCandidate = sanitizeContainerName(legacyAliasCandidate);
    /* v8 ignore start -- defensive: legacy alias always includes id prefix, can't equal canonical */
    if (sanitizedLegacyAliasCandidate !== canonicalContainerName) {
      /* v8 ignore stop */
      staleContainerNames.add(sanitizedLegacyAliasCandidate);
    }
  }

  return Array.from(staleContainerNames);
}
