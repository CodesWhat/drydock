import { execFile } from 'node:child_process';
import {
  getSecurityConfiguration,
  SECURITY_SBOM_FORMAT_VALUES as SECURITY_SBOM_FORMATS,
  SECURITY_SEVERITY_VALUES as SECURITY_SEVERITIES,
  type SecuritySbomFormat,
  type SecuritySeverity,
} from '../configuration/index.js';
import { getDefaultCacheMaxEntries } from '../configuration/runtime-defaults.js';
import log from '../log/index.js';
import { sanitizeLogParam } from '../log/sanitize.js';
import { toPositiveInteger } from '../util/parse.js';
import { buildGrypeInvocation, parseGrypeOutput } from './providers/grype.js';
import { hasValidCommandPath } from './runtime.js';
import { getDefaultScannerRuntime } from './scanner-runtime.js';
import { createTrivyDatabaseWarmup } from './trivy-warmup.js';

export { SECURITY_SBOM_FORMATS, type SecuritySbomFormat, type SecuritySeverity, toPositiveInteger };
export type SecurityScanStatus = 'passed' | 'blocked' | 'error';
export type SecuritySignatureStatus = 'verified' | 'unverified' | 'error';
export type SecuritySbomStatus = 'generated' | 'error';
export type SecurityScanner = 'trivy' | 'grype' | 'both';

export interface ContainerVulnerabilitySummary {
  unknown: number;
  low: number;
  medium: number;
  high: number;
  critical: number;
}

export interface ContainerVulnerability {
  id: string;
  target?: string;
  packageName?: string;
  installedVersion?: string;
  fixedVersion?: string;
  severity: SecuritySeverity;
  title?: string;
  primaryUrl?: string;
  scanners?: Array<'trivy' | 'grype'>;
}

export interface ContainerSecurityScan {
  scanner: SecurityScanner;
  image: string;
  imageDigest?: string;
  scannedAt: string;
  status: SecurityScanStatus;
  blockSeverities: SecuritySeverity[];
  blockingCount: number;
  summary: ContainerVulnerabilitySummary;
  vulnerabilities: ContainerVulnerability[];
  relativeGate?: {
    decision: 'passed' | 'blocked';
    reason: 'no-worse-than-current' | 'candidate-worse' | 'current-scan-unavailable';
    currentSummary?: ContainerVulnerabilitySummary;
  };
  error?: string;
}

export interface ContainerSignatureVerification {
  verifier: 'cosign';
  image: string;
  verifiedAt: string;
  status: SecuritySignatureStatus;
  keyless: boolean;
  signatures: number;
  error?: string;
}

export interface ContainerSecuritySbom {
  generator: 'trivy' | 'syft';
  image: string;
  subjectDigest?: string;
  generatedAt: string;
  status: SecuritySbomStatus;
  formats: SecuritySbomFormat[];
  /** Legacy inline documents retained only until startup migration succeeds. */
  documents?: Partial<Record<SecuritySbomFormat, unknown>>;
  documentRefs?: Partial<
    Record<SecuritySbomFormat, { key: string; sha256: string; bytes: number }>
  >;
  error?: string;
}

interface ScanImageOptions {
  image: string;
  retryTransient?: boolean;
  auth?: {
    username?: string;
    password?: string;
  };
}

interface GenerateSbomOptions extends ScanImageOptions {
  formats?: SecuritySbomFormat[];
}

interface TrivyRawVulnerability {
  VulnerabilityID?: string;
  Severity?: string;
  PkgName?: string;
  InstalledVersion?: string;
  FixedVersion?: string;
  Title?: string;
  PrimaryURL?: string;
}

interface TrivyRawResult {
  Target?: string;
  Vulnerabilities?: TrivyRawVulnerability[];
}

interface TrivyRawOutput {
  Results?: TrivyRawResult[];
}

const MAX_TRIVY_OUTPUT_BYTES = 50 * 1024 * 1024; // 50 MB
const MAX_TRIVY_PARSE_BYTES = 20 * 1024 * 1024; // 20 MB
const MAX_COSIGN_OUTPUT_BYTES = 2 * 1024 * 1024; // 2 MB
const MAX_SYFT_OUTPUT_BYTES = 50 * 1024 * 1024; // 50 MB
const MAX_STORED_VULNERABILITIES = 500;
const TRIVY_PROCESS_TIMEOUT_GRACE_MS = 30_000;
const TRIVY_DB_WARMUP_TIMEOUT_MS = 10 * 60 * 1000;
const TRIVY_DB_WARMUP_MAX_BUFFER_BYTES = 512 * 1024;
const DEFAULT_DIGEST_SCAN_CACHE_MAX_ENTRIES = getDefaultCacheMaxEntries();
const COSIGN_UNVERIFIED_PATTERNS = [
  'no matching signatures',
  'no signatures found',
  'signature verification failed',
  'invalid signature',
];

