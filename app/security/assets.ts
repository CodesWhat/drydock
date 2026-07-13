import { sanitizeLogParam } from '../log/sanitize.js';

export type ScannerAssetProviderId = 'trivy' | 'grype' | 'syft';
export type ScannerAssetState = 'missing' | 'pulling' | 'warming' | 'ready' | 'error';
export type ScannerAssetOperation = 'pull' | 'warm';

export interface ScannerAssetAuth {
  username?: string;
  password?: string;
}

export interface ScannerAssetInspection {
  resolvedDigest?: string;
  version?: string;
  updatedAt?: string;
  cacheUpdatedAt?: string;
  databaseUpdatedAt?: string;
}

export interface ScannerAssetProvider {
  id: ScannerAssetProviderId;
  backend: string;
  configuredImage: string;
  inspect: () => Promise<ScannerAssetInspection | undefined>;
  pull: (auth?: ScannerAssetAuth) => Promise<void>;
  warm: () => Promise<void>;
}

export interface ScannerAssetStatus {
  provider: ScannerAssetProviderId;
  backend: string;
  configuredImage: string;
  resolvedDigest?: string;
  version?: string;
  state: ScannerAssetState;
  operationId?: string;
  inspectedAt?: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt?: string;
  cacheUpdatedAt?: string;
  databaseUpdatedAt?: string;
  lastError?: string;
}

export type ScannerAssetAuditAction =
  | 'scanner-asset-pull-started'
  | 'scanner-asset-pull-succeeded'
  | 'scanner-asset-pull-failed'
  | 'scanner-asset-warm-started'
  | 'scanner-asset-warm-succeeded'
  | 'scanner-asset-warm-failed';

export interface ScannerAssetAuditDiagnostics {
  resolvedDigest?: string;
  version?: string;
  updatedAt?: string;
  cacheUpdatedAt?: string;
  databaseUpdatedAt?: string;
  error?: string;
}

export interface ScannerAssetAuditEvent {
  action: ScannerAssetAuditAction;
  operationId: string;
  provider: ScannerAssetProviderId;
  backend: string;
  configuredImage: string;
  state: ScannerAssetState;
  timestamp: string;
  diagnostics: ScannerAssetAuditDiagnostics;
}

export interface ScannerAssetManager {
  status: () => Promise<ScannerAssetStatus[]>;
  get: (id: ScannerAssetProviderId) => ScannerAssetStatus;
  pull: (id: ScannerAssetProviderId, auth?: ScannerAssetAuth) => Promise<ScannerAssetStatus>;
  warm: (id: ScannerAssetProviderId) => Promise<ScannerAssetStatus>;
  warmConfigured: () => Promise<ScannerAssetStatus[]>;
}

interface ScannerAssetManagerOptions {
  providers: ScannerAssetProvider[];
  audit?: (event: ScannerAssetAuditEvent) => void | Promise<void>;
  now?: () => Date;
}

interface InFlightOperation {
  operation: ScannerAssetOperation;
  promise: Promise<ScannerAssetStatus>;
}

const PROVIDER_ORDER = [
  'trivy',
  'grype',
  'syft',
] as const satisfies readonly ScannerAssetProviderId[];
// Strip ANSI escapes before sanitizeLogParam removes their leading escape byte.
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ANSI escape stripping
const ANSI_ESCAPES = /\x1b\[[0-9;]*m/g;

function isSupportedProviderId(value: unknown): value is ScannerAssetProviderId {
  return PROVIDER_ORDER.includes(value as ScannerAssetProviderId);
}

function cloneStatus(status: ScannerAssetStatus): ScannerAssetStatus {
  return { ...status };
}

function toOptionalMetadata(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined;
  }
  return sanitizeLogParam(value.trim());
}

function normalizeInspection(inspection: ScannerAssetInspection): ScannerAssetInspection {
  return {
    resolvedDigest: toOptionalMetadata(inspection.resolvedDigest),
    version: toOptionalMetadata(inspection.version),
    updatedAt: toOptionalMetadata(inspection.updatedAt),
    cacheUpdatedAt: toOptionalMetadata(inspection.cacheUpdatedAt),
    databaseUpdatedAt: toOptionalMetadata(inspection.databaseUpdatedAt),
  };
}

