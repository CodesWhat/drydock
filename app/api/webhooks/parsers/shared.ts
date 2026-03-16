export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

export function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => asNonEmptyString(entry))
    .filter((entry): entry is string => entry !== undefined);
}

export function uniqStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

export function extractImageFromRepositoryUrl(value: unknown): string | undefined {
  const raw = asNonEmptyString(value);
  if (!raw) {
    return undefined;
  }

  const withoutScheme = raw.replace(/^https?:\/\//i, '');
  const slashIndex = withoutScheme.indexOf('/');
  const path = slashIndex >= 0 ? withoutScheme.slice(slashIndex + 1) : withoutScheme;
  if (path === '') {
    return undefined;
  }

  const imageWithoutTag = path.includes(':') ? path.slice(0, path.lastIndexOf(':')) : path;
  return asNonEmptyString(imageWithoutTag);
}

export function splitSubjectImageAndTag(
  subject: unknown,
): { image?: string; tag?: string } | undefined {
  const raw = asNonEmptyString(subject);
  if (!raw) {
    return undefined;
  }

  const separatorIndex = raw.lastIndexOf(':');
  if (separatorIndex <= 0 || separatorIndex >= raw.length - 1) {
    return undefined;
  }

  const image = raw.slice(0, separatorIndex).trim();
  const tag = raw.slice(separatorIndex + 1).trim();

  return { image, tag };
}