export const DIGEST_SCAN_CACHE_MAX_ENTRIES = toPositiveInteger(
  process.env.DD_SECURITY_SCAN_DIGEST_CACHE_MAX_ENTRIES,
  DEFAULT_DIGEST_SCAN_CACHE_MAX_ENTRIES,
);

let trivyQueue: Promise<void> = Promise.resolve();

function enqueueTrivy<T>(operation: () => Promise<T>): Promise<T> {
  const previousTail = trivyQueue;
  let resolve: () => void;
  const gate = new Promise<void>((r) => {
    resolve = r;
  });
  trivyQueue = gate;
  return previousTail
    .catch(() => undefined)
    .then(async () => {
      try {
        return await operation();
      } finally {
        resolve?.();
      }
    });
}

/** @internal — test-only reset */
export function _resetTrivyQueueForTesting(): void {
  trivyQueue = Promise.resolve();
}

/** @internal — test-only reject queue to exercise defensive recovery path */
export function _setTrivyQueueRejectedForTesting(): void {
  trivyQueue = Promise.reject(new Error('forced queue rejection'));
}

function createEmptySummary(): ContainerVulnerabilitySummary {
  return {
    unknown: 0,
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };
}

function normalizeSeverity(severity: string | undefined): SecuritySeverity {
  const severityNormalized = `${severity || ''}`.trim().toUpperCase();
  if (SECURITY_SEVERITIES.includes(severityNormalized as SecuritySeverity)) {
    return severityNormalized as SecuritySeverity;
  }
  return 'UNKNOWN';
}

function buildSummary(vulnerabilities: ContainerVulnerability[]): ContainerVulnerabilitySummary {
  const summary = createEmptySummary();
  vulnerabilities.forEach((vulnerability) => {
    switch (vulnerability.severity) {
      case 'CRITICAL':
        summary.critical += 1;
        break;
      case 'HIGH':
        summary.high += 1;
        break;
      case 'MEDIUM':
        summary.medium += 1;
        break;
      case 'LOW':
        summary.low += 1;
        break;
      default:
        summary.unknown += 1;
    }
  });
  return summary;
}

function parseTrivyOutput(trivyOutput: string): ContainerVulnerability[] {
  const trivyOutputBytes = Buffer.byteLength(trivyOutput, 'utf8');
  if (trivyOutputBytes > MAX_TRIVY_PARSE_BYTES) {
    throw new Error(
      `Trivy output is too large to parse (${trivyOutputBytes} bytes); max supported is ${MAX_TRIVY_PARSE_BYTES} bytes`,
    );
  }
  const parsedOutput = JSON.parse(trivyOutput) as TrivyRawOutput;
  const results = Array.isArray(parsedOutput?.Results) ? parsedOutput.Results : [];
  const vulnerabilities = results.flatMap((result) => {
    const target = typeof result?.Target === 'string' ? result.Target : undefined;
    const targetVulnerabilities = Array.isArray(result?.Vulnerabilities)
      ? result.Vulnerabilities
      : [];
    return targetVulnerabilities.map((vulnerability) => ({
      id: vulnerability?.VulnerabilityID || 'unknown-vulnerability',
      target,
      packageName: vulnerability?.PkgName,
      installedVersion: vulnerability?.InstalledVersion,
      fixedVersion: vulnerability?.FixedVersion,
      severity: normalizeSeverity(vulnerability?.Severity),
      title: vulnerability?.Title,
      primaryUrl: vulnerability?.PrimaryURL,
    }));
  });
  return vulnerabilities;
}

function toTrivyTimeout(durationMs: number) {
  const timeoutSeconds = Math.max(1, Math.ceil(durationMs / 1000));
  return `${timeoutSeconds}s`;
}

