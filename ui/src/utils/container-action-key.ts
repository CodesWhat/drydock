interface ContainerActionKeyInput {
  id?: unknown;
  name?: unknown;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function getContainerActionKey(container: ContainerActionKeyInput): string {
  return asNonEmptyString(container.name) ?? asNonEmptyString(container.id) ?? '';
}

export function hasTrackedContainerAction(
  trackedActions: Pick<Set<string>, 'has'>,
  container: ContainerActionKeyInput,
): boolean {
  const id = asNonEmptyString(container.id);
  const name = asNonEmptyString(container.name);
  return Boolean((id && trackedActions.has(id)) || (name && trackedActions.has(name)));
}
