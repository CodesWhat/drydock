import { execFile } from 'node:child_process';
import { isAbsolute as isAbsolutePath, win32 as win32Path } from 'node:path';
import { getSecurityConfiguration, type SecuritySbomFormat } from '../configuration/index.js';

export type SecurityRuntimeToolStatus = {
  enabled: boolean;
  command: string;
  commandAvailable: boolean | null;
  status: 'ready' | 'missing' | 'disabled';
  message: string;
};

export interface SecurityRuntimeStatus {
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

function hasValidCommandPath(command: string): boolean {
  if (command.includes('\0') || DISALLOWED_COMMAND_CHARACTERS_PATTERN.test(command)) {
    return false;
  }

  const hasPathSeparator = command.includes('/') || command.includes('\\');
  if (hasPathSeparator) {
    return isAbsolutePath(command) || win32Path.isAbsolute(command);
  }

  return !/\s/.test(command);
}

function checkCommandAvailability(command: string): Promise<CommandAvailabilityResult> {
  const commandValue = `${command || ''}`.trim();
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

export function clearTrivyDatabaseStatusCache(): void {
  trivyDbStatusCache = undefined;
}

export async function getTrivyDatabaseStatus(): Promise<TrivyDatabaseStatus | undefined> {
  const now = Date.now();
  if (trivyDbStatusCache && trivyDbStatusCache.expiresAt > now) {
    return trivyDbStatusCache.status;
  }

  const configuration = getSecurityConfiguration();
  const trivyCommand = configuration.trivy.command || 'trivy';

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
    trivyDbStatusCache = { status, expiresAt: now + TRIVY_DB_STATUS_CACHE_TTL_MS };
    return status;
  } catch {
    return undefined;
  }
}

export async function getSecurityRuntimeStatus(): Promise<SecurityRuntimeStatus> {
  const configuration = getSecurityConfiguration();

  const scannerEnabled = configuration.enabled && configuration.scanner === 'trivy';
  const scannerCommand = scannerEnabled ? configuration.trivy.command || 'trivy' : '';
  const scannerAvailability = scannerEnabled
    ? await checkCommandAvailability(scannerCommand)
    : { available: false, invalidPath: false };

  const signatureEnabled = Boolean(configuration.signature.verify);
  const signatureCommand = signatureEnabled
    ? configuration.signature.cosign.command || 'cosign'
    : '';
  const signatureAvailability = signatureEnabled
    ? await checkCommandAvailability(signatureCommand)
    : { available: false, invalidPath: false };

  const scannerStatus: SecurityRuntimeToolStatus & { scanner: string; server: string } =
    scannerEnabled
      ? {
          enabled: true,
          command: scannerCommand,
          commandAvailable: scannerAvailability.available,
          status: scannerAvailability.available ? 'ready' : 'missing',
          message: scannerAvailability.available
            ? configuration.trivy.server
              ? 'Trivy client is ready (server mode enabled)'
              : 'Trivy client is ready'
            : scannerAvailability.invalidPath
              ? `Trivy command "${scannerCommand}" is invalid; use a command name or absolute path`
              : `Trivy command "${scannerCommand}" is not available in this runtime`,
          scanner: 'trivy',
          server: configuration.trivy.server || '',
        }
      : {
          ...buildDisabledToolStatus('Vulnerability scanner is disabled'),
          scanner: configuration.scanner || '',
          server: configuration.trivy.server || '',
        };

  const signatureStatus: SecurityRuntimeToolStatus = signatureEnabled
    ? {
        enabled: true,
        command: signatureCommand,
        commandAvailable: signatureAvailability.available,
        status: signatureAvailability.available ? 'ready' : 'missing',
        message: signatureAvailability.available
          ? 'Cosign is ready for signature verification'
          : signatureAvailability.invalidPath
            ? `Cosign command "${signatureCommand}" is invalid; use a command name or absolute path`
            : `Cosign command "${signatureCommand}" is not available in this runtime`,
      }
    : buildDisabledToolStatus('Signature verification is disabled');

  const requirements: string[] = [];
  if (scannerEnabled && !scannerAvailability.available) {
    requirements.push(`Install trivy (configured command: "${scannerCommand}")`);
  }
  if (signatureEnabled && !signatureAvailability.available) {
    requirements.push(`Install cosign (configured command: "${signatureCommand}")`);
  }

  const ready = scannerEnabled && scannerAvailability.available;

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
