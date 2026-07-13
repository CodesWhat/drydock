import { execFile } from 'node:child_process';
import { isAbsolute as isAbsolutePath, win32 as win32Path } from 'node:path';
import { getSecurityConfiguration, type SecuritySbomFormat } from '../configuration/index.js';
import type { ScannerAssetManager, ScannerAssetStatus } from './assets.js';
import { getDefaultScannerRuntime } from './scanner-runtime.js';

type SecurityRuntimeToolStatus = {
  enabled: boolean;
  command: string;
  commandAvailable: boolean | null;
  status: 'ready' | 'missing' | 'disabled';
  message: string;
};

export interface SecurityRuntimeProviderStatus extends SecurityRuntimeToolStatus {
  provider: 'trivy' | 'grype' | 'syft';
  role: 'scanner' | 'sbom';
}

export interface SecurityRuntimeStatus {
  checkedAt: string;
  ready: boolean;
  backend: string;
  availabilityPolicy: string;
  gate: {
    mode: 'on' | 'off';
    allowNoWorse: boolean;
  };
  scanner: SecurityRuntimeToolStatus & {
    scanner: string;
    server: string;
  };
  signature: SecurityRuntimeToolStatus;
  sbom: {
    enabled: boolean;
    formats: SecuritySbomFormat[];
    generator: 'trivy' | 'syft';
  };
  providers: SecurityRuntimeProviderStatus[];
  assets: ScannerAssetStatus[];
  requirements: string[];
}

interface CommandAvailabilityResult {
  available: boolean;
  invalidPath: boolean;
}

export interface TrivyDatabaseStatus {
  updatedAt: string;
  downloadedAt?: string;
}

const COMMAND_CHECK_TIMEOUT_MS = 4_000;
const COMMAND_CHECK_BUFFER_BYTES = 256 * 1024;
const TRIVY_DB_STATUS_CACHE_TTL_MS = 5 * 60 * 1000;
const TRIVY_DB_STATUS_TIMEOUT_MS = 10_000;
const TRIVY_DB_STATUS_MAX_BUFFER = 512 * 1024;
const DISALLOWED_COMMAND_CHARACTERS_PATTERN = /[;|$]/;

let trivyDbStatusCache: { status: TrivyDatabaseStatus; expiresAt: number } | undefined;
type TrivyDatabaseStatusInFlight = {
  promise: Promise<TrivyDatabaseStatus | undefined>;
};
let trivyDbStatusInFlight: TrivyDatabaseStatusInFlight | undefined;

interface RuntimeToolCheck {
  enabled: boolean;
  command: string;
  availability: CommandAvailabilityResult;
}

export function hasValidCommandPath(command: string): boolean {
  if (command.includes('\0') || DISALLOWED_COMMAND_CHARACTERS_PATTERN.test(command)) {
    return false;
  }

  const hasPathSeparator = command.includes('/') || command.includes('\\');
  if (hasPathSeparator) {
    const isAbsoluteForRuntime =
      process.platform === 'win32' ? win32Path.isAbsolute(command) : isAbsolutePath(command);
    return isAbsoluteForRuntime;
  }

  return !/\s/.test(command);
}

function checkCommandAvailability(command: string): Promise<CommandAvailabilityResult> {
  const commandValue = command.trim();
  if (!commandValue) {
    return Promise.resolve({ available: false, invalidPath: false });
  }

  if (!hasValidCommandPath(commandValue)) {
    return Promise.resolve({ available: false, invalidPath: true });
  }

  return new Promise((resolve) => {
    execFile(
      commandValue,
      ['--version'],
      {
        timeout: COMMAND_CHECK_TIMEOUT_MS,
        maxBuffer: COMMAND_CHECK_BUFFER_BYTES,
        env: process.env,
      },
      (error) => {
        if (!error) {
          resolve({ available: true, invalidPath: false });
          return;
        }

        const errorCode = (error as NodeJS.ErrnoException)?.code;
        if (
          errorCode === 'ENOENT' ||
          errorCode === 'EACCES' ||
          errorCode === 'EPERM' ||
          errorCode === 'ETIMEDOUT'
        ) {
          resolve({ available: false, invalidPath: false });
          return;
        }

        // A non-zero exit code still means the command exists and can be invoked.
        resolve({ available: true, invalidPath: false });
      },
    );
  });
}

function buildDisabledToolStatus(message: string): SecurityRuntimeToolStatus {
  return {
    enabled: false,
    command: '',
    commandAvailable: null,
    status: 'disabled',
    message,
  };
}

