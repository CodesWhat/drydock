import { execFile } from 'node:child_process';
import {
  getSecurityConfiguration,
  SECURITY_SEVERITY_VALUES as SECURITY_SEVERITIES,
  type SecuritySeverity,
} from '../configuration/index.js';
import log from '../log/index.js';

export { SECURITY_SEVERITIES, type SecuritySeverity };
export type SecurityScanStatus = 'passed' | 'blocked' | 'error';

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

export interface ScanImageOptions {
  image: string;
  auth?: {
    username?: string;
    password?: string;
  };
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

const MAX_TRIVY_OUTPUT_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_STORED_VULNERABILITIES = 500;

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

function runTrivyCommand(
  options: ScanImageOptions,
  configuration: ReturnType<typeof getSecurityConfiguration>,
): Promise<string> {
  const trivyCommand = configuration.trivy.command || 'trivy';
  const args = [
    'image',
    '--quiet',
    '--format',
    'json',
    '--scanners',
    'vuln',
    '--severity',
    SECURITY_SEVERITIES.join(','),
    '--timeout',
    toTrivyTimeout(configuration.trivy.timeout),
  ];

  if (configuration.trivy.server) {
    args.push('--server', configuration.trivy.server);
  }

  args.push(options.image);

  const env = { ...process.env };
  if (options.auth?.password !== undefined) {
    env.TRIVY_USERNAME = options.auth.username ?? '';
    env.TRIVY_PASSWORD = options.auth.password;
  }

  return new Promise((resolve, reject) => {
    const child = execFile(
      trivyCommand,
      args,
      {
        maxBuffer: MAX_TRIVY_OUTPUT_BYTES,
        timeout: configuration.trivy.timeout,
        env,
      },
      (error, stdout, stderr) => {
        if (error) {
          const exitCode = (error as NodeJS.ErrnoException)?.code ?? child.exitCode ?? 'unknown';
          const stderrValue = `${stderr || ''}`.trim();
          const errorMessage = stderrValue || error.message;
          reject(
            new Error(`Trivy command failed (exit=${exitCode}): ${errorMessage || 'unknown error'}`),
          );
          return;
        }
        resolve(`${stdout || ''}`);
      },
    );
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
    const trivyOutput = await runTrivyCommand(options, configuration);
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

