interface ContainerViewKeyInput {
  id?: unknown;
  name?: unknown;
  server?: unknown;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function getContainerViewKey(container: ContainerViewKeyInput): string {
  const server = asNonEmptyString(container.server);
  const id = asNonEmptyString(container.id);
  const name = asNonEmptyString(container.name);

  if (server && id) {
    return `${server}::${id}`;
  }
  if (server && name) {
    return `${server}::${name}`;
  }
  if (id) {
    return id;
  }
  return name ?? '';
}
