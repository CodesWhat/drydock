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

export function hasTrackedContainerAction(
  trackedActions: Pick<Set<string>, 'has'>,
  container: ContainerActionKeyInput,
): boolean {
  const id = asNonEmptyString(container.id);
  const name = asNonEmptyString(container.name);
  return Boolean((id && trackedActions.has(id)) || (name && trackedActions.has(name)));
}