function getUnavailableCommandMessage(
  toolName: 'Trivy' | 'Grype' | 'Syft' | 'Cosign',
  command: string,
  invalidPath: boolean,
): string {
  if (invalidPath) {
    return `${toolName} command "${command}" is invalid; use a command name or absolute path`;
  }
  return `${toolName} command "${command}" is not available in this runtime`;
}

function buildSignatureMessage(check: RuntimeToolCheck): string {
  if (check.availability.available) {
    return 'Cosign is ready for signature verification';
  }
  return getUnavailableCommandMessage('Cosign', check.command, check.availability.invalidPath);
}

function buildSignatureRuntimeStatus(check: RuntimeToolCheck): SecurityRuntimeToolStatus {
  if (!check.enabled) {
    return buildDisabledToolStatus('Signature verification is disabled');
  }

  return {
    enabled: true,
    command: check.command,
    commandAvailable: check.availability.available,
    status: check.availability.available ? 'ready' : 'missing',
    message: buildSignatureMessage(check),
  };
}

function buildRequirement(
  toolName: 'trivy' | 'cosign',
  check: RuntimeToolCheck,
): string | undefined {
  if (!check.enabled || check.availability.available) {
    return undefined;
  }
  return `Install ${toolName} (configured command: "${check.command}")`;
}

function isDefinedValue<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function getUnavailableProviderMessage(
  providers: SecurityRuntimeProviderStatus[],
  fallback: string,
): string {
  const unavailable = providers.find((provider) => provider.status !== 'ready');
  // Validated scanner configuration always selects at least one provider, and every provider
  // status is constructed with a message. Retain a defensive fallback for unexpected callers.
  /* v8 ignore next -- @preserve */
  if (!unavailable) return fallback;
  return unavailable.message;
}

async function resolveRuntimeToolCheck(
  enabled: boolean,
  configuredCommand: string | undefined,
  defaultCommand: string,
): Promise<RuntimeToolCheck> {
  if (!enabled) {
    return {
      enabled: false,
      command: '',
      availability: { available: false, invalidPath: false },
    };
  }

  const command = configuredCommand || defaultCommand;
  const availability = await checkCommandAvailability(command);
  return {
    enabled: true,
    command,
    availability,
  };
}

export function clearTrivyDatabaseStatusCache(): void {
  trivyDbStatusCache = undefined;
  trivyDbStatusInFlight = undefined;
}

async function getGrypeDatabaseUpdatedAt(command: string): Promise<string | undefined> {
  try {
    const output = await new Promise<string>((resolve, reject) => {
      execFile(
        command,
        ['db', 'status', '-o', 'json'],
        {
          timeout: TRIVY_DB_STATUS_TIMEOUT_MS,
          maxBuffer: TRIVY_DB_STATUS_MAX_BUFFER,
          env: process.env,
        },
        (error, stdout) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(`${stdout || ''}`);
        },
      );
    });
    const parsed = JSON.parse(output);
    const built = parsed?.built ?? parsed?.database?.built ?? parsed?.db?.built;
    return typeof built === 'string' && built.trim() ? built.trim() : undefined;
  } catch {
    return undefined;
  }
}