function runCommand(options: {
  command: string;
  args: string[];
  timeout: number;
  reportedTimeout?: number;
  maxBuffer: number;
  env: NodeJS.ProcessEnv;
  commandName: string;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      options.command,
      options.args,
      {
        maxBuffer: options.maxBuffer,
        timeout: options.timeout,
        env: options.env,
      },
      (error, stdout, stderr) => {
        if (error) {
          const commandError = error as NodeJS.ErrnoException & {
            killed?: boolean;
            signal?: string;
          };
          const exitCode = commandError.code ?? child.exitCode ?? 'unknown';
          const stderrValue = `${stderr || ''}`.trim();
          const errorMessage = stderrValue || error.message;
          const maxBufferExceeded = commandError.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
          const processTimedOut =
            !maxBufferExceeded &&
            (commandError.code === 'ETIMEDOUT' ||
              (commandError.killed === true && commandError.signal === 'SIGTERM'));
          const commandTimedOut =
            !maxBufferExceeded &&
            /(?:context deadline exceeded|i\/o timeout|tls handshake timeout|client\.timeout exceeded|(?:request|operation) timed out)/i.test(
              errorMessage,
            );
          if (processTimedOut || commandTimedOut) {
            const configuredTimeout = options.reportedTimeout ?? options.timeout;
            const timeoutMessage = processTimedOut
              ? `${options.commandName} process timed out after ${options.timeout}ms (configured timeout ${configuredTimeout}ms)`
              : `${options.commandName} command timed out after ${configuredTimeout}ms`;
            reject(
              new CommandExecutionError(
                `${timeoutMessage}${errorMessage ? `: ${errorMessage}` : ''}`,
                true,
              ),
            );
            return;
          }
          const transient =
            commandError.code === 'ECONNRESET' ||
            commandError.code === 'EAI_AGAIN' ||
            commandError.code === 'ECONNREFUSED' ||
            /(?:temporary|temporarily unavailable|connection (?:reset|refused)|no such host|temporary failure in name resolution|database.*(?:download|update|lock)|failed to download.*db)/i.test(
              errorMessage,
            );
          reject(
            new CommandExecutionError(
              `${options.commandName} command failed (exit=${exitCode}): ${
                errorMessage || 'unknown error'
              }`,
              transient,
            ),
          );
          return;
        }
        resolve(`${stdout || ''}`);
      },
    );
  });
}

class CommandExecutionError extends Error {
  readonly transient: boolean;

  constructor(message: string, transient: boolean) {
    super(message);
    this.name = 'CommandExecutionError';
    this.transient = transient;
  }
}

function isTransientCommandError(error: unknown): boolean {
  if (error instanceof CommandExecutionError) {
    return error.transient;
  }
  return (
    error instanceof Error &&
    /(?:timed out|timeout|connection (?:reset|refused)|temporary|no such host|pull.*(?:failed|unavailable)|database.*(?:download|update|lock))/i.test(
      error.message,
    )
  );
}

const logTrivyWarmup = log.child({ component: 'security.trivy-warmup' });

export const warmTrivyDatabase = createTrivyDatabaseWarmup({
  getConfiguration: () => getSecurityConfiguration(),
  timeoutMs: TRIVY_DB_WARMUP_TIMEOUT_MS,
  failureCooldownMs: 15 * 60 * 1000,
  execute: (operation) => enqueueTrivy(operation),
  run: async ({ command, args, timeoutMs }) => {
    if (!hasValidCommandPath(command)) {
      throw new Error(
        `Trivy command "${sanitizeLogParam(command)}" is invalid; use a command name or absolute path`,
      );
    }
    await runCommand({
      command,
      args,
      timeout: timeoutMs + TRIVY_PROCESS_TIMEOUT_GRACE_MS,
      reportedTimeout: timeoutMs,
      maxBuffer: TRIVY_DB_WARMUP_MAX_BUFFER_BYTES,
      env: process.env,
      commandName: 'Trivy database warm-up',
    });
  },
  onFailure: (error) => {
    logTrivyWarmup.warn(
      `Trivy database warm-up failed (${sanitizeLogParam(
        getErrorMessage(error, 'Unknown Trivy database warm-up error'),
      )}); the scan will continue with Trivy's normal database handling`,
    );
  },
});

function buildTrivyEnvironment(options: ScanImageOptions) {
  const env = { ...process.env };
  if (options.auth?.password !== undefined) {
    env.TRIVY_USERNAME = options.auth.username ?? '';
    env.TRIVY_PASSWORD = options.auth.password;
  }
  return env;
}

// Trivy uses 'cyclonedx' (not 'cyclonedx-json') for CycloneDX JSON output.
const TRIVY_FORMAT_MAP: Partial<Record<string, string>> = {
  'cyclonedx-json': 'cyclonedx',
};

function toTrivyFormat(format: string): string {
  return TRIVY_FORMAT_MAP[format] ?? format;
}

function validateProviderExtraArgs(
  provider: string,
  extraArgs: string[],
  protectedFlags: string[],
): string[] {
  for (const argument of extraArgs) {
    if (protectedFlags.some((flag) => argument === flag || argument.startsWith(`${flag}=`))) {
      throw new Error(`${provider} extra arguments cannot override ${argument.split('=')[0]}`);
    }
  }
  return extraArgs;
}

function buildTrivyArgs(
  configuration: ReturnType<typeof getSecurityConfiguration>,
  outputFormat: 'json' | SecuritySbomFormat,
) {
  const args = [
    'image',
    '--quiet',
    '--format',
    toTrivyFormat(outputFormat),
    '--timeout',
    toTrivyTimeout(configuration.trivy.timeout),
  ];

  if (outputFormat === 'json') {
    args.push('--scanners', 'vuln', '--severity', SECURITY_SEVERITIES.join(','));
  }

  if (configuration.trivy.server) {
    args.push('--server', configuration.trivy.server);
  }

  if (configuration.trivy.imageSrc) {
    args.push('--image-src', configuration.trivy.imageSrc);
  }

  args.push(
    ...validateProviderExtraArgs('Trivy', configuration.trivy.extraArgs || [], [
      '--format',
      '--output',
      '--timeout',
      '--server',
      '--scanners',
      '--severity',
    ]),
  );

  return args;
}

