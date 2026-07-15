import { hasValidCommandPath } from '../runtime.js';
import type { ContainerVulnerability } from '../scan.js';

const MAX_GRYPE_OUTPUT_BYTES = 50 * 1024 * 1024;
const MAX_GRYPE_PARSE_BYTES = 20 * 1024 * 1024;

export interface GrypeInvocationOptions {
  image: string;
  auth?: {
    username?: string;
    password?: string;
  };
}

export interface GrypeInvocationConfiguration {
  command?: string;
  timeout: number;
  extraArgs?: unknown;
}

export interface GrypeInvocation {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  timeout: number;
  maxBuffer: number;
  commandName: string;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toSortedUniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(value.map(toTrimmedString).filter((item): item is string => item !== undefined)),
  ).sort();
}

function normalizeGrypeSeverity(value: unknown): ContainerVulnerability['severity'] {
  const severity = toTrimmedString(value)?.toUpperCase();
  switch (severity) {
    case 'CRITICAL':
    case 'HIGH':
    case 'MEDIUM':
    case 'LOW':
      return severity;
    default:
      return 'UNKNOWN';
  }
}

function getTarget(artifact: JsonRecord): string | undefined {
  const locations = Array.isArray(artifact.locations) ? artifact.locations : [];
  const paths = locations.flatMap((location) => {
    if (!isRecord(location)) {
      return [];
    }
    const path = toTrimmedString(location.path);
    return path ? [path] : [];
  });
  return Array.from(new Set(paths)).sort()[0];
}

function getFixedVersion(vulnerability: JsonRecord): string | undefined {
  const fix = isRecord(vulnerability.fix) ? vulnerability.fix : {};
  const versions = toSortedUniqueStrings(fix.versions);
  return versions.length > 0 ? versions.join(', ') : undefined;
}

function getPrimaryUrl(vulnerability: JsonRecord): string | undefined {
  const dataSource = toTrimmedString(vulnerability.dataSource);
  if (dataSource) {
    return dataSource;
  }
  return toSortedUniqueStrings(vulnerability.urls)[0];
}

export function parseGrypeOutput(output: string): ContainerVulnerability[] {
  const outputBytes = Buffer.byteLength(output, 'utf8');
  if (outputBytes > MAX_GRYPE_PARSE_BYTES) {
    throw new Error(
      `Grype output is too large to parse (${outputBytes} bytes); max supported is ${MAX_GRYPE_PARSE_BYTES} bytes`,
    );
  }

  const parsed = JSON.parse(output) as unknown;
  if (!isRecord(parsed) || !Array.isArray(parsed.matches)) {
    return [];
  }

  return parsed.matches.flatMap((match): ContainerVulnerability[] => {
    if (!isRecord(match)) {
      return [];
    }
    const artifact = isRecord(match.artifact) ? match.artifact : {};
    const vulnerability = isRecord(match.vulnerability) ? match.vulnerability : {};

    return [
      {
        id: toTrimmedString(vulnerability.id) || 'unknown-vulnerability',
        target: getTarget(artifact),
        packageName: toTrimmedString(artifact.name),
        installedVersion: toTrimmedString(artifact.version),
        fixedVersion: getFixedVersion(vulnerability),
        severity: normalizeGrypeSeverity(vulnerability.severity),
        title: toTrimmedString(vulnerability.description),
        primaryUrl: getPrimaryUrl(vulnerability),
      },
    ];
  });
}

function validateExtraArgs(value: unknown): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error('Grype extra arguments must be an array of non-empty strings');
  }

  return value.map((item) => {
    if (typeof item !== 'string' || item.trim() === '' || item.includes('\0')) {
      throw new Error(
        'Grype extra arguments must be an array of non-empty strings without NUL bytes',
      );
    }
    const argument = item.trim();
    if (
      argument === '--output' ||
      argument.startsWith('--output=') ||
      argument === '-o' ||
      argument.startsWith('-o=') ||
      argument === '--file' ||
      argument.startsWith('--file=') ||
      argument === '-f' ||
      argument.startsWith('-f=')
    ) {
      throw new Error('Grype extra arguments cannot override JSON or file output');
    }
    return argument;
  });
}

export function buildGrypeInvocation(
  options: GrypeInvocationOptions,
  configuration: GrypeInvocationConfiguration,
): GrypeInvocation {
  const command = `${configuration.command || 'grype'}`.trim() || 'grype';
  if (!hasValidCommandPath(command)) {
    throw new Error(`Grype command "${command}" is invalid; use a command name or absolute path`);
  }

  const env = { ...process.env };
  if (options.auth?.password !== undefined) {
    env.SYFT_REGISTRY_AUTH_USERNAME = options.auth.username ?? '';
    env.SYFT_REGISTRY_AUTH_PASSWORD = options.auth.password;
  }

  return {
    command,
    args: [
      '--output',
      'json',
      ...validateExtraArgs(configuration.extraArgs),
      `registry:${options.image}`,
    ],
    env,
    timeout: configuration.timeout,
    maxBuffer: MAX_GRYPE_OUTPUT_BYTES,
    commandName: 'Grype',
  };
}
