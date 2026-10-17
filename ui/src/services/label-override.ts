import { i18n } from '../boot/i18n';
import type { LabelOwnedField, LabelOwnedSource } from '../types/container';
import { readJsonResponse } from '../utils/api';

type LabelOverrideValue = string | string[];
type LabelOverrideFieldValue = LabelOverrideValue | null;

interface LabelOverrideStoredValue {
  value: LabelOverrideValue;
  updatedAt: string;
  updatedBy: string;
}

interface LabelOverrideFieldState {
  labelKey: string;
  /** The raw Docker label value, if any. */
  label: string | null;
  declared: { value: LabelOverrideFieldValue; source: Exclude<LabelOwnedSource, 'override'> };
  override: LabelOverrideStoredValue | null;
  effective: { value: LabelOverrideFieldValue; source: LabelOwnedSource };
}

interface LabelOverrideWarning {
  field: string;
  code: string;
  reference?: string;
}

interface LabelOverrideScope {
  kind: 'container' | 'compose-service';
  agent: string | null;
  watcher: string;
  name: string;
  appliesTo: { id: string; name: string }[];
}

interface LabelOverrideSnapshot {
  containerId: string;
  scope: LabelOverrideScope;
  overrideId: string | null;
  /** 0 when the scope has no stored override yet. */
  revision: number;
  readOnlyReason: 'rollback-container' | null;
  agentEnforcedActionRouting: boolean;
  fields: Record<LabelOwnedField, LabelOverrideFieldState>;
  warnings: LabelOverrideWarning[];
  invalidStoredOverride?: { field: string; reason: string }[];
}

interface LabelOverrideWriteResult extends LabelOverrideSnapshot {
  changed: LabelOwnedField[];
}

type LabelOverrideChange =
  | { field: LabelOwnedField; op: 'set'; value: LabelOverrideValue }
  | { field: LabelOwnedField; op: 'remove' };

interface LabelOverridePatchRequest {
  revision: number;
  /** The id of the row the caller read; the server needs it past revision 0. */
  overrideId: string | null;
  changes: LabelOverrideChange[];
}

interface LabelOverrideFieldError {
  field: string;
  code: string;
  entries?: string[];
}

/** A failed request that keeps what the panel branches on. */
class LabelOverrideHttpError extends Error {
  readonly status: number;
  readonly errors: LabelOverrideFieldError[];
  /** Present on a stale-revision conflict. */
  readonly snapshot?: LabelOverrideSnapshot;
  readonly readOnlyReason?: 'rollback-container';
  readonly cycle?: string[];

  constructor(
    status: number,
    message: string,
    extras: {
      errors?: LabelOverrideFieldError[];
      snapshot?: LabelOverrideSnapshot;
      readOnlyReason?: 'rollback-container';
      cycle?: string[];
    } = {},
  ) {
    super(message);
    this.name = 'LabelOverrideHttpError';
    this.status = status;
    this.errors = extras.errors ?? [];
    this.snapshot = extras.snapshot;
    this.readOnlyReason = extras.readOnlyReason;
    this.cycle = extras.cycle;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readFieldErrors(value: unknown): LabelOverrideFieldError[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.field !== 'string' || typeof entry.code !== 'string') {
      return [];
    }
    const entries = Array.isArray(entry.entries)
      ? entry.entries.filter((item): item is string => typeof item === 'string')
      : undefined;
    return [
      {
        field: entry.field,
        code: entry.code,
        ...(entries === undefined ? {} : { entries }),
      },
    ];
  });
}

async function throwForResponse(response: Response): Promise<never> {
  const payload: unknown = await response.json().catch(() => null);
  const body = isRecord(payload) ? payload : {};
  const message =
    typeof body.error === 'string' && body.error.trim()
      ? body.error
      : i18n.global.t('labelOverrides.errors.requestFailed', { status: response.status });
  throw new LabelOverrideHttpError(response.status, message, {
    errors: readFieldErrors(body.errors),
    snapshot: isRecord(body.snapshot)
      ? (body.snapshot as unknown as LabelOverrideSnapshot)
      : undefined,
    readOnlyReason: body.readOnlyReason === 'rollback-container' ? 'rollback-container' : undefined,
    cycle: Array.isArray(body.cycle)
      ? body.cycle.filter((name): name is string => typeof name === 'string')
      : undefined,
  });
}

function overridesPath(containerId: string): string {
  return `/api/v1/containers/${encodeURIComponent(containerId)}/label-overrides`;
}

async function getLabelOverrides(containerId: string): Promise<LabelOverrideSnapshot> {
  const response = await fetch(overridesPath(containerId), { credentials: 'include' });
  if (!response.ok) {
    return throwForResponse(response);
  }
  return readJsonResponse<LabelOverrideSnapshot>(response, 'Label overrides');
}

async function patchLabelOverrides(
  containerId: string,
  request: LabelOverridePatchRequest,
): Promise<LabelOverrideWriteResult> {
  const response = await fetch(overridesPath(containerId), {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      revision: request.revision,
      ...(request.overrideId === null ? {} : { overrideId: request.overrideId }),
      changes: request.changes,
    }),
  });
  if (!response.ok) {
    return throwForResponse(response);
  }
  return readJsonResponse<LabelOverrideWriteResult>(response, 'Label overrides');
}

async function resetLabelOverrides(
  containerId: string,
  revision: number,
  overrideId: string | null,
): Promise<LabelOverrideWriteResult> {
  const query = `revision=${revision}${
    overrideId === null ? '' : `&overrideId=${encodeURIComponent(overrideId)}`
  }`;
  const response = await fetch(`${overridesPath(containerId)}?${query}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!response.ok) {
    return throwForResponse(response);
  }
  return readJsonResponse<LabelOverrideWriteResult>(response, 'Label overrides');
}

export {
  getLabelOverrides,
  type LabelOverrideFieldError,
  type LabelOverrideFieldState,
  type LabelOverrideFieldValue,
  LabelOverrideHttpError,
  type LabelOverrideSnapshot,
  type LabelOverrideValue,
  type LabelOverrideWriteResult,
  patchLabelOverrides,
  resetLabelOverrides,
};