function runTrivyVulnerabilityCommand(
  options: ScanImageOptions,
  configuration: ReturnType<typeof getSecurityConfiguration>,
): Promise<string> {
  return enqueueTrivy(() => {
    const trivyCommand = `${configuration.trivy.command || 'trivy'}`.trim() || 'trivy';
    if (!hasValidCommandPath(trivyCommand)) {
      throw new Error(
        `Trivy command "${sanitizeLogParam(trivyCommand)}" is invalid; use a command name or absolute path`,
      );
    }
    const args = [...buildTrivyArgs(configuration, 'json'), options.image];

    const invocation = {
      command: trivyCommand,
      args,
      timeout: configuration.trivy.timeout + TRIVY_PROCESS_TIMEOUT_GRACE_MS,
      reportedTimeout: configuration.trivy.timeout,
      maxBuffer: MAX_TRIVY_OUTPUT_BYTES,
      env: buildTrivyEnvironment(options),
      commandName: 'Trivy',
    };
    if (configuration.backend === 'command') {
      return runCommand(invocation);
    }
    return getDefaultScannerRuntime().run({
      provider: 'trivy',
      args,
      env: invocation.env,
      timeoutMs: invocation.timeout,
      maxOutputBytes: invocation.maxBuffer,
    });
  });
}

function runTrivySbomCommand(
  options: ScanImageOptions,
  configuration: ReturnType<typeof getSecurityConfiguration>,
  format: SecuritySbomFormat,
): Promise<string> {
  return enqueueTrivy(() => {
    const trivyCommand = `${configuration.trivy.command || 'trivy'}`.trim() || 'trivy';
    if (!hasValidCommandPath(trivyCommand)) {
      throw new Error(
        `Trivy command "${sanitizeLogParam(trivyCommand)}" is invalid; use a command name or absolute path`,
      );
    }
    const args = [...buildTrivyArgs(configuration, format), options.image];

    const invocation = {
      command: trivyCommand,
      args,
      timeout: configuration.trivy.timeout + TRIVY_PROCESS_TIMEOUT_GRACE_MS,
      reportedTimeout: configuration.trivy.timeout,
      maxBuffer: MAX_TRIVY_OUTPUT_BYTES,
      env: buildTrivyEnvironment(options),
      commandName: 'Trivy',
    };
    if (configuration.backend === 'command') {
      return runCommand(invocation);
    }
    return getDefaultScannerRuntime().run({
      provider: 'trivy',
      args,
      env: invocation.env,
      timeoutMs: invocation.timeout,
      maxOutputBytes: invocation.maxBuffer,
    });
  });
}

async function runTrivyVulnerabilityCommandWithRetry(
  options: ScanImageOptions,
  configuration: ReturnType<typeof getSecurityConfiguration>,
): Promise<string> {
  try {
    return await runTrivyVulnerabilityCommand(options, configuration);
  } catch (error: unknown) {
    if (!options.retryTransient || !isTransientCommandError(error)) {
      throw error;
    }
    return runTrivyVulnerabilityCommand(options, configuration);
  }
}

function runGrypeVulnerabilityCommand(
  options: ScanImageOptions,
  configuration: ReturnType<typeof getSecurityConfiguration>,
): Promise<string> {
  const invocation = buildGrypeInvocation(options, configuration.grype);
  if (configuration.backend === 'command') {
    return runCommand(invocation);
  }
  return getDefaultScannerRuntime().run({
    provider: 'grype',
    args: invocation.args,
    env: invocation.env,
    timeoutMs: invocation.timeout,
    maxOutputBytes: invocation.maxBuffer,
  });
}

async function runGrypeVulnerabilityCommandWithRetry(
  options: ScanImageOptions,
  configuration: ReturnType<typeof getSecurityConfiguration>,
): Promise<string> {
  try {
    return await runGrypeVulnerabilityCommand(options, configuration);
  } catch (error: unknown) {
    if (!options.retryTransient || !isTransientCommandError(error)) {
      throw error;
    }
    return runGrypeVulnerabilityCommand(options, configuration);
  }
}

function resolveSbomGenerator(configuration: ReturnType<typeof getSecurityConfiguration>) {
  if (configuration.sbom.generator === 'trivy' || configuration.sbom.generator === 'syft') {
    return configuration.sbom.generator;
  }
  return configuration.scanner === 'grype' ? 'syft' : 'trivy';
}

function buildSyftEnvironment(options: ScanImageOptions): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (options.auth?.password !== undefined) {
    env.SYFT_REGISTRY_AUTH_USERNAME = options.auth.username ?? '';
    env.SYFT_REGISTRY_AUTH_PASSWORD = options.auth.password;
  }
  return env;
}

