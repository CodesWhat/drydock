import { type Container, deriveContainerIdentityKey } from '../../model/container.js';

type ContainerIndex = Map<string, Set<Container>>;

function add(index: ContainerIndex, key: string | undefined, container: Container) {
  if (!key) return;
  let matches = index.get(key);
  if (!matches) {
    matches = new Set();
    index.set(key, matches);
  }
  matches.add(container);
}

function unique(matches: Set<Container> | undefined): Container | null | undefined {
  if (!matches) return undefined;
  return matches.size === 1 ? matches.values().next().value : null;
}

function nameKey(container: Container): string | undefined {
  if (!container.watcher || !container.name) return undefined;
  return JSON.stringify([container.agent ?? '', container.watcher, container.name]);
}

function identityKey(container: Container): string | undefined {
  return deriveContainerIdentityKey(container) ?? container.identityKey;
}

// Undefined means absent; null means ambiguous and must not reuse queued eligibility.
export function createNotificationContainerLookup(containers: Container[]) {
  const ids: ContainerIndex = new Map();
  const identities: ContainerIndex = new Map();
  const names: ContainerIndex = new Map();
  for (const container of containers) {
    add(ids, container.id, container);
    add(identities, identityKey(container), container);
    add(names, nameKey(container), container);
  }
  return (queued: Container): Container | null | undefined => {
    const exact = unique(ids.get(queued.id));
    if (exact !== undefined) return exact;
    const candidates = identities.get(identityKey(queued) ?? '');
    if (candidates?.size === 1) return candidates.values().next().value;
    const named = unique(names.get(nameKey(queued) ?? ''));
    if (candidates) return named && candidates.has(named) ? named : null;
    return named;
  };
}
