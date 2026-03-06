type AuditViewMode = 'table' | 'cards' | 'list';

function firstQueryValue(value: unknown): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === 'string' ? raw : undefined;
}

export function parseAuditViewModeQuery(value: unknown): AuditViewMode {
  const raw = firstQueryValue(value);
  if (raw === 'cards' || raw === 'list') return raw;
  return 'table';
}

/**
 * URL query mode only takes precedence when the query explicitly provides `view`.
 * Missing `view` should preserve the current in-memory/persisted selection.
 */
export function resolveAuditViewModeFromQuery(
  currentMode: AuditViewMode,
  queryValue: unknown,
): AuditViewMode {
  const raw = firstQueryValue(queryValue);
  if (raw === undefined) return currentMode;
  return parseAuditViewModeQuery(raw);
}