function runSyftSbomCommand(
  options: ScanImageOptions,
  configuration: ReturnType<typeof getSecurityConfiguration>,
  format: SecuritySbomFormat,
): Promise<string> {
  const command = `${configuration.syft.command || 'syft'}`.trim() || 'syft';
  if (!hasValidCommandPath(command)) {
    throw new Error(
      `Syft command "${sanitizeLogParam(command)}" is invalid; use a command name or absolute path`,
    );
  }
  const args = [
    `registry:${options.image}`,
    '--output',
    format,
    ...validateProviderExtraArgs('Syft', configuration.syft.extraArgs || [], [
      '--output',
      '-o',
      '--file',
    ]),
  ];
  const env = buildSyftEnvironment(options);
  if (configuration.backend === 'command') {
    return runCommand({
      command,
      args,
      timeout: configuration.syft.timeout,
      maxBuffer: MAX_SYFT_OUTPUT_BYTES,
      env,
      commandName: 'Syft',
    });
  }
  return getDefaultScannerRuntime().run({
    provider: 'syft',
    args,
    env,
    timeoutMs: configuration.syft.timeout,
    maxOutputBytes: MAX_SYFT_OUTPUT_BYTES,
  });
}

function buildCosignEnvironment(options: ScanImageOptions) {
  const env = { ...process.env };
  if (options.auth?.username) {
    env.COSIGN_REGISTRY_USERNAME = options.auth.username;
  }
  if (options.auth?.password) {
    env.COSIGN_REGISTRY_PASSWORD = options.auth.password;
  }
  return env;
}

function runCosignVerifyCommand(
  options: ScanImageOptions,
  configuration: ReturnType<typeof getSecurityConfiguration>,
): Promise<string> {
  const cosignCommand = `${configuration.signature.cosign.command || 'cosign'}`.trim() || 'cosign';
  if (!hasValidCommandPath(cosignCommand)) {
    throw new Error(
      `Cosign command "${sanitizeLogParam(cosignCommand)}" is invalid; use a command name or absolute path`,
    );
  }
  const args = ['verify', '--output', 'json'];
  if (configuration.signature.cosign.key) {
    args.push('--key', configuration.signature.cosign.key);
  }
  if (configuration.signature.cosign.identity) {
    args.push('--certificate-identity', configuration.signature.cosign.identity);
  }
  if (configuration.signature.cosign.issuer) {
    args.push('--certificate-oidc-issuer', configuration.signature.cosign.issuer);
  }
  args.push(options.image);

  return runCommand({
    command: cosignCommand,
    args,
    timeout: configuration.signature.cosign.timeout,
    maxBuffer: MAX_COSIGN_OUTPUT_BYTES,
    env: buildCosignEnvironment(options),
    commandName: 'Cosign',
  });
}

function getBlockingCount(
  vulnerabilities: ContainerVulnerability[],
  blockSeverities: SecuritySeverity[],
): number {
  const blockSeveritySet = new Set(blockSeverities);
  return vulnerabilities.filter((vulnerability) => blockSeveritySet.has(vulnerability.severity))
    .length;
}

function mapToErrorResult(
  image: string,
  blockSeverities: SecuritySeverity[],
  errorMessage: string,
  scanner: SecurityScanner = 'trivy',
): ContainerSecurityScan {
  return {
    scanner,
    image,
    scannedAt: new Date().toISOString(),
    status: 'error',
    blockSeverities,
    blockingCount: 0,
    summary: createEmptySummary(),
    vulnerabilities: [],
    error: errorMessage,
  };
}

type ProviderScanResult = {
  provider: 'trivy' | 'grype';
  vulnerabilities: ContainerVulnerability[];
  error?: string;
};

async function scanWithProvider(
  provider: 'trivy' | 'grype',
  options: ScanImageOptions,
  configuration: ReturnType<typeof getSecurityConfiguration>,
): Promise<ProviderScanResult> {
  try {
    if (provider === 'trivy') {
      if (configuration.backend === 'command') {
        await warmTrivyDatabase();
      } else {
        const runtime = getDefaultScannerRuntime();
        if (runtime.assets.get('trivy').state !== 'ready') {
          await runtime.assets.warm('trivy');
        }
      }
      const output = await runTrivyVulnerabilityCommandWithRetry(options, configuration);
      return { provider, vulnerabilities: parseTrivyOutput(output) };
    }
    if (configuration.backend !== 'command') {
      const runtime = getDefaultScannerRuntime();
      if (runtime.assets.get('grype').state !== 'ready') {
        await runtime.assets.warm('grype');
      }
    }
    const output = await runGrypeVulnerabilityCommandWithRetry(options, configuration);
    return { provider, vulnerabilities: parseGrypeOutput(output) };
  } catch (error: unknown) {
    return {
      provider,
      vulnerabilities: [],
      error: getErrorMessage(error, 'Unknown security scan error'),
    };
  }
}

