export type ContainerActionKind = 'update' | 'scan' | 'lifecycle' | 'delete';

interface ContainerActionKeyInput {
  id?: unknown;
  name?: unknown;
  server?: unknown;
  identityKey?: unknown;
  agent?: unknown;
  watcher?: unknown;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function getContainerActionKey(container: ContainerActionKeyInput): string {
  return asNonEmptyString(container.id) ?? asNonEmptyString(container.name) ?? '';
}

export function buildContainerIdentityKey(container: ContainerActionKeyInput): string {
  const explicitIdentityKey = asNonEmptyString(container.identityKey);
  if (explicitIdentityKey) {
    return explicitIdentityKey;
  }

  const watcher = asNonEmptyString(container.watcher);
  const name = asNonEmptyString(container.name);
  if (watcher && name) {
    const agent = asNonEmptyString(container.agent) ?? '';
    return `${agent}::${watcher}::${name}`;
  }

  return '';
}

export function getContainerActionIdentityKey(container: ContainerActionKeyInput): string {
  return buildContainerIdentityKey(container) || getContainerActionKey(container);
}

export function getTrackedContainerActionKind(
  trackedActions: Map<string, ContainerActionKind>,
  container: ContainerActionKeyInput,
): ContainerActionKind | undefined {
  const id = asNonEmptyString(container.id);
  const name = asNonEmptyString(container.name);
  if (id) {
    const kind = trackedActions.get(id);
    if (kind !== undefined) {
      return kind;
    }
  }
  if (name) {
    return trackedActions.get(name);
  }
  return undefined;
}

export function hasTrackedContainerAction(
  trackedActions: Map<string, ContainerActionKind>,
  container: ContainerActionKeyInput,
): boolean {
  return getTrackedContainerActionKind(trackedActions, container) !== undefined;
}

export function hasTrackedContainerActionOfKind(
  trackedActions: Map<string, ContainerActionKind>,
  container: ContainerActionKeyInput,
  kind: ContainerActionKind,
): boolean {
  return getTrackedContainerActionKind(trackedActions, container) === kind;
}
