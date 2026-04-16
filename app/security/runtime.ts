import { execFile } from 'node:child_process';
import { isAbsolute as isAbsolutePath, win32 as win32Path } from 'node:path';
import { getSecurityConfiguration, type SecuritySbomFormat } from '../configuration/index.js';

type SecurityRuntimeToolStatus = {
  enabled: boolean;
  command: string;
  commandAvailable: boolean | null;
  status: 'ready' | 'missing' | 'disabled';
  message: string;
};

interface SecurityRuntimeStatus {
  checkedAt: string;
  ready: boolean;
  scanner: SecurityRuntimeToolStatus & {
    scanner: string;
    server: string;
  };
  signature: SecurityRuntimeToolStatus;
  sbom: {
    enabled: boolean;
    formats: SecuritySbomFormat[];
  };
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
  toolName: 'Trivy' | 'Cosign',
  command: string,
  invalidPath: boolean,
): string {
  if (invalidPath) {
    return `${toolName} command "${command}" is invalid; use a command name or absolute path`;
  }
  return `${toolName} command "${command}" is not available in this runtime`;
}

function buildScannerMessage(check: RuntimeToolCheck, server: string): string {
  if (check.availability.available) {
    if (server) {
      return 'Trivy client is ready (server mode enabled)';
    }
    return 'Trivy client is ready';
  }
  return getUnavailableCommandMessage('Trivy', check.command, check.availability.invalidPath);
}

function buildSignatureMessage(check: RuntimeToolCheck): string {
  if (check.availability.available) {
    return 'Cosign is ready for signature verification';
  }
  return getUnavailableCommandMessage('Cosign', check.command, check.availability.invalidPath);
}

function buildScannerRuntimeStatus(
  check: RuntimeToolCheck,
  configuredScanner: string,
  server: string,
): SecurityRuntimeToolStatus & { scanner: string; server: string } {
  if (!check.enabled) {
    return {
      ...buildDisabledToolStatus('Vulnerability scanner is disabled'),
      scanner: configuredScanner,
      server,
    };
  }

  return {
    enabled: true,
    command: check.command,
    commandAvailable: check.availability.available,
    status: check.availability.available ? 'ready' : 'missing',
    message: buildScannerMessage(check, server),
    scanner: 'trivy',
    server,
  };
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

export async function getTrivyDatabaseStatus(): Promise<TrivyDatabaseStatus | undefined> {
  const now = Date.now();
  if (trivyDbStatusCache && trivyDbStatusCache.expiresAt > now) {
    return trivyDbStatusCache.status;
  }
  if (trivyDbStatusInFlight) {
    return trivyDbStatusInFlight.promise;
  }

  const configuration = getSecurityConfiguration();
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

        const status: TrivyDatabaseStatus = {
          updatedAt,
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
  const scannerCheck = await resolveRuntimeToolCheck(
    configuration.enabled && configuration.scanner === 'trivy',
    configuration.trivy.command,
    'trivy',
  );
  const signatureCheck = await resolveRuntimeToolCheck(
    Boolean(configuration.signature.verify),
    configuration.signature.cosign.command,
    'cosign',
  );

  const scannerStatus = buildScannerRuntimeStatus(
    scannerCheck,
    configuration.scanner || '',
    configuration.trivy.server || '',
  );
  const signatureStatus = buildSignatureRuntimeStatus(signatureCheck);
  const requirements = [
    buildRequirement('trivy', scannerCheck),
    buildRequirement('cosign', signatureCheck),
  ].filter(isDefinedValue);

  const ready = scannerCheck.enabled && scannerCheck.availability.available;

  return {
    checkedAt: new Date().toISOString(),
    ready,
    scanner: scannerStatus,
    signature: signatureStatus,
    sbom: {
      enabled: configuration.sbom.enabled,
      formats: configuration.sbom.formats,
    },
    requirements,
  };
}