function vulnerabilityIdentity(vulnerability: ContainerVulnerability): string {
  return [
    vulnerability.id,
    vulnerability.target || '',
    vulnerability.packageName || '',
    vulnerability.installedVersion || '',
  ].join('\0');
}

function mergeProviderVulnerabilities(results: ProviderScanResult[]): ContainerVulnerability[] {
  const severityRank: Record<SecuritySeverity, number> = {
    UNKNOWN: 0,
    LOW: 1,
    MEDIUM: 2,
    HIGH: 3,
    CRITICAL: 4,
  };
  const merged = new Map<string, ContainerVulnerability>();
  results.forEach((result) => {
    result.vulnerabilities.forEach((vulnerability) => {
      const identity = vulnerabilityIdentity(vulnerability);
      const existing = merged.get(identity);
      if (!existing) {
        merged.set(identity, { ...vulnerability, scanners: [result.provider] });
        return;
      }
      existing.scanners = Array.from(new Set([...existing.scanners!, result.provider])).sort();
      if (severityRank[vulnerability.severity] > severityRank[existing.severity]) {
        existing.severity = vulnerability.severity;
      }
      existing.fixedVersion ||= vulnerability.fixedVersion;
      existing.title ||= vulnerability.title;
      existing.primaryUrl ||= vulnerability.primaryUrl;
    });
  });
  return Array.from(merged.values());
}

function mapToSignatureResult(
  image: string,
  configuration: ReturnType<typeof getSecurityConfiguration>,
  status: SecuritySignatureStatus,
  signatures = 0,
  error?: string,
): ContainerSignatureVerification {
  return {
    verifier: 'cosign',
    image,
    verifiedAt: new Date().toISOString(),
    status,
    keyless: configuration.signature.cosign.key === '',
    signatures,
    ...(error ? { error } : {}),
  };
}

function mapToSbomErrorResult(
  image: string,
  formats: SecuritySbomFormat[],
  errorMessage: string,
  generator: 'trivy' | 'syft' = 'trivy',
): ContainerSecuritySbom {
  return {
    generator,
    image,
    generatedAt: new Date().toISOString(),
    status: 'error',
    formats,
    documentRefs: {},
    error: errorMessage,
  };
}

function resolveSbomFormats(
  requestedFormats: SecuritySbomFormat[] | undefined,
  configuredFormats: SecuritySbomFormat[],
): SecuritySbomFormat[] {
  const source =
    Array.isArray(requestedFormats) && requestedFormats.length > 0
      ? requestedFormats
      : configuredFormats;
  const deduplicated = Array.from(new Set(source));
  const validFormats = deduplicated.filter((format): format is SecuritySbomFormat =>
    SECURITY_SBOM_FORMATS.includes(format as SecuritySbomFormat),
  );
  if (validFormats.length > 0) {
    return validFormats;
  }
  return ['spdx-json'];
}

function parseCosignSignaturesCount(rawOutput: string): number {
  const output = rawOutput.trim();
  if (output === '') {
    return 0;
  }

  try {
    const parsed = JSON.parse(output);
    if (Array.isArray(parsed)) {
      return parsed.length;
    }
    if (parsed && typeof parsed === 'object') {
      return 1;
    }
  } catch {
    // Cosign can emit JSON objects per line; parse line by line as a fallback.
  }

  const lines = output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  let signaturesCount = 0;
  lines.forEach((line) => {
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === 'object') {
        signaturesCount += 1;
      }
    } catch {
      // Ignore malformed lines and keep the successful count.
    }
  });
  return signaturesCount;
}

function classifyCosignFailure(errorMessage: string): SecuritySignatureStatus {
  const normalizedMessage = errorMessage.toLowerCase();
  if (COSIGN_UNVERIFIED_PATTERNS.some((pattern) => normalizedMessage.includes(pattern))) {
    return 'unverified';
  }
  return 'error';
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (typeof error !== 'object' || error === null) {
    return fallback;
  }

  const message = (error as { message?: unknown }).message;
  if (typeof message === 'string') {
    return message || fallback;
  }
  if (message) {
    return `${message}`;
  }
  return fallback;
}

