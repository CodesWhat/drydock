import { execFile } from 'node:child_process';
import {
  getSecurityConfiguration,
  SECURITY_SBOM_FORMAT_VALUES as SECURITY_SBOM_FORMATS,
  SECURITY_SEVERITY_VALUES as SECURITY_SEVERITIES,
  type SecuritySbomFormat,
  type SecuritySeverity,
} from '../configuration/index.js';
import log from '../log/index.js';
import { sanitizeLogParam } from '../log/sanitize.js';

export { SECURITY_SEVERITIES, SECURITY_SBOM_FORMATS, type SecuritySeverity, type SecuritySbomFormat };
export type SecurityScanStatus = 'passed' | 'blocked' | 'error';
export type SecuritySignatureStatus = 'verified' | 'unverified' | 'error';
export type SecuritySbomStatus = 'generated' | 'error';

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
}

export interface ContainerSecurityScan {
  scanner: 'trivy';
  image: string;
  scannedAt: string;
  status: SecurityScanStatus;
  blockSeverities: SecuritySeverity[];
  blockingCount: number;
  summary: ContainerVulnerabilitySummary;
  vulnerabilities: ContainerVulnerability[];
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
  generator: 'trivy';
  image: string;
  generatedAt: string;
  status: SecuritySbomStatus;
  formats: SecuritySbomFormat[];
  documents: Partial<Record<SecuritySbomFormat, unknown>>;
  error?: string;
}

export interface ScanImageOptions {
  image: string;
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
const MAX_COSIGN_OUTPUT_BYTES = 2 * 1024 * 1024; // 2 MB
const MAX_STORED_VULNERABILITIES = 500;
const COSIGN_UNVERIFIED_PATTERNS = [
  'no matching signatures',
  'no signatures found',
  'signature verification failed',
  'invalid signature',
];

let trivyQueue: Promise<void> = Promise.resolve();

function enqueueTrivy<T>(operation: () => Promise<T>): Promise<T> {
  const previousTail = trivyQueue;
  let resolve: () => void;
  const gate = new Promise<void>((r) => { resolve = r; });
  trivyQueue = gate;
  return previousTail.catch(() => undefined).then(async () => {
    try {
      return await operation();
    } finally {
      resolve!();
    }
  });
}

/** @internal — test-only reset */
export function _resetTrivyQueueForTesting(): void {
  trivyQueue = Promise.resolve();
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
  const parsedOutput = JSON.parse(trivyOutput) as TrivyRawOutput;
  const results = Array.isArray(parsedOutput?.Results) ? parsedOutput.Results : [];
  const vulnerabilities = results.flatMap((result) => {
    const target = typeof result?.Target === 'string' ? result.Target : undefined;
    const targetVulnerabilities = Array.isArray(result?.Vulnerabilities) ? result.Vulnerabilities : [];
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
  maxBuffer: number;
  env?: NodeJS.ProcessEnv;
  commandName: string;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      options.command,
      options.args,
      {
        maxBuffer: options.maxBuffer,
        timeout: options.timeout,
        env: options.env || process.env,
      },
      (error, stdout, stderr) => {
        if (error) {
          const exitCode = (error as NodeJS.ErrnoException)?.code ?? child.exitCode ?? 'unknown';
          const stderrValue = `${stderr || ''}`.trim();
          const errorMessage = stderrValue || error.message;
          reject(
            new Error(
              `${options.commandName} command failed (exit=${exitCode}): ${
                errorMessage || 'unknown error'
              }`,
            ),
          );
          return;
        }
        resolve(`${stdout || ''}`);
      },
    );
  });
}

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

  return args;
}

function runTrivyVulnerabilityCommand(
  options: ScanImageOptions,
  configuration: ReturnType<typeof getSecurityConfiguration>,
): Promise<string> {
  return enqueueTrivy(() => {
    const trivyCommand = configuration.trivy.command || 'trivy';
    const args = [...buildTrivyArgs(configuration, 'json'), options.image];

    return runCommand({
      command: trivyCommand,
      args,
      timeout: configuration.trivy.timeout,
      maxBuffer: MAX_TRIVY_OUTPUT_BYTES,
      env: buildTrivyEnvironment(options),
      commandName: 'Trivy',
    });
  });
}

