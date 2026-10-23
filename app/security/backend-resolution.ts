import fs from 'node:fs';
import path from 'node:path';
import log from '../log/index.js';
import { sanitizeLogParam } from '../log/sanitize.js';
import { recordLegacyInput } from '../prometheus/compatibility.js';

export type ScannerProviderId = 'trivy' | 'grype' | 'syft' | 'cosign';
export type ProviderExecution = 'command' | 'worker';

interface ProviderCommandSettings {
  command?: string;
  commandExplicit?: boolean;
}

export interface BackendResolutionConfiguration {
  backend?: string;
  trivy?: ProviderCommandSettings;
  grype?: ProviderCommandSettings;
  syft?: ProviderCommandSettings;
  signature?: { cosign?: ProviderCommandSettings };
}

const DEFAULT_COMMANDS: Record<ScannerProviderId, string> = {
  trivy: 'trivy',
  grype: 'grype',
  syft: 'syft',
  cosign: 'cosign',
};

const DISALLOWED_COMMAND_CHARACTERS_PATTERN = /[;|$\s\0]/;

const logBackend = log.child({ component: 'security.backend' });

let bundledTrivyNoticeEmitted = false;

function getProviderSettings(
  provider: ScannerProviderId,
  configuration: BackendResolutionConfiguration,
): ProviderCommandSettings | undefined {
  return provider === 'cosign' ? configuration.signature?.cosign : configuration[provider];
}

function isExecutableFile(candidate: string): boolean {
  try {
    if (!fs.statSync(candidate).isFile()) {
      return false;
    }
    fs.accessSync(candidate, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Synchronously resolves a command name or absolute path the way an exec would. */
export function isCommandOnPath(
  command: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!command || DISALLOWED_COMMAND_CHARACTERS_PATTERN.test(command)) {
    return false;
  }
  if (command.includes('/') || command.includes('\\')) {
    return path.isAbsolute(command) && isExecutableFile(command);
  }
  return (env.PATH ?? '')
    .split(path.delimiter)
    .filter((directory) => directory !== '')
    .some((directory) => isExecutableFile(path.join(directory, command)));
}

/**
 * Decide per provider whether a scan runs a local command or an ephemeral worker container.
 *
 * - `docker` / `remote`: always the worker (except cosign with an explicit command).
 * - `auto`: the command when the binary resolves (or its command is set explicitly), else the worker.
 * - `command`: always the command, except Trivy, which is no longer bundled in the image and
 *   falls back to the pinned worker when no binary resolves.
 */
export function resolveProviderExecution(
  provider: ScannerProviderId,
  configuration: BackendResolutionConfiguration,
): ProviderExecution {
  const backend = configuration.backend || 'auto';
  const settings = getProviderSettings(provider, configuration);
  // cosign has always honored DD_SECURITY_COSIGN_COMMAND regardless of the scanner backend.
  if (provider === 'cosign' && settings?.commandExplicit === true) {
    return 'command';
  }
  if (backend === 'docker' || backend === 'remote') {
    return 'worker';
  }
  if (settings?.commandExplicit === true) {
    return 'command';
  }
  if (isCommandOnPath(settings?.command || DEFAULT_COMMANDS[provider])) {
    return 'command';
  }
  if (backend === 'auto') {
    return 'worker';
  }
  return provider === 'trivy' ? 'worker' : 'command';
}

/** True when Trivy runs in a worker only because the bundled binary was removed. */
export function isBundledTrivyMigration(configuration: BackendResolutionConfiguration): boolean {
  const backend = configuration.backend || 'auto';
  return (
    (backend === 'auto' || backend === 'command') &&
    resolveProviderExecution('trivy', configuration) === 'worker'
  );
}

const TRIVY_SETUPS =
  'DD_SECURITY_SCANNER=grype (recommended), DD_SECURITY_BACKEND=remote with DD_SECURITY_TRIVY_SERVER, or a mounted binary set through DD_SECURITY_TRIVY_COMMAND';

/** Warn once per process and count the migration in the deprecation banner and metrics. */
export function noteBundledTrivyRemoval(): void {
  if (bundledTrivyNoticeEmitted) {
    return;
  }
  bundledTrivyNoticeEmitted = true;
  logBackend.warn(
    `The Trivy binary is no longer bundled in the Drydock image (removed in v1.8.0). Trivy now runs in the pinned Trivy worker container. Switch to one of: ${TRIVY_SETUPS}.`,
  );
  recordLegacyInput('env', 'DD_SECURITY_SCANNER=trivy');
}

/** @internal test helper. */
export function _resetBundledTrivyNoticeForTesting(): void {
  bundledTrivyNoticeEmitted = false;
}

export function isDockerAccessDenied(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const { statusCode, code, message } = error as {
    statusCode?: unknown;
    code?: unknown;
    message?: unknown;
  };
  if (statusCode === 403 || code === 'EACCES') {
    return true;
  }
  return (
    typeof message === 'string' && /\b(denied|forbidden|not permitted|not allowed)\b/i.test(message)
  );
}

export function buildTrivyWorkerDeniedError(cause: unknown): Error {
  const detail =
    cause instanceof Error
      ? cause.message
      : `HTTP ${(cause as { statusCode?: unknown })?.statusCode ?? 'error'}`;
  return new Error(
    `Docker denied creating or attaching the Trivy worker container (${sanitizeLogParam(detail)}). The Trivy binary is no longer bundled in the Drydock image. Use one of: ${TRIVY_SETUPS}.`,
    { cause },
  );
}