/** Run a vulnerability scan with the configured provider set. */
export async function scanImageForVulnerabilities(
  options: ScanImageOptions,
): Promise<ContainerSecurityScan> {
  const configuration = getSecurityConfiguration();
  const blockSeverities = configuration.blockSeverities;

  if (
    !configuration.enabled ||
    !(['trivy', 'grype', 'both'] as const).includes(configuration.scanner as SecurityScanner)
  ) {
    return mapToErrorResult(
      options.image,
      blockSeverities,
      'Security scanner is disabled or misconfigured',
    );
  }

  const logSecurity = log.child({
    component: 'security.scan',
    scanner: configuration.scanner,
    image: options.image,
  });

  const scanner = configuration.scanner as SecurityScanner;
  const providers: Array<'trivy' | 'grype'> = scanner === 'both' ? ['trivy', 'grype'] : [scanner];
  const providerResults = await Promise.all(
    providers.map((provider) => scanWithProvider(provider, options, configuration)),
  );
  const errors = providerResults
    .filter((result) => result.error)
    .map((result) =>
      scanner === 'both'
        ? `${result.provider === 'trivy' ? 'Trivy' : 'Grype'}: ${result.error}`
        : (result.error as string),
    );
  const vulnerabilities =
    scanner === 'both'
      ? mergeProviderVulnerabilities(providerResults)
      : providerResults[0].vulnerabilities;
  const blockingCount = getBlockingCount(vulnerabilities, blockSeverities);
  const status: SecurityScanStatus =
    blockingCount > 0 ? 'blocked' : errors.length > 0 ? 'error' : 'passed';
  const error = errors.length > 0 ? errors.join('; ') : undefined;

  if (status === 'error') {
    logSecurity.warn(`Security scan failed (${sanitizeLogParam(error as string)})`);
  } else {
    logSecurity.info(
      `Scan finished (${vulnerabilities.length} vulnerabilities, ${blockingCount} blocking)`,
    );
  }

  return {
    scanner,
    image: options.image,
    scannedAt: new Date().toISOString(),
    status,
    blockSeverities,
    blockingCount,
    summary: buildSummary(vulnerabilities),
    vulnerabilities: vulnerabilities.slice(0, MAX_STORED_VULNERABILITIES),
    ...(error ? { error } : {}),
  };
}

/**
 * Verify image signatures with cosign.
 * Returns `unverified` when signatures are missing or invalid,
 * and `error` when the verification process itself fails.
 */
export async function verifyImageSignature(
  options: ScanImageOptions,
): Promise<ContainerSignatureVerification> {
  const configuration = getSecurityConfiguration();
  if (!configuration.signature.verify) {
    return mapToSignatureResult(
      options.image,
      configuration,
      'error',
      0,
      'Signature verification is disabled',
    );
  }

  const logSecurity = log.child({
    component: 'security.signature',
    verifier: 'cosign',
    image: options.image,
  });

  try {
    const cosignOutput = await runCosignVerifyCommand(options, configuration);
    const signatures = parseCosignSignaturesCount(cosignOutput);
    const signaturesCount = signatures > 0 ? signatures : 1;
    logSecurity.info(`Signature verification passed (${signaturesCount} signatures)`);
    return mapToSignatureResult(options.image, configuration, 'verified', signaturesCount);
  } catch (error: unknown) {
    const errorMessage = getErrorMessage(error, 'Unknown signature verification error');
    const status = classifyCosignFailure(errorMessage);
    logSecurity.warn(`Signature verification ${status} (${errorMessage})`);
    return mapToSignatureResult(options.image, configuration, status, 0, errorMessage);
  }
}

/** Generate SBOM documents using the configured provider-neutral generator. */
export async function generateImageSbom(
  options: GenerateSbomOptions,
): Promise<ContainerSecuritySbom> {
  const configuration = getSecurityConfiguration();
  const formats = resolveSbomFormats(options.formats, configuration.sbom.formats);
  const generator = resolveSbomGenerator(configuration);

  if (!configuration.enabled) {
    return mapToSbomErrorResult(
      options.image,
      formats,
      'Security scanner is disabled or misconfigured',
      generator,
    );
  }

  const logSecurity = log.child({
    component: 'security.sbom',
    generator,
    image: options.image,
    formats: formats.join(','),
  });

  const documentMap = new Map<SecuritySbomFormat, unknown>();
  const generatedFormats: SecuritySbomFormat[] = [];
  const errors: string[] = [];

  for (const format of formats) {
    try {
      const sbomOutput =
        generator === 'trivy'
          ? await runTrivySbomCommand(options, configuration, format)
          : await runSyftSbomCommand(options, configuration, format);
      documentMap.set(format, JSON.parse(sbomOutput));
      generatedFormats.push(format);
    } catch (error: unknown) {
      errors.push(`${format}: ${getErrorMessage(error, 'Unknown SBOM generation error')}`);
    }
  }

  const generatedDocuments: Partial<Record<SecuritySbomFormat, unknown>> =
    Object.fromEntries(documentMap);

  if (generatedFormats.length === 0) {
    const errorMessage = errors.join('; ');
    logSecurity.warn(sanitizeLogParam(errorMessage));
    return mapToSbomErrorResult(options.image, formats, errorMessage, generator);
  }

  const sbomResult: ContainerSecuritySbom = {
    generator,
    image: options.image,
    generatedAt: new Date().toISOString(),
    status: 'generated',
    formats: generatedFormats,
    documents: generatedDocuments,
  };

  if (errors.length > 0) {
    sbomResult.error = errors.join('; ');
    logSecurity.warn(`SBOM generation partially failed (${sanitizeLogParam(sbomResult.error)})`);
  } else {
    logSecurity.info(`SBOM generation finished (${sanitizeLogParam(generatedFormats.join(', '))})`);
  }

  return sbomResult;
}

