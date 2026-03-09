export interface ContainerComposePreview {
  files: string[];
  service?: string;
  writableFile?: string;
  willWrite?: boolean;
  patch?: string;
}

export interface ContainerPreviewPayload extends Record<string, unknown> {
  compose?: ContainerComposePreview;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return normalizeStringList(parsed);
        }
      } catch {
        // Keep fallback split behavior for non-JSON values.
      }
    }
    return trimmed
      .split(/[\n,]+/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
  return [];
}

function pickFirstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return undefined;
}

function pickFirstBoolean(...values: unknown[]): boolean | undefined {
  for (const value of values) {
    if (typeof value === 'boolean') {
      return value;
    }
  }
  return undefined;
}

function normalizePatch(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value.trim().length > 0 ? value : undefined;
  }
  if (Array.isArray(value)) {
    const lines = value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trimEnd())
      .filter((entry) => entry.length > 0);
    if (lines.length > 0) {
      return lines.join('\n');
    }
  }
  return undefined;
}

function normalizeComposePreview(
  payload: Record<string, unknown>,
): ContainerComposePreview | undefined {
  const compose = asRecord(payload.compose);
  const composePreview = asRecord(payload.composePreview);
  const composeContext = asRecord(payload.composeContext);

  const files = [
    ...new Set([
      ...normalizeStringList(compose?.files),
      ...normalizeStringList(compose?.paths),
      ...normalizeStringList(compose?.composeFiles),
      ...normalizeStringList(compose?.composePaths),
      ...normalizeStringList(compose?.file),
      ...normalizeStringList(compose?.composeFile),
      ...normalizeStringList(composePreview?.files),
      ...normalizeStringList(composePreview?.paths),
      ...normalizeStringList(composePreview?.composeFiles),
      ...normalizeStringList(composePreview?.composePaths),
      ...normalizeStringList(composePreview?.file),
      ...normalizeStringList(composePreview?.composeFile),
      ...normalizeStringList(composeContext?.files),
      ...normalizeStringList(composeContext?.paths),
      ...normalizeStringList(composeContext?.composeFiles),
      ...normalizeStringList(composeContext?.composePaths),
      ...normalizeStringList(composeContext?.file),
      ...normalizeStringList(composeContext?.composeFile),
      ...normalizeStringList(payload.composeFiles),
      ...normalizeStringList(payload.composePaths),
      ...normalizeStringList(payload.compose_paths),
      ...normalizeStringList(payload.composeFile),
      ...normalizeStringList(payload.compose_file),
    ]),
  ];

  const service = pickFirstString(
    compose?.service,
    compose?.serviceName,
    compose?.composeService,
    composePreview?.service,
    composePreview?.serviceName,
    composePreview?.composeService,
    composeContext?.service,
    composeContext?.serviceName,
    composeContext?.composeService,
    payload.composeService,
    payload.compose_service,
  );

  const writableFile = pickFirstString(
    compose?.writableFile,
    compose?.writeFile,
    compose?.targetFile,
    compose?.targetPath,
    composePreview?.writableFile,
    composePreview?.writeFile,
    composePreview?.targetFile,
    composePreview?.targetPath,
    composeContext?.writableFile,
    composeContext?.writeFile,
    composeContext?.targetFile,
    composeContext?.targetPath,
    payload.composeWritableFile,
    payload.composeWriteFile,
    payload.composeTargetFile,
    payload.composeTargetPath,
  );

  const patch = normalizePatch(
    compose?.patch ??
      compose?.patchPreview ??
      compose?.diff ??
      composePreview?.patch ??
      composePreview?.patchPreview ??
      composePreview?.diff ??
      composeContext?.patch ??
      composeContext?.patchPreview ??
      composeContext?.diff ??
      payload.composePatch ??
      payload.composePatchPreview ??
      payload.composeDiff ??
      payload.patchPreview,
  );

  let willWrite = pickFirstBoolean(
    compose?.willWrite,
    compose?.write,
    compose?.shouldWrite,
    composePreview?.willWrite,
    composePreview?.write,
    composePreview?.shouldWrite,
    composeContext?.willWrite,
    composeContext?.write,
    composeContext?.shouldWrite,
    payload.composeWillWrite,
    payload.composeWrite,
  );

  const hasComposeDetails = files.length > 0 || !!service || !!writableFile || !!patch;
  if (willWrite === undefined && hasComposeDetails && typeof payload.dryRun === 'boolean') {
    willWrite = !payload.dryRun;
  }

  if (!hasComposeDetails && willWrite === undefined) {
    return undefined;
  }

  return {
    files,
    ...(service ? { service } : {}),
    ...(writableFile ? { writableFile } : {}),
    ...(willWrite !== undefined ? { willWrite } : {}),
    ...(patch ? { patch } : {}),
  };
}

export function normalizePreviewPayload(payload: unknown): ContainerPreviewPayload {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {};
  }
  const source = payload as Record<string, unknown>;
  const normalized = { ...source };
  const compose = normalizeComposePreview(source);
  if (compose) {
    normalized.compose = compose;
  } else {
    delete normalized.compose;
  }
  return normalized;
}

export async function previewContainer(id: string): Promise<ContainerPreviewPayload> {
  const response = await fetch(`/api/containers/${id}/preview`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`Preview failed: ${response.statusText}`);
  }
  const payload = await response.json();
  return normalizePreviewPayload(payload);
}