export async function getTrivyDatabaseStatus(): Promise<TrivyDatabaseStatus | undefined> {
  const now = Date.now();
  if (trivyDbStatusCache && trivyDbStatusCache.expiresAt > now) {
    return trivyDbStatusCache.status;
  }
  if (trivyDbStatusInFlight) {
    return trivyDbStatusInFlight.promise;
  }

  const configuration = getSecurityConfiguration();
  if (configuration.backend !== 'command') {
    try {
      const assets = await getDefaultScannerRuntime().assets.status();
      const selected = assets.filter((asset) =>
        configuration.scanner === 'both'
          ? asset.provider === 'trivy' || asset.provider === 'grype'
          : asset.provider === configuration.scanner,
      );
      if (selected.length === 0) {
        return undefined;
      }
      return {
        updatedAt: selected
          .map(
            (asset) =>
              `${asset.provider}:${asset.resolvedDigest || asset.configuredImage}:${asset.databaseUpdatedAt || asset.cacheUpdatedAt || 'unknown'}`,
          )
          .sort()
          .join('|'),
      };
    } catch {
      return undefined;
    }
  }
  if (configuration.scanner === 'grype') {
    let inFlightEntry: TrivyDatabaseStatusInFlight;
    inFlightEntry = {
      promise: (async (): Promise<TrivyDatabaseStatus | undefined> => {
        const grypeUpdatedAt = await getGrypeDatabaseUpdatedAt(
          `${configuration.grype.command || 'grype'}`.trim() || 'grype',
        );
        if (!grypeUpdatedAt) {
          return undefined;
        }
        const status = { updatedAt: `grype:${grypeUpdatedAt}` };
        if (trivyDbStatusInFlight === inFlightEntry) {
          trivyDbStatusCache = { status, expiresAt: now + TRIVY_DB_STATUS_CACHE_TTL_MS };
        }
        return status;
      })(),
    };
    trivyDbStatusInFlight = inFlightEntry;
    try {
      return await inFlightEntry.promise;
    } finally {
      if (trivyDbStatusInFlight === inFlightEntry) {
        trivyDbStatusInFlight = undefined;
      }
    }
  }
  const trivyCommand = configuration.trivy.command || 'trivy';

  let inFlightEntry: TrivyDatabaseStatusInFlight;
  inFlightEntry = {
    promise: (async (): Promise<TrivyDatabaseStatus | undefined> => {
      try {
        const output = await new Promise<string>((resolve, reject) => {
          execFile(
            trivyCommand,
            ['version', '--format', 'json'],
            {
              timeout: TRIVY_DB_STATUS_TIMEOUT_MS,
              maxBuffer: TRIVY_DB_STATUS_MAX_BUFFER,
              env: process.env,
            },
            (error, stdout) => {
              if (error) {
                reject(error);
                return;
              }
              resolve(`${stdout || ''}`);
            },
          );
        });

        const parsed = JSON.parse(output);
        const updatedAt = parsed?.VulnerabilityDB?.UpdatedAt;
        if (typeof updatedAt !== 'string' || updatedAt === '') {
          return undefined;
        }
        const grypeUpdatedAt =
          configuration.scanner === 'both'
            ? await getGrypeDatabaseUpdatedAt(
                `${configuration.grype.command || 'grype'}`.trim() || 'grype',
              )
            : undefined;
        if (configuration.scanner === 'both' && !grypeUpdatedAt) {
          return undefined;
        }

        const status: TrivyDatabaseStatus = {
          updatedAt:
            configuration.scanner === 'both' ? `${updatedAt}|grype:${grypeUpdatedAt}` : updatedAt,
          downloadedAt:
            typeof parsed?.VulnerabilityDB?.DownloadedAt === 'string'
              ? parsed.VulnerabilityDB.DownloadedAt
              : undefined,
        };
        if (trivyDbStatusInFlight === inFlightEntry) {
          trivyDbStatusCache = { status, expiresAt: now + TRIVY_DB_STATUS_CACHE_TTL_MS };
        }
        return status;
      } catch {
        return undefined;
      }
    })(),
  };
  trivyDbStatusInFlight = inFlightEntry;

  try {
    return await inFlightEntry.promise;
  } finally {
    if (trivyDbStatusInFlight === inFlightEntry) {
      trivyDbStatusInFlight = undefined;
    }
  }
}