function getErrorMessage(error: unknown, auth?: ScannerAssetAuth): string {
  let message =
    error instanceof Error ? error.message : String(error ?? 'Unknown scanner asset error');
  for (const secret of [auth?.username, auth?.password]) {
    if (secret) {
      message = message.split(secret).join('[REDACTED]');
    }
  }
  return sanitizeLogParam(message.replace(ANSI_ESCAPES, '')) || 'Unknown scanner asset error';
}

function diagnosticsFromStatus(status: ScannerAssetStatus): ScannerAssetAuditDiagnostics {
  return {
    resolvedDigest: status.resolvedDigest,
    version: status.version,
    updatedAt: status.updatedAt,
    cacheUpdatedAt: status.cacheUpdatedAt,
    databaseUpdatedAt: status.databaseUpdatedAt,
    ...(status.lastError ? { error: status.lastError } : {}),
  };
}

function getAuditAction(
  operation: ScannerAssetOperation,
  phase: 'started' | 'succeeded' | 'failed',
): ScannerAssetAuditAction {
  return `scanner-asset-${operation}-${phase}`;
}

export function createScannerAssetManager(
  options: ScannerAssetManagerOptions,
): ScannerAssetManager {
  const providers = new Map<ScannerAssetProviderId, ScannerAssetProvider>();
  const states = new Map<ScannerAssetProviderId, ScannerAssetStatus>();
  const inFlight = new Map<ScannerAssetProviderId, InFlightOperation>();
  const now = options.now ?? (() => new Date());
  let operationSequence = 0;

  for (const provider of options.providers) {
    if (!isSupportedProviderId(provider.id)) {
      throw new Error(`Unsupported scanner asset provider "${provider.id}"`);
    }
    if (providers.has(provider.id)) {
      throw new Error(`Duplicate scanner asset provider "${provider.id}"`);
    }
    providers.set(provider.id, provider);
    states.set(provider.id, {
      provider: provider.id,
      backend: provider.backend,
      configuredImage: provider.configuredImage,
      state: 'missing',
    });
  }

  const orderedProviderIds = PROVIDER_ORDER.filter((id) => providers.has(id));

  function requireProvider(id: ScannerAssetProviderId): ScannerAssetProvider {
    const provider = providers.get(id);
    if (!provider) {
      throw new Error(`Scanner asset provider "${id}" is not configured`);
    }
    return provider;
  }

  function requireStatus(id: ScannerAssetProviderId): ScannerAssetStatus {
    requireProvider(id);
    return states.get(id) as ScannerAssetStatus;
  }

  function setStatus(id: ScannerAssetProviderId, status: ScannerAssetStatus): ScannerAssetStatus {
    states.set(id, status);
    return status;
  }

  async function emitAudit(event: ScannerAssetAuditEvent): Promise<void> {
    try {
      await options.audit?.({
        ...event,
        diagnostics: { ...event.diagnostics },
      });
    } catch {
      // Asset lifecycle state must not depend on optional audit delivery.
    }
  }

  async function inspectProvider(id: ScannerAssetProviderId): Promise<ScannerAssetStatus> {
    const provider = requireProvider(id);
    const existing = requireStatus(id);
    if (inFlight.has(id)) {
      return cloneStatus(existing);
    }

    const inspectedAt = now().toISOString();
    try {
      const inspection = await provider.inspect();
      const metadata = inspection ? normalizeInspection(inspection) : {};
      return setStatus(id, {
        ...existing,
        ...metadata,
        state: inspection ? 'ready' : 'missing',
        inspectedAt,
        lastError: undefined,
      });
    } catch (error: unknown) {
      return setStatus(id, {
        ...existing,
        state: 'error',
        inspectedAt,
        lastError: getErrorMessage(error),
      });
    }
  }

  async function executeOperation(
    id: ScannerAssetProviderId,
    operation: ScannerAssetOperation,
    auth?: ScannerAssetAuth,
  ): Promise<ScannerAssetStatus> {
    const provider = requireProvider(id);
    const startedAt = now().toISOString();
    const operationId = `scanner-asset:${id}:${operation}:${Date.parse(startedAt)}:${++operationSequence}`;
    const activeStatus = setStatus(id, {
      ...requireStatus(id),
      state: operation === 'pull' ? 'pulling' : 'warming',
      operationId,
      startedAt,
      completedAt: undefined,
      lastError: undefined,
    });

    await emitAudit({
      action: getAuditAction(operation, 'started'),
      operationId,
      provider: id,
      backend: provider.backend,
      configuredImage: provider.configuredImage,
      state: activeStatus.state,
      timestamp: startedAt,
      diagnostics: diagnosticsFromStatus(activeStatus),
    });

    try {
      if (operation === 'pull') {
        await provider.pull(auth);
      } else {
        await provider.warm();
      }
      const inspection = await provider.inspect();
      const completedAt = now().toISOString();
      const completedStatus = setStatus(id, {
        ...requireStatus(id),
        ...(inspection ? normalizeInspection(inspection) : {}),
        state: inspection ? 'ready' : 'missing',
        operationId,
        completedAt,
        inspectedAt: completedAt,
        lastError: undefined,
      });
      await emitAudit({
        action: getAuditAction(operation, 'succeeded'),
        operationId,
        provider: id,
        backend: provider.backend,
        configuredImage: provider.configuredImage,
        state: completedStatus.state,
        timestamp: completedAt,
        diagnostics: diagnosticsFromStatus(completedStatus),
      });
      return cloneStatus(completedStatus);
    } catch (error: unknown) {
      const completedAt = now().toISOString();
      const lastError = getErrorMessage(error, auth);
      const failedStatus = setStatus(id, {
        ...requireStatus(id),
        state: 'error',
        operationId,
        completedAt,
        lastError,
      });
      await emitAudit({
        action: getAuditAction(operation, 'failed'),
        operationId,
        provider: id,
        backend: provider.backend,
        configuredImage: provider.configuredImage,
        state: 'error',
        timestamp: completedAt,
        diagnostics: diagnosticsFromStatus(failedStatus),
      });
      throw new Error(lastError);
    }
  }

  function runOperation(
    id: ScannerAssetProviderId,
    operation: ScannerAssetOperation,
    auth?: ScannerAssetAuth,
  ): Promise<ScannerAssetStatus> {
    requireProvider(id);
    const active = inFlight.get(id);
    if (active) {
      if (active.operation === operation) {
        return active.promise;
      }
      return active.promise.then(
        () => runOperation(id, operation, auth),
        () => runOperation(id, operation, auth),
      );
    }

    const promise = executeOperation(id, operation, auth);
    const entry = { operation, promise };
    inFlight.set(id, entry);
    void promise.then(
      () => {
        // Promise callbacks are registered before callers can enqueue replacement work, so a
        // different entry cannot be installed before this fulfillment cleanup runs. Keep the
        // identity guard as defensive protection if operation scheduling changes later.
        /* v8 ignore next -- @preserve */
        if (inFlight.get(id) === entry) {
          inFlight.delete(id);
        }
      },
      () => {
        // The same registration-order guarantee applies to rejection cleanup.
        /* v8 ignore next -- @preserve */
        if (inFlight.get(id) === entry) {
          inFlight.delete(id);
        }
      },
    );
    return promise;
  }

  return {
    async status(): Promise<ScannerAssetStatus[]> {
      const refreshed = await Promise.all(orderedProviderIds.map(inspectProvider));
      return refreshed.map(cloneStatus);
    },
    get(id): ScannerAssetStatus {
      return cloneStatus(requireStatus(id));
    },
    pull(id, auth): Promise<ScannerAssetStatus> {
      return runOperation(id, 'pull', auth);
    },
    warm(id): Promise<ScannerAssetStatus> {
      return runOperation(id, 'warm');
    },
    async warmConfigured(): Promise<ScannerAssetStatus[]> {
      const warmed = await Promise.all(orderedProviderIds.map((id) => runOperation(id, 'warm')));
      const byProvider = new Map(warmed.map((status) => [status.provider, status]));
      return orderedProviderIds.map((id) => cloneStatus(byProvider.get(id) as ScannerAssetStatus));
    },
  };
}
