import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import type { Request } from 'express';
import joi from 'joi';
import setValue from 'set-value';
import { logWarn } from '../log/warn.js';
import { recordLegacyInput } from '../prometheus/compatibility.js';
import { resolveConfiguredPath } from '../runtime/paths.js';

const VAR_FILE_SUFFIX = '__FILE';
const MAX_SECRET_FILE_SIZE_BYTES = 1024 * 1024;
export const SECURITY_SEVERITY_VALUES = ['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export const SECURITY_SBOM_FORMAT_VALUES = ['spdx-json', 'cyclonedx-json'] as const;
const SERVER_COOKIE_SAMESITE_VALUES = ['strict', 'lax', 'none'] as const;
const DEFAULT_SECURITY_BLOCK_SEVERITY = 'CRITICAL,HIGH';
const DEFAULT_SECURITY_SBOM_FORMATS = 'spdx-json';

export type SecuritySeverity = (typeof SECURITY_SEVERITY_VALUES)[number];
export type SecuritySbomFormat = (typeof SECURITY_SBOM_FORMAT_VALUES)[number];

/*
 * Get a prop by path from environment variables.
 * @param prop
 * @returns {{}}
 */
export function get(prop: string, env: Record<string, string | undefined> = process.env) {
  const object: Record<string, unknown> = {};
  const envVarPattern = prop.replaceAll('.', '_').toUpperCase();
  const matchingEnvVars = Object.keys(env).filter((envKey) => envKey.startsWith(envVarPattern));
  matchingEnvVars.forEach((matchingEnvVar) => {
    const envVarValue = env[matchingEnvVar];
    const matchingPropPath = matchingEnvVar.replaceAll('_', '.').toLowerCase();
    const matchingPropPathWithoutPrefix = matchingPropPath.replaceAll(`${prop}.`, '');
    setValue(object, matchingPropPathWithoutPrefix, envVarValue);
  });
  return object;
}

/**
 * Lookup external secrets defined in files.
 * @param ddEnvVars
 */
export async function replaceSecrets(ddEnvVars: Record<string, string | undefined>) {
  const secretFileEnvVars = Object.keys(ddEnvVars).filter((ddEnvVar) =>
    ddEnvVar.toUpperCase().endsWith(VAR_FILE_SUFFIX),
  );
  for (const secretFileEnvVar of secretFileEnvVars) {
    const secretKey = secretFileEnvVar.replaceAll(VAR_FILE_SUFFIX, '');
    const secretFilePath = resolveConfiguredPath(ddEnvVars[secretFileEnvVar], {
      label: `${secretFileEnvVar} path`,
    });

    const secretFileValue = await readFile(secretFilePath, 'utf-8');
    if (Buffer.byteLength(secretFileValue, 'utf-8') > MAX_SECRET_FILE_SIZE_BYTES) {
      throw new Error(
        `Secret file for ${secretFileEnvVar} exceeds maximum size of ${MAX_SECRET_FILE_SIZE_BYTES} bytes`,
      );
    }
    delete ddEnvVars[secretFileEnvVar];
    ddEnvVars[secretKey] = secretFileValue;
  }
}

// 1. Get a copy of all dd-related env vars (DD_ primary, WUD_ legacy fallback)
export const ddEnvVars: Record<string, string | undefined> = {};
const mappedLegacyEnvVars = new Set<string>();
const warnedLegacyTriggerEnvVars = new Set<string>();
const triggerLegacyPrefixUsage = new Set<string>();
let packageVersionCache: string | undefined;
let packageVersionResolved = false;

// First, collect legacy WUD_ vars and remap to DD_ keys
Object.keys(process.env)
  .filter((envVar) => envVar.toUpperCase().startsWith('WUD_'))
  .forEach((envVar) => {
    const ddKey = `DD_${envVar.substring(4)}`; // WUD_FOO → DD_FOO
    ddEnvVars[ddKey] = process.env[envVar];
    const envVarUpper = envVar.toUpperCase();
    mappedLegacyEnvVars.add(envVarUpper);
    recordLegacyInput('env', envVarUpper);
  });

if (mappedLegacyEnvVars.size > 0) {
  const legacyEnvVarNames = Array.from(mappedLegacyEnvVars).sort();
  const MAX_LEGACY_ENV_WARNING_KEYS = 10;
  const envVarPreview = legacyEnvVarNames.slice(0, MAX_LEGACY_ENV_WARNING_KEYS).join(', ');
  const additionalCount = legacyEnvVarNames.length - MAX_LEGACY_ENV_WARNING_KEYS;
  const suffix = additionalCount > 0 ? ` (+${additionalCount} more)` : '';
  console.warn(
    `Detected legacy WUD_* environment variables, deprecated and scheduled for removal in v1.6.0. Please migrate to DD_* equivalents: ${envVarPreview}${suffix}`,
  );
}

// Then, collect DD_ vars (overrides WUD_ if both set)
Object.keys(process.env)
  .filter((envVar) => envVar.toUpperCase().startsWith('DD_'))
  .forEach((envVar) => {
    ddEnvVars[envVar] = process.env[envVar];
  });

// 2. Replace all secret files referenced by their secret values
await replaceSecrets(ddEnvVars);

export function getVersion() {
  const configuredVersion = ddEnvVars.DD_VERSION?.trim();
  if (configuredVersion && configuredVersion.toLowerCase() !== 'unknown') {
    return configuredVersion;
  }

  if (!packageVersionResolved) {
    packageVersionResolved = true;
    const packageJsonCandidates = [
      new URL('../package.json', import.meta.url),
      new URL('../../package.json', import.meta.url),
    ];

    for (const packageJsonUrl of packageJsonCandidates) {
      try {
        const packageJsonRaw = fs.readFileSync(packageJsonUrl, 'utf-8');
        const packageJson = JSON.parse(packageJsonRaw) as { version?: unknown };
        if (typeof packageJson.version === 'string' && packageJson.version.trim()) {
          packageVersionCache = packageJson.version.trim();
          break;
        }
      } catch {
        // Continue until we find a readable package.json with a version field.
      }
    }
  }

  return packageVersionCache || 'unknown';
}

/**
 * Get the server name used to identify this Drydock instance in notifications.
 * Configured via DD_SERVER_NAME, falls back to os.hostname().
 */
export function getServerName(): string {
  const configured = ddEnvVars.DD_SERVER_NAME?.trim();
  if (configured) {
    return configured;
  }
  return hostname();
}

export function getLogLevel() {
  return ddEnvVars.DD_LOG_LEVEL || 'info';
}

export function getLogFormat() {
  return ddEnvVars.DD_LOG_FORMAT?.toLowerCase() === 'json' ? 'json' : 'text';
}

export function getLogBufferEnabled() {
  return ddEnvVars.DD_LOG_BUFFER_ENABLED?.trim().toLowerCase() !== 'false';
}

export function getLocalWatcherEnabled() {
  return ddEnvVars.DD_LOCAL_WATCHER?.trim().toLowerCase() !== 'false';
}

function parseWatcherMaintenanceEnvAlias(envKey: string) {
  const envKeyUpper = envKey.toUpperCase();
  const prefix = 'DD_WATCHER_';
  const tzSuffix = '_MAINTENANCE_WINDOW_TZ';
  const windowSuffix = '_MAINTENANCE_WINDOW';

  if (!envKeyUpper.startsWith(prefix)) {
    return undefined;
  }

  if (envKeyUpper.endsWith(tzSuffix)) {
    const watcherName = envKeyUpper.slice(prefix.length, -tzSuffix.length);
    if (!watcherName) {
      return undefined;
    }
    return { watcherName: watcherName.toLowerCase(), key: 'maintenancewindowtz' };
  }

  if (envKeyUpper.endsWith(windowSuffix)) {
    const watcherName = envKeyUpper.slice(prefix.length, -windowSuffix.length);
    if (!watcherName) {
      return undefined;
    }
    return { watcherName: watcherName.toLowerCase(), key: 'maintenancewindow' };
  }

  return undefined;
}

function normalizeWatcherMaintenanceEnvAliases(
  watcherConfigurations: Record<string, Record<string, unknown>>,
) {
  Object.entries(ddEnvVars).forEach(([envKey, envValue]) => {
    const parsedEnvAlias = parseWatcherMaintenanceEnvAlias(envKey);
    if (!parsedEnvAlias || envValue === undefined) {
      return;
    }
    if (!watcherConfigurations[parsedEnvAlias.watcherName]) {
      watcherConfigurations[parsedEnvAlias.watcherName] = {};
    }
    watcherConfigurations[parsedEnvAlias.watcherName][parsedEnvAlias.key] = envValue;
  });

  Object.values(watcherConfigurations).forEach((watcherConfiguration) => {
    if (
      watcherConfiguration &&
      typeof watcherConfiguration === 'object' &&
      Object.hasOwn(watcherConfiguration, 'maintenance')
    ) {
      delete watcherConfiguration.maintenance;
    }
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function mergeRecords(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };
  Object.keys(override).forEach((key) => {
    const baseValue = merged[key];
    const overrideValue = override[key];
    if (isRecord(baseValue) && isRecord(overrideValue)) {
      merged[key] = mergeRecords(baseValue, overrideValue);
      return;
    }
    merged[key] = overrideValue;
  });
  return merged;
}

function getLegacyTriggerIdFromEnvKey(envKey: string) {
  const envKeyUpper = envKey.toUpperCase();
  const prefix = 'DD_TRIGGER_';

  const triggerPath = envKeyUpper
    .slice(prefix.length)
    .split('_')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);

  if (triggerPath.length < 2) {
    return undefined;
  }

  return `${triggerPath[0]}.${triggerPath[1]}`;
}

function collectLegacyTriggerUsage() {
  triggerLegacyPrefixUsage.clear();

  Object.keys(ddEnvVars)
    .filter((envKey) => envKey.toUpperCase().startsWith('DD_TRIGGER_'))
    .forEach((envKey) => {
      const envValue = ddEnvVars[envKey];
      if (envValue === undefined) {
        return;
      }

      const envKeyUpper = envKey.toUpperCase();
      const legacyTriggerId = getLegacyTriggerIdFromEnvKey(envKeyUpper);
      if (legacyTriggerId) {
        triggerLegacyPrefixUsage.add(legacyTriggerId);
      }

      if (!warnedLegacyTriggerEnvVars.has(envKeyUpper)) {
        warnedLegacyTriggerEnvVars.add(envKeyUpper);
        recordLegacyInput('env', envKeyUpper);
        logWarn(
          `Legacy trigger environment variable "${envKeyUpper}" is deprecated and will be removed in v1.7.0. Use DD_ACTION_* or DD_NOTIFICATION_* instead.`,
        );
      }
    });
}

function getTriggerConfigurationsForPrefix(prefix: string) {
  return get(prefix, ddEnvVars) as Record<string, Record<string, unknown>>;
}
/**
 * Get watcher configuration.
 */
export function getWatcherConfigurations() {
  const watcherConfigurations = get('dd.watcher', ddEnvVars) as Record<
    string,
    Record<string, unknown>
  >;
  normalizeWatcherMaintenanceEnvAliases(watcherConfigurations);
  return watcherConfigurations;
}

/**
 * Get trigger configurations.
 */
export function getTriggerConfigurations() {
  collectLegacyTriggerUsage();
  const legacyTriggerConfigurations = getTriggerConfigurationsForPrefix('dd.trigger');
  const actionTriggerConfigurations = getTriggerConfigurationsForPrefix('dd.action');
  const notificationTriggerConfigurations = getTriggerConfigurationsForPrefix('dd.notification');

  return mergeRecords(
    mergeRecords(legacyTriggerConfigurations, actionTriggerConfigurations),
    notificationTriggerConfigurations,
  );
}

export function usesLegacyTriggerPrefix(triggerType: string, triggerName: string) {
  return triggerLegacyPrefixUsage.has(`${triggerType}.${triggerName}`.toLowerCase());
}

/**
 * Get registry configurations.
 * @returns {*}
 */
export function getRegistryConfigurations() {
  return get('dd.registry', ddEnvVars);
}

/**
 * Get authentication configurations.
 * @returns {*}
 */
export function getAuthenticationConfigurations() {
  return get('dd.auth', ddEnvVars);
}

/**
 * Get Agent configurations.
 * @returns {*}
 */
export function getAgentConfigurations() {
  return get('dd.agent', ddEnvVars);
}

/**
 * Get Input configurations.
 */
export function getStoreConfiguration() {
  return get('dd.store', ddEnvVars);
}

/**
 * Get Server configurations.
 */
export function getServerConfiguration() {
  const configurationFromEnv = get('dd.server', ddEnvVars);
  const configurationSchema = joi.object().keys({
    enabled: joi.boolean().default(true),
    port: joi.number().default(3000).integer().min(0).max(65535),
    tls: joi
      .object({
        enabled: joi.boolean().default(false),
        key: joi.string().when('enabled', {
          is: true,
          then: joi.required(),
          otherwise: joi.optional(),
        }),
        cert: joi.string().when('enabled', {
          is: true,
          then: joi.required(),
          otherwise: joi.optional(),
        }),
      })
      .default({}),
    cors: joi
      .object({
        enabled: joi.boolean().default(false),
        origin: joi.string().default('*'),
        methods: joi.string().default('GET,HEAD,PUT,PATCH,POST,DELETE'),
      })
      .default({}),
    compression: joi
      .object({
        enabled: joi.boolean().default(true),
        threshold: joi.number().integer().min(0).default(1024),
      })
      .default({}),
    ui: joi
      .object({
        enabled: joi.boolean().default(true),
      })
      .default({}),
    feature: joi
      .object({
        delete: joi.boolean().default(true),
        containeractions: joi.boolean().default(true),
      })
      .default({
        delete: true,
        containeractions: true,
      }),
    cookie: joi
      .object({
        samesite: joi
          .string()
          .trim()
          .lowercase()
          .valid(...SERVER_COOKIE_SAMESITE_VALUES)
          .default('lax'),
      })
      .default({}),
    trustproxy: joi
      .alternatives()
      .try(joi.boolean(), joi.number().integer().min(0), joi.string())
      .default(false),
    session: joi
      .object({
        maxconcurrentsessions: joi.number().integer().min(1).default(5),
      })
      .default({}),
    ratelimit: joi
      .object({
        identitykeying: joi.boolean(),
      })
      .optional(),
    metrics: joi
      .object({
        auth: joi.boolean().default(true),
        token: joi.string().min(16).allow('').default(''),
      })
      .default({}),
  });

  // Validate Configuration
  const configurationToValidate = configurationSchema.validate(configurationFromEnv, {
    allowUnknown: true,
    stripUnknown: true,
  });
  if (configurationToValidate.error) {
    throw configurationToValidate.error;
  }
  return configurationToValidate.value;
}

/**
 * Get Prometheus configurations.
 */
export function getPrometheusConfiguration() {
  const configurationFromEnv = get('dd.prometheus', ddEnvVars);
  const configurationSchema = joi.object().keys({
    enabled: joi.boolean().default(true),
  });

  const configurationToValidate = configurationSchema.validate(configurationFromEnv);
  if (configurationToValidate.error) {
    throw configurationToValidate.error;
  }
  return configurationToValidate.value;
}

/**
 * Get Webhook configurations.
 */
export function getWebhookConfiguration() {
  const configurationFromEnv = get('dd.server.webhook', ddEnvVars);
  const configurationSchema = joi.object().keys({
    enabled: joi.boolean().default(false),
    secret: joi.string().allow('').default(''),
    token: joi.string().allow('').default(''),
    tokens: joi
      .object({
        watchall: joi.string().allow('').default(''),
        watch: joi.string().allow('').default(''),
        update: joi.string().allow('').default(''),
      })
      .default({
        watchall: '',
        watch: '',
        update: '',
      }),
  });
  const configurationToValidate = configurationSchema.validate(configurationFromEnv);
  if (configurationToValidate.error) {
    throw configurationToValidate.error;
  }

  const configuration = configurationToValidate.value;
  const hasAnyToken = [
    configuration.token,
    configuration.tokens?.watchall,
    configuration.tokens?.watch,
    configuration.tokens?.update,
  ].some((token) => typeof token === 'string' && token.length > 0);
  const hasSecret = typeof configuration.secret === 'string' && configuration.secret.length > 0;

  const endpointTokens = [
    configuration.tokens?.watchall,
    configuration.tokens?.watch,
    configuration.tokens?.update,
  ];
  const hasAnyEndpointToken = endpointTokens.some(
    (token) => typeof token === 'string' && token.length > 0,
  );
  const hasAllEndpointTokens = endpointTokens.every(
    (token) => typeof token === 'string' && token.length > 0,
  );

  if (configuration.enabled && hasAnyEndpointToken && !hasAllEndpointTokens) {
    throw new Error(
      'All endpoint-specific webhook tokens (DD_SERVER_WEBHOOK_TOKENS_WATCHALL, DD_SERVER_WEBHOOK_TOKENS_WATCH, DD_SERVER_WEBHOOK_TOKENS_UPDATE) must be configured together when any DD_SERVER_WEBHOOK_TOKENS_* value is set',
    );
  }

  if (configuration.enabled && !hasAnyToken && !hasSecret) {
    throw new Error(
      'At least one webhook auth mechanism (DD_SERVER_WEBHOOK_SECRET, DD_SERVER_WEBHOOK_TOKEN, or DD_SERVER_WEBHOOK_TOKENS_*) must be configured when webhooks are enabled',
    );
  }

  return configuration;
}

function parseSecuritySeverityList(rawValue: string | undefined): SecuritySeverity[] {
  if (rawValue !== undefined && rawValue.trim().toUpperCase() === 'NONE') {
    return [];
  }
  return parseDelimitedEnumList(
    rawValue,
    DEFAULT_SECURITY_BLOCK_SEVERITY,
    (value) => value.toUpperCase(),
    (severity): severity is SecuritySeverity =>
      SECURITY_SEVERITY_VALUES.includes(severity as SecuritySeverity),
    {
      onInvalidValues: ({ invalidValues, parsedValues, defaultValues }) => {
        const warningBase = `Invalid DD_SECURITY_BLOCK_SEVERITY values: ${invalidValues.join(', ')}. Allowed values: NONE, ${SECURITY_SEVERITY_VALUES.join(', ')}.`;
        if (parsedValues.length === 0) {
          console.warn(`${warningBase} Falling back to defaults: ${defaultValues.join(', ')}.`);
        } else {
          console.warn(`${warningBase} Invalid values were ignored.`);
        }
      },
    },
  );
}

function parseSecuritySbomFormatList(rawValue: string | undefined): SecuritySbomFormat[] {
  return parseDelimitedEnumList(
    rawValue,
    DEFAULT_SECURITY_SBOM_FORMATS,
    (format) => format.toLowerCase(),
    (format): format is SecuritySbomFormat =>
      SECURITY_SBOM_FORMAT_VALUES.includes(format as SecuritySbomFormat),
    {
      onInvalidValues: ({ invalidValues, parsedValues, defaultValues }) => {
        const warningBase = `Invalid DD_SECURITY_SBOM_FORMATS values: ${invalidValues.join(', ')}. Allowed values: ${SECURITY_SBOM_FORMAT_VALUES.join(', ')}.`;
        if (parsedValues.length === 0) {
          logWarn(`${warningBase} Falling back to defaults: ${defaultValues.join(', ')}.`);
        } else {
          logWarn(`${warningBase} Invalid values were ignored.`);
        }
      },
    },
  );
}

function parseDelimitedEnumList<T extends string>(
  rawValue: string | undefined,
  defaultRawValue: string,
  normalizeValue: (value: string) => string,
  isAllowedValue: (value: string) => value is T,
  options?: {
    onInvalidValues?: (context: {
      defaultValues: T[];
      parsedValues: T[];
      invalidValues: string[];
    }) => void;
  },
): T[] {
  const defaultValues = defaultRawValue
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value !== '')
    .filter(isAllowedValue);
  if (!rawValue) {
    return defaultValues;
  }

  const configuredValues = rawValue
    .split(',')
    .map((value) => normalizeValue(value.trim()))
    .filter((value) => value !== '');
  if (configuredValues.length === 0) {
    return defaultValues;
  }

  const deduplicatedValues = Array.from(new Set(configuredValues));
  const parsedValues = deduplicatedValues.filter(isAllowedValue);
  const invalidValues = deduplicatedValues.filter((value) => !isAllowedValue(value));
  if (invalidValues.length > 0) {
    options?.onInvalidValues?.({
      defaultValues,
      parsedValues,
      invalidValues,
    });
  }
  if (parsedValues.length === 0) {
    return defaultValues;
  }
  return parsedValues;
}

function validateCosignKeyPath(rawKeyPath: string): string {
  if (!rawKeyPath) {
    return '';
  }

  const resolvedKeyPath = resolveConfiguredPath(rawKeyPath, {
    label: 'DD_SECURITY_COSIGN_KEY',
  });

  try {
    const keyStats = fs.statSync(resolvedKeyPath);
    if (!keyStats.isFile()) {
      throw new Error('DD_SECURITY_COSIGN_KEY must reference an existing regular file');
    }
  } catch (e: unknown) {
    if (
      e instanceof Error &&
      e.message === 'DD_SECURITY_COSIGN_KEY must reference an existing regular file'
    ) {
      throw e;
    }
    throw new Error('DD_SECURITY_COSIGN_KEY must reference an existing regular file');
  }

  return resolvedKeyPath;
}

export function getSecurityConfiguration() {
  const configurationFromEnv = get('dd.security', ddEnvVars);
  const configurationSchema = joi.object().keys({
    scanner: joi.string().insensitive().valid('trivy').allow('').default(''),
    block: joi
      .object({
        severity: joi.string().allow('').default(DEFAULT_SECURITY_BLOCK_SEVERITY),
      })
      .default({}),
    trivy: joi
      .object({
        server: joi.string().allow('').default(''),
        command: joi.string().default('trivy'),
        timeout: joi.number().integer().min(1000).default(120000),
      })
      .default({}),
    verify: joi
      .object({
        signatures: joi.boolean().default(false),
      })
      .default({}),
    cosign: joi
      .object({
        command: joi.string().default('cosign'),
        timeout: joi.number().integer().min(1000).default(60000),
        key: joi
          .string()
          .allow('')
          .default('')
          .pattern(/^(?!.*\.\.)/, 'no path traversal'),
        identity: joi.string().allow('').default(''),
        issuer: joi.string().allow('').default(''),
      })
      .default({}),
    sbom: joi
      .object({
        enabled: joi.boolean().default(false),
        formats: joi.string().allow('').default(DEFAULT_SECURITY_SBOM_FORMATS),
      })
      .default({}),
    scan: joi
      .object({
        cron: joi.string().allow('').default(''),
        jitter: joi.number().integer().min(0).default(60000),
        concurrency: joi.number().integer().min(1).default(4),
        batch: joi
          .object({
            timeout: joi.number().integer().min(0).default(1800000),
          })
          .default({}),
      })
      .default({}),
  });

  const configurationToValidate = configurationSchema.validate(configurationFromEnv, {
    allowUnknown: true,
    stripUnknown: true,
  });
  if (configurationToValidate.error) {
    throw configurationToValidate.error;
  }

  const configuration = configurationToValidate.value;
  const scanner = configuration.scanner ? configuration.scanner.toLowerCase() : '';
  const blockSeverities = parseSecuritySeverityList(configuration.block?.severity);
  const sbomFormats = parseSecuritySbomFormatList(configuration.sbom?.formats);
  const cosignKey = validateCosignKeyPath(configuration.cosign?.key || '');

  return {
    enabled: scanner !== '',
    scanner,
    blockSeverities,
    trivy: {
      server: configuration.trivy?.server || '',
      command: configuration.trivy?.command || 'trivy',
      timeout: configuration.trivy?.timeout || 120000,
    },
    signature: {
      verify: Boolean(configuration.verify?.signatures),
      cosign: {
        command: configuration.cosign?.command || 'cosign',
        timeout: configuration.cosign?.timeout || 60000,
        key: cosignKey,
        identity: configuration.cosign?.identity || '',
        issuer: configuration.cosign?.issuer || '',
      },
    },
    sbom: {
      enabled: Boolean(configuration.sbom?.enabled),
      formats: sbomFormats,
    },
    scan: {
      cron: configuration.scan?.cron || '',
      jitter: configuration.scan?.jitter ?? 60000,
      concurrency: configuration.scan?.concurrency ?? 4,
      batchTimeout: configuration.scan?.batch?.timeout ?? 1800000,
    },
  };
}

export type SecurityConfiguration = Pick<
  ReturnType<typeof getSecurityConfiguration>,
  'enabled' | 'scanner' | 'sbom'
> & {
  signature: Pick<ReturnType<typeof getSecurityConfiguration>['signature'], 'verify'>;
};

const DNS_MODE_VALUES = ['ipv4first', 'ipv6first', 'verbatim'] as const;
export type DnsMode = (typeof DNS_MODE_VALUES)[number];

/**
 * Get DNS result ordering mode from DD_DNS_MODE.
 * Defaults to 'ipv4first' to work around musl libc (Alpine) resolver issues (#161).
 */
export function getDnsMode(): DnsMode {
  const raw = ddEnvVars.DD_DNS_MODE?.trim().toLowerCase();
  if (raw && DNS_MODE_VALUES.includes(raw as DnsMode)) {
    return raw as DnsMode;
  }
  return 'ipv4first';
}

function parseSafePublicUrlCandidate(value: unknown): URL | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmedValue = value.trim();
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional control char detection for input validation
  const controlCharacterPattern = /[\x00-\x1F\x7F]/;
  if (trimmedValue.length === 0 || controlCharacterPattern.test(trimmedValue)) {
    return undefined;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmedValue);
  } catch {
    return undefined;
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return undefined;
  }
  if (parsedUrl.username !== '' || parsedUrl.password !== '') {
    return undefined;
  }
  return parsedUrl;
}

export function getPublicUrl(req: Request) {
  const publicUrl = ddEnvVars.DD_PUBLIC_URL;
  const configuredPublicUrl = parseSafePublicUrlCandidate(publicUrl);
  if (configuredPublicUrl) {
    return configuredPublicUrl.origin;
  }
  if (typeof publicUrl === 'string' && publicUrl.trim().length > 0) {
    return '/';
  }

  // Try to infer from request, with strict validation to prevent host/header injection.
  const protocol = typeof req.protocol === 'string' ? req.protocol : '';
  const hostname = typeof req.hostname === 'string' ? req.hostname : '';
  const inferredPublicUrl = parseSafePublicUrlCandidate(`${protocol}://${hostname}`);
  if (!inferredPublicUrl) {
    return '/';
  }
  if (inferredPublicUrl.hostname !== hostname.toLowerCase()) {
    return '/';
  }
  return inferredPublicUrl.origin;
}