// --- Digest-based scan dedup cache ---

const ERROR_RETRY_FLOOR_MS = 15 * 60 * 1000; // 15 minutes

interface ErrorRetryFloorEntry {
  errorAt: number;
  scanResult: ContainerSecurityScan;
  scannerFingerprint: string;
}

const errorRetryFloor = new Map<string, ErrorRetryFloorEntry>();

/** @internal — test-only reset */
export function _resetErrorRetryFloorForTesting(): void {
  errorRetryFloor.clear();
}

interface DigestScanCacheEntry {
  digest: string;
  scanResult: ContainerSecurityScan;
  scannerFingerprint: string;
  cachedAt: number;
}

const digestScanCache = new Map<string, DigestScanCacheEntry>();

function setDigestScanCacheEntry(
  digest: string,
  scanResult: ContainerSecurityScan,
  assetUpdatedAt: string,
): void {
  if (digestScanCache.has(digest)) {
    digestScanCache.delete(digest);
  }
  digestScanCache.set(digest, {
    digest,
    scanResult,
    scannerFingerprint: getScannerFingerprint(assetUpdatedAt),
    cachedAt: Date.now(),
  });

  while (digestScanCache.size > DIGEST_SCAN_CACHE_MAX_ENTRIES) {
    const oldestDigest = digestScanCache.keys().next().value;
    digestScanCache.delete(oldestDigest as string);
  }
}

function markDigestScanCacheEntryAsRecentlyUsed(digest: string, entry: DigestScanCacheEntry): void {
  digestScanCache.delete(digest);
  digestScanCache.set(digest, entry);
}

export function clearDigestScanCache(): void {
  digestScanCache.clear();
}

export function getDigestScanCacheSize(): number {
  return digestScanCache.size;
}

export function updateDigestScanCache(
  digest: string,
  scanResult: ContainerSecurityScan,
  assetUpdatedAt: string,
): void {
  setDigestScanCacheEntry(digest, { ...scanResult, imageDigest: digest }, assetUpdatedAt);
}

function getScannerFingerprint(assetUpdatedAt: string): string {
  const configuration = getSecurityConfiguration();
  return `${configuration.scanner}:${configuration.backend}:${assetUpdatedAt}`;
}

export async function scanImageWithDedup(
  options: ScanImageOptions & { digest: string; trivyDbUpdatedAt?: string },
  scanIntervalMs: number,
): Promise<{ scanResult: ContainerSecurityScan; fromCache: boolean }> {
  const cached = digestScanCache.get(options.digest);
  const dbUpdatedAt = options.trivyDbUpdatedAt;
  const scannerFingerprint = getScannerFingerprint(dbUpdatedAt || '');

  if (
    cached &&
    cached.scannerFingerprint === scannerFingerprint &&
    Date.now() - cached.cachedAt < scanIntervalMs
  ) {
    markDigestScanCacheEntryAsRecentlyUsed(options.digest, cached);
    return {
      scanResult: { ...cached.scanResult, imageDigest: options.digest },
      fromCache: true,
    };
  }

  // If the last scan for this digest errored and we're still within the retry
  // floor window, return the recorded error without spawning Trivy again.
  // This bounds retry frequency under aggressive cron schedules or registry
  // outages without letting the error propagate forever. Issue #357.
  const floorEntry = errorRetryFloor.get(options.digest);
  if (
    floorEntry !== undefined &&
    floorEntry.scannerFingerprint === scannerFingerprint &&
    Date.now() - floorEntry.errorAt < ERROR_RETRY_FLOOR_MS
  ) {
    return {
      scanResult: { ...floorEntry.scanResult, imageDigest: options.digest },
      fromCache: true,
    };
  }

  const rawScanResult = await scanImageForVulnerabilities(options);
  const scanResult = { ...rawScanResult, imageDigest: options.digest };

  if (scanResult.status === 'error') {
    // Record the error so we can enforce the retry floor on subsequent calls.
    // Do not cache the error in the main cache — a later successful scan
    // should always overwrite without a TTL barrier.
    errorRetryFloor.set(options.digest, {
      errorAt: Date.now(),
      scanResult,
      scannerFingerprint,
    });
  } else if (!scanResult.error) {
    // Clear any previous error floor entry and store the successful result.
    errorRetryFloor.delete(options.digest);
    setDigestScanCacheEntry(options.digest, scanResult, dbUpdatedAt || '');
  }

  return { scanResult, fromCache: false };
}