function runTrivySbomCommand(
  options: ScanImageOptions,
  configuration: ReturnType<typeof getSecurityConfiguration>,
  format: SecuritySbomFormat,
): Promise<string> {
  return enqueueTrivy(() => {
    const trivyCommand = configuration.trivy.command || 'trivy';
    const args = [...buildTrivyArgs(configuration, format), options.image];

    return runCommand({
      command: trivyCommand,
      args,
      timeout: configuration.trivy.timeout,
      maxBuffer: MAX_TRIVY_OUTPUT_BYTES,
      env: buildTrivyEnvironment(options),
      commandName: 'Trivy',
    });
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
  const cosignCommand = configuration.signature.cosign.command || 'cosign';
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
  return vulnerabilities.filter((vulnerability) => blockSeveritySet.has(vulnerability.severity)).length;
}

function mapToErrorResult(
  image: string,
  blockSeverities: SecuritySeverity[],
  errorMessage: string,
): ContainerSecurityScan {
  return {
    scanner: 'trivy',
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
): ContainerSecuritySbom {
  return {
    generator: 'trivy',
    image,
    generatedAt: new Date().toISOString(),
    status: 'error',
    formats,
    documents: {},
    error: errorMessage,
  };
}

function resolveSbomFormats(
  requestedFormats: SecuritySbomFormat[] | undefined,
  configuredFormats: SecuritySbomFormat[],
): SecuritySbomFormat[] {
  const source = Array.isArray(requestedFormats) && requestedFormats.length > 0
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

  const lines = output.split('\n').map((line) => line.trim()).filter(Boolean);
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

/**
 * Run vulnerability scan for an image using the configured scanner.
 * Currently supports Trivy only.
 */
export async function scanImageForVulnerabilities(
  options: ScanImageOptions,
): Promise<ContainerSecurityScan> {
  const configuration = getSecurityConfiguration();
  const blockSeverities = configuration.blockSeverities;

  if (!configuration.enabled || configuration.scanner !== 'trivy') {
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

  try {
    const trivyOutput = await runTrivyVulnerabilityCommand(options, configuration);
    const vulnerabilities = parseTrivyOutput(trivyOutput);
    const blockingCount = getBlockingCount(vulnerabilities, blockSeverities);
    const summary = buildSummary(vulnerabilities);
    const vulnerabilitiesToStore = vulnerabilities.slice(0, MAX_STORED_VULNERABILITIES);

    logSecurity.info(
      `Scan finished (${vulnerabilities.length} vulnerabilities, ${blockingCount} blocking)`,
    );

    return {
      scanner: 'trivy',
      image: options.image,
      scannedAt: new Date().toISOString(),
      status: blockingCount > 0 ? 'blocked' : 'passed',
      blockSeverities,
      blockingCount,
      summary,
      vulnerabilities: vulnerabilitiesToStore,
    };
  } catch (error: any) {
    const errorMessage = error?.message || 'Unknown security scan error';
    logSecurity.warn(`Security scan failed (${errorMessage})`);
    return mapToErrorResult(options.image, blockSeverities, errorMessage);
  }
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
  } catch (error: any) {
    const errorMessage = error?.message || 'Unknown signature verification error';
    const status = classifyCosignFailure(errorMessage);
    logSecurity.warn(`Signature verification ${status} (${errorMessage})`);
    return mapToSignatureResult(options.image, configuration, status, 0, errorMessage);
  }
}

/**
 * Generate SBOM documents using Trivy.
 * Supported formats: spdx-json, cyclonedx-json.
 */
export async function generateImageSbom(
  options: GenerateSbomOptions,
): Promise<ContainerSecuritySbom> {
  const configuration = getSecurityConfiguration();
  const formats = resolveSbomFormats(options.formats, configuration.sbom.formats);

  if (!configuration.enabled || configuration.scanner !== 'trivy') {
    return mapToSbomErrorResult(options.image, formats, 'Security scanner is disabled or misconfigured');
  }

  const logSecurity = log.child({
    component: 'security.sbom',
    generator: 'trivy',
    image: options.image,
    formats: formats.join(','),
  });

  const generatedDocuments: Partial<Record<SecuritySbomFormat, unknown>> = {};
  const generatedFormats: SecuritySbomFormat[] = [];
  const errors: string[] = [];

  for (const format of formats) {
    try {
      const sbomOutput = await runTrivySbomCommand(options, configuration, format);
      generatedDocuments[format] = JSON.parse(sbomOutput);
      generatedFormats.push(format);
    } catch (error: any) {
      errors.push(`${format}: ${error?.message || 'Unknown SBOM generation error'}`);
    }
  }

  if (generatedFormats.length === 0) {
    const errorMessage = errors.join('; ') || 'SBOM generation failed';
    logSecurity.warn(sanitizeLogParam(errorMessage));
    return mapToSbomErrorResult(options.image, formats, errorMessage);
  }

  const sbomResult: ContainerSecuritySbom = {
    generator: 'trivy',
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