export async function getSecurityRuntimeStatus(): Promise<SecurityRuntimeStatus> {
  const configuration = getSecurityConfiguration();
  const backend = configuration.backend || 'command';
  const sbomGenerator: 'trivy' | 'syft' =
    configuration.sbom.generator === 'syft' ||
    (configuration.sbom.generator === 'auto' && configuration.scanner === 'grype')
      ? 'syft'
      : 'trivy';
  const scannerProviders = (
    configuration.scanner === 'both'
      ? ['trivy', 'grype']
      : configuration.scanner
        ? [configuration.scanner]
        : []
  ) as Array<'trivy' | 'grype'>;
  const requiredProviders = Array.from(
    new Set([...scannerProviders, ...(configuration.sbom.enabled ? [sbomGenerator] : [])]),
  ) as Array<'trivy' | 'grype' | 'syft'>;
  let assets: ScannerAssetStatus[] = [];
  let providerStatuses: SecurityRuntimeProviderStatus[];

  if (backend === 'command') {
    providerStatuses = await Promise.all(
      requiredProviders.map(async (provider) => {
        const providerConfiguration = configuration[provider];
        const check = await resolveRuntimeToolCheck(true, providerConfiguration.command, provider);
        const toolName = `${provider[0].toUpperCase()}${provider.slice(1)}` as
          | 'Trivy'
          | 'Grype'
          | 'Syft';
        return {
          provider,
          role: scannerProviders.includes(provider as 'trivy' | 'grype') ? 'scanner' : 'sbom',
          enabled: true,
          command: check.command,
          commandAvailable: check.availability.available,
          status: check.availability.available ? 'ready' : 'missing',
          message: check.availability.available
            ? `${toolName} is ready`
            : getUnavailableCommandMessage(toolName, check.command, check.availability.invalidPath),
        };
      }),
    );
  } else {
    try {
      assets = await getDefaultScannerRuntime().assets.status();
      providerStatuses = requiredProviders.map((provider) => {
        const asset = assets.find((candidate) => candidate.provider === provider);
        return {
          provider,
          role: scannerProviders.includes(provider as 'trivy' | 'grype') ? 'scanner' : 'sbom',
          enabled: true,
          command: asset?.configuredImage || configuration[provider].workerImage,
          commandAvailable: asset?.state === 'ready',
          status: asset?.state === 'ready' ? 'ready' : 'missing',
          message:
            asset?.state === 'ready'
              ? `${provider} worker image is ready`
              : asset?.lastError || `${provider} worker image is not ready`,
        };
      });
    } catch (error: unknown) {
      providerStatuses = requiredProviders.map((provider) => ({
        provider,
        role: scannerProviders.includes(provider as 'trivy' | 'grype') ? 'scanner' : 'sbom',
        enabled: true,
        command: configuration[provider].workerImage,
        commandAvailable: false,
        status: 'missing',
        message: error instanceof Error ? error.message : 'Docker scanner runtime is unavailable',
      }));
    }
  }

  const scannerProviderStatuses = providerStatuses.filter(
    (provider) => provider.role === 'scanner',
  );
  const scannersReady =
    scannerProviderStatuses.length > 0 &&
    scannerProviderStatuses.every((provider) => provider.status === 'ready');
  const scannerCheck: RuntimeToolCheck = {
    enabled: configuration.enabled,
    command: scannerProviderStatuses.map((provider) => provider.command).join(', '),
    availability: { available: scannersReady, invalidPath: false },
  };
  const signatureCheck = await resolveRuntimeToolCheck(
    Boolean(configuration.signature.verify),
    configuration.signature.cosign.command,
    'cosign',
  );

  const scannerStatus = configuration.enabled
    ? {
        enabled: true,
        command: scannerCheck.command,
        commandAvailable: scannersReady,
        status: scannersReady ? ('ready' as const) : ('missing' as const),
        message:
          configuration.scanner === 'trivy' && backend === 'command'
            ? scannersReady
              ? configuration.trivy.server
                ? 'Trivy client is ready (server mode enabled)'
                : 'Trivy client is ready'
              : getUnavailableProviderMessage(scannerProviderStatuses, 'Trivy is unavailable')
            : scannersReady
              ? `${configuration.scanner} scanner is ready via ${backend}`
              : getUnavailableProviderMessage(
                  scannerProviderStatuses,
                  'One or more configured scanner providers are unavailable',
                ),
        scanner: configuration.scanner,
        server: configuration.trivy.server || '',
      }
    : {
        ...buildDisabledToolStatus('Vulnerability scanner is disabled'),
        scanner: configuration.scanner,
        server: configuration.trivy.server || '',
      };
  const signatureStatus = buildSignatureRuntimeStatus(signatureCheck);
  const requirements = [
    ...providerStatuses
      .filter((provider) => provider.status !== 'ready')
      .map((provider) =>
        backend === 'command'
          ? `Install ${provider.provider} (configured command: "${provider.command}")`
          : `Pull and warm ${provider.provider} worker (${provider.command})`,
      ),
    buildRequirement('cosign', signatureCheck),
  ].filter(isDefinedValue);

  const ready =
    configuration.enabled &&
    providerStatuses.every((provider) => provider.status === 'ready') &&
    (!configuration.signature.verify || signatureStatus.status === 'ready');

  return {
    checkedAt: new Date().toISOString(),
    ready,
    backend,
    availabilityPolicy: configuration.availabilityPolicy || 'block',
    gate: {
      mode: configuration.gate?.mode || 'on',
      allowNoWorse: configuration.gate?.allowNoWorse === true,
    },
    scanner: scannerStatus,
    signature: signatureStatus,
    sbom: {
      enabled: configuration.sbom.enabled,
      formats: configuration.sbom.formats,
      generator: sbomGenerator,
    },
    providers: providerStatuses,
    assets,
    requirements,
  };
}

export function getScannerAssetManager(): ScannerAssetManager {
  return getDefaultScannerRuntime().assets;
}
