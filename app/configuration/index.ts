import fs from 'node:fs';
import os from 'node:os';
import type { Request } from 'express';
import joi from 'joi';
import setValue from 'set-value';
import { logWarn } from '../log/warn.js';
import { resolveConfiguredPath } from '../runtime/paths.js';
import { toPositiveInteger } from '../util/parse.js';

const VAR_FILE_SUFFIX = '__FILE';
const MAX_SECRET_FILE_SIZE_BYTES = 1024 * 1024;
const SECRET_FILE_READ_CHUNK_BYTES = 64 * 1024;
export const SECURITY_SEVERITY_VALUES = ['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export const SECURITY_SBOM_FORMAT_VALUES = ['spdx-json', 'cyclonedx-json'] as const;
const SERVER_COOKIE_SAMESITE_VALUES = ['strict', 'lax', 'none'] as const;
const DEFAULT_SECURITY_BLOCK_SEVERITY = 'CRITICAL,HIGH';
const DEFAULT_SECURITY_SBOM_FORMATS = 'spdx-json';
const DEFAULT_TRIVY_WORKER_IMAGE =
  'aquasec/trivy@sha256:cffe3f5161a47a6823fbd23d985795b3ed72a4c806da4c4df16266c02accdd6f';
const DEFAULT_GRYPE_WORKER_IMAGE =
  'anchore/grype@sha256:af65fbc0c664691067788fe95ff88760b435543e45595eb2ca6f102fc476fbe1';
const DEFAULT_SYFT_WORKER_IMAGE =
  'anchore/syft@sha256:5999d209a342e55e9edf70bf8930fb5b86d8f2a783fa401178372c50e21b1d36';
const DEFAULT_PORTWING_POLL_INTERVAL = 300;

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

function secretFileTooLargeError(secretFileEnvVar: string): Error {
  return new Error(
    `Secret file for ${secretFileEnvVar} exceeds maximum size of ${MAX_SECRET_FILE_SIZE_BYTES} bytes`,
  );
}

async function readBoundedSecretFile(
  secretFile: fs.promises.FileHandle,
  secretFileEnvVar: string,
): Promise<string> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  while (totalBytes <= MAX_SECRET_FILE_SIZE_BYTES) {
    const bytesRemaining = MAX_SECRET_FILE_SIZE_BYTES + 1 - totalBytes;
    const buffer = Buffer.allocUnsafe(Math.min(SECRET_FILE_READ_CHUNK_BYTES, bytesRemaining));
    const { bytesRead } = await secretFile.read(buffer, 0, buffer.length, null);
    if (bytesRead === 0) {
      break;
    }
    chunks.push(buffer.subarray(0, bytesRead));
    totalBytes += bytesRead;
  }

  if (totalBytes > MAX_SECRET_FILE_SIZE_BYTES) {
    throw secretFileTooLargeError(secretFileEnvVar);
  }
  return Buffer.concat(chunks, totalBytes).toString('utf-8');
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

    const secretFile = await fs.promises.open(secretFilePath, 'r');
    let secretFileValue: string;
    try {
      const secretStats = await secretFile.stat();
      if (!secretStats.isFile()) {
        throw new Error(`Secret file for ${secretFileEnvVar} must be a regular file`);
      }
      if (secretStats.size > MAX_SECRET_FILE_SIZE_BYTES) {
        throw secretFileTooLargeError(secretFileEnvVar);
      }

      // Permission check: warn if the opened file is readable by group or others.
      // On non-POSIX platforms (Windows), mode bits are synthetic and do not reflect
      // ACL-based access control, so we skip the check there to avoid false warnings.
      if (os.platform() !== 'win32' && (secretStats.mode & 0o077) !== 0) {
        logWarn(
          `Secret file "${secretFilePath}" (${secretFileEnvVar}) is readable by group or others ` +
            `(mode 0${(secretStats.mode & 0o777).toString(8).padStart(3, '0')}). ` +
            `Restrict permissions with: chmod 600 "${secretFilePath}"`,
        );
      }

      secretFileValue = await readBoundedSecretFile(secretFile, secretFileEnvVar);
    } finally {
      await secretFile.close();
    }

    delete ddEnvVars[secretFileEnvVar];
    // Trim trailing whitespace/newlines to match the Docker *_FILE convention:
    // the official postgres image resolves POSTGRES_PASSWORD_FILE via shell $(< file),
    // which strips the trailing newline that editors and `echo` add. trimEnd()
    // handles both LF and CRLF while preserving leading and internal whitespace.
    ddEnvVars[secretKey] = secretFileValue.trimEnd();
  }
}

// 1. Get a copy of all DD_ environment variables.
export const ddEnvVars: Record<string, string | undefined> = {};
let packageVersionCache: string | undefined;
let packageVersionResolved = false;
let detectedServerName: string | undefined;

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
 * Configured via DD_SERVER_NAME, then a detected daemon host name, then os.hostname().
 */
export function getServerName(): string {
  const configured = ddEnvVars.DD_SERVER_NAME?.trim();
  if (configured) {
    return configured;
  }
  if (detectedServerName) {
    return detectedServerName;
  }
  return os.hostname();
}

export function setDetectedServerName(name: string | undefined): void {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  detectedServerName = trimmed || undefined;
}

export function getDetectedServerName(): string | undefined {
  return detectedServerName;
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

function envFlagEnabled(value: string | undefined) {
  return value?.trim().toLowerCase() === 'true';
}

export function getExperimentalPortwingEnabled() {
  const value = ddEnvVars.DD_EXPERIMENTAL_PORTWING;
  if (value === undefined) {
    return true;
  }
  return envFlagEnabled(value);
}

export function getPortwingPollInterval(): number {
  return toPositiveInteger(ddEnvVars.DD_PORTWING_POLL_INTERVAL, DEFAULT_PORTWING_POLL_INTERVAL);
}

/**
 * Return whether the wud-card compatibility mount (a narrow, opt-in shim
 * that serves WUD-shaped responses for the Home Assistant "wud-card"
 * integration at /api) is enabled. Defaults to false/OFF.
 */
export function getWudCardCompatEnabled() {
  return envFlagEnabled(ddEnvVars.DD_COMPAT_WUDCARD);
}

/**
 * Return the path configured via DD_PORTWING_AUTHORIZED_KEYS, or undefined if unset.
 * When set, drydock loads this authorized_keys file at startup to pre-populate
 * the agent-key registry without requiring one-by-one REST API registration.
 */
export function getPortwingAuthorizedKeysPath(): string | undefined {
  const raw = ddEnvVars.DD_PORTWING_AUTHORIZED_KEYS?.trim();
  return raw || undefined;
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

function normalizeWatcherMaturityEnvAliases(
  watcherConfigurations: Record<string, Record<string, unknown>>,
) {
  const aliases = [
    ['_MATURITY_MIN_AGE_DAYS', 'maturityminagedays'],
    ['_MATURITY_MODE', 'maturitymode'],
  ] as const;
  Object.entries(ddEnvVars).forEach(([envKey, envValue]) => {
    const envKeyUpper = envKey.toUpperCase();
    if (!envKeyUpper.startsWith('DD_WATCHER_') || envValue === undefined) {
      return;
    }
    const alias = aliases.find(([suffix]) => envKeyUpper.endsWith(suffix));
    if (!alias) {
      return;
    }
    const watcherName = envKeyUpper.slice('DD_WATCHER_'.length, -alias[0].length).toLowerCase();
    if (!watcherName) {
      return;
    }
    watcherConfigurations[watcherName] ??= {};
    watcherConfigurations[watcherName][alias[1]] = envValue;
  });
  Object.values(watcherConfigurations).forEach((configuration) => {
    delete configuration.maturity;
  });
}

function normalizeWatcherDiscoveryEnvAliases(
  watcherConfigurations: Record<string, Record<string, unknown>>,
) {
  const aliases = [['_DISCOVERY_SETTLE_MS', 'discoverysettlems']] as const;
  Object.entries(ddEnvVars).forEach(([envKey, envValue]) => {
    const envKeyUpper = envKey.toUpperCase();
    if (!envKeyUpper.startsWith('DD_WATCHER_') || envValue === undefined) {
      return;
    }
    const alias = aliases.find(([suffix]) => envKeyUpper.endsWith(suffix));
    if (!alias) {
      return;
    }
    const watcherName = envKeyUpper.slice('DD_WATCHER_'.length, -alias[0].length).toLowerCase();
    if (!watcherName) {
      return;
    }
    watcherConfigurations[watcherName] ??= {};
    watcherConfigurations[watcherName][alias[1]] = envValue;
  });
  Object.values(watcherConfigurations).forEach((configuration) => {
    delete configuration.discovery;
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

/**
 * Trigger types classified as "action" for the purposes of suggesting a
 * DD_ACTION_ / DD_NOTIFICATION_ replacement for a legacy DD_TRIGGER_* env
 * var below. Mirrors the taxonomy in `triggers/trigger-category.ts`
 * (`ACTION_TRIGGER_TYPES`), but is duplicated here rather than imported —
 * same reasoning as that module's own duplication comment: this is one of
 * the lowest-level modules in the app (nearly everything reads
 * `ddEnvVars`/`get()` from it during startup), so pulling in trigger-domain
 * modules here risks a require cycle.
 */
const ACTION_TRIGGER_ENV_TYPES = new Set(['docker', 'dockercompose', 'command']);

/**
 * Suggest the DD_ACTION_ / DD_NOTIFICATION_ replacement for a detected
 * DD_TRIGGER_* environment variable, based on the trigger type segment
 * (DD_TRIGGER_<TYPE>_<NAME>_...).
 */
function getLegacyTriggerEnvReplacement(envKeyUpper: string): string {
  const prefix = 'DD_TRIGGER_';
  const remainder = envKeyUpper.slice(prefix.length);
  const typeSegment = remainder.split('_')[0].toLowerCase();
  const replacementPrefix = ACTION_TRIGGER_ENV_TYPES.has(typeSegment)
    ? 'DD_ACTION_'
    : 'DD_NOTIFICATION_';
  return `${replacementPrefix}${remainder}`;
}

/**
 * Fail startup with a clear, actionable error when any legacy DD_TRIGGER_*
 * environment variable is present. DD_TRIGGER_* was deprecated in v1.5.0,
 * logged at error level throughout v1.6.0, and is removed entirely in
 * v1.7.0 (see DEPRECATIONS.md). Every detected variable is listed with its
 * exact replacement so a single startup failure is enough to fix a config
 * in one pass, without an iterative fail/retry loop.
 */
function assertNoLegacyTriggerEnvVars(): void {
  const legacyEnvVarKeys = Array.from(
    new Set(
      Object.keys(ddEnvVars)
        .filter((envKey) => ddEnvVars[envKey] !== undefined)
        .map((envKey) => envKey.toUpperCase())
        .filter((envKeyUpper) => envKeyUpper.startsWith('DD_TRIGGER_')),
    ),
  ).sort();

  if (legacyEnvVarKeys.length === 0) {
    return;
  }

  const replacementLines = legacyEnvVarKeys
    .map((envKeyUpper) => `  - ${envKeyUpper} → ${getLegacyTriggerEnvReplacement(envKeyUpper)}`)
    .join('\n');

  throw new Error(
    `The DD_TRIGGER_* environment variable prefix was removed in v1.7.0. ` +
      `Rename ${legacyEnvVarKeys.length} detected variable(s) before starting drydock:\n${replacementLines}\n` +
      `Run "node dist/index.js config migrate --source trigger" to rewrite these automatically, ` +
      `or see https://getdrydock.com/docs/deprecations#legacy-trigger-prefix for manual migration steps.`,
  );
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
  normalizeWatcherMaturityEnvAliases(watcherConfigurations);
  normalizeWatcherDiscoveryEnvAliases(watcherConfigurations);
  return watcherConfigurations;
}

/**
 * Get trigger configurations.
 */
export function getTriggerConfigurations() {
  assertNoLegacyTriggerEnvVars();
  const actionTriggerConfigurations = getTriggerConfigurationsForPrefix('dd.action');
  const notificationTriggerConfigurations = getTriggerConfigurationsForPrefix('dd.notification');

  return mergeRecords(actionTriggerConfigurations, notificationTriggerConfigurations);
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
 *
 * `DD_AGENT_ALLOW_INSECURE_SECRET` is a flat boolean flag (read directly by
 * `AgentClient`), not a per-agent setting. Excluded here so it doesn't get
 * parsed as an agent literally named `allow`.
 * @returns {*}
 */
export function getAgentConfigurations() {
  const { DD_AGENT_ALLOW_INSECURE_SECRET: _ignored, ...agentEnvVars } = ddEnvVars;
  return get('dd.agent', agentEnvVars);
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
        origin: joi.string().trim().min(1).when('enabled', {
          is: true,
          then: joi.required(),
          otherwise: joi.optional(),
        }),
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
        max: joi.number().integer().min(1),
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

function parseSecurityExtraArgs(rawValue: string | undefined, envName: string): string[] {
  if (!rawValue || rawValue.trim() === '') {
    return [];
  }
  try {
    const parsed = JSON.parse(rawValue);
    if (
      !Array.isArray(parsed) ||
      parsed.some(
        (value) => typeof value !== 'string' || value.trim() === '' || value.includes('\0'),
      )
    ) {
      throw new Error('invalid');
    }
    return parsed.map((value) => value.trim());
  } catch {
    throw new Error(`${envName} must be a JSON array of strings`);
  }
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
    scanner: joi.string().insensitive().valid('trivy', 'grype', 'both').allow('').default(''),
    backend: joi.string().insensitive().valid('command', 'docker', 'remote').default('command'),
    availability: joi
      .object({
        policy: joi.string().insensitive().valid('block', 'warn').default('block'),
      })
      .default({}),
    docker: joi
      .object({
        socket: joi.string().default('/var/run/docker.sock'),
        host: joi.string().allow('').default(''),
        port: joi.number().integer().min(1).max(65535).default(2375),
        protocol: joi.string().valid('http', 'https').default('http'),
        network: joi.string().default('bridge'),
        cache: joi.object({ volume: joi.string().default('drydock-scanner-cache') }).default({}),
      })
      .default({}),
    block: joi
      .object({
        severity: joi.string().allow('').default(DEFAULT_SECURITY_BLOCK_SEVERITY),
      })
      .default({}),
    trivy: joi
      .object({
        server: joi.string().allow('').default(''),
        command: joi.string().default('trivy'),
        timeout: joi.number().integer().min(1000).default(600000),
        args: joi.string().allow('').default('[]'),
        image: joi
          .object({
            src: joi.string().allow('').default(''),
          })
          .default({}),
        worker: joi
          .object({
            image: joi.string().default(DEFAULT_TRIVY_WORKER_IMAGE),
          })
          .default({}),
      })
      .default({}),
    grype: joi
      .object({
        command: joi.string().default('grype'),
        timeout: joi.number().integer().min(1000).default(600000),
        args: joi.string().allow('').default('[]'),
        worker: joi
          .object({
            image: joi.string().default(DEFAULT_GRYPE_WORKER_IMAGE),
          })
          .default({}),
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
        generator: joi.string().insensitive().valid('auto', 'trivy', 'syft').default('auto'),
      })
      .default({}),
    syft: joi
      .object({
        command: joi.string().default('syft'),
        timeout: joi.number().integer().min(1000).default(600000),
        args: joi.string().allow('').default('[]'),
        worker: joi
          .object({
            image: joi.string().default(DEFAULT_SYFT_WORKER_IMAGE),
          })
          .default({}),
      })
      .default({}),
    gate: joi
      .object({
        mode: joi.string().insensitive().valid('on', 'off').default('on'),
        relative: joi.boolean().default(false),
      })
      .default({}),
    prune: joi
      .object({
        onblock: joi.boolean().default(true),
      })
      .default({}),
    scan: joi
      .object({
        cron: joi.string().allow('').default(''),
        jitter: joi.number().integer().min(0).default(60000),
        concurrency: joi.number().integer().min(1).default(4),
        notifications: joi.boolean().default(false),
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
  const backend = configuration.backend.toLowerCase() as 'command' | 'docker' | 'remote';
  if (
    backend === 'remote' &&
    (scanner !== 'trivy' || !`${configuration.trivy?.server || ''}`.trim())
  ) {
    throw new Error(
      'DD_SECURITY_BACKEND=remote requires DD_SECURITY_SCANNER=trivy and DD_SECURITY_TRIVY_SERVER',
    );
  }
  const blockSeverities = parseSecuritySeverityList(configuration.block?.severity);
  const sbomFormats = parseSecuritySbomFormatList(configuration.sbom?.formats);
  const cosignKey = validateCosignKeyPath(configuration.cosign?.key || '');

  return {
    enabled: scanner !== '',
    scanner,
    backend,
    availabilityPolicy: (configuration.availability?.policy || 'block').toLowerCase() as
      | 'block'
      | 'warn',
    docker: {
      socket: configuration.docker?.socket || '/var/run/docker.sock',
      host: configuration.docker?.host || '',
      port: configuration.docker?.port || 2375,
      protocol: (configuration.docker?.protocol || 'http') as 'http' | 'https',
      network: configuration.docker?.network || 'bridge',
      cacheVolumePrefix: configuration.docker?.cache?.volume || 'drydock-scanner-cache',
    },
    blockSeverities,
    trivy: {
      server: configuration.trivy?.server || '',
      command: configuration.trivy?.command || 'trivy',
      timeout: configuration.trivy?.timeout || 600000,
      imageSrc: configuration.trivy?.image?.src || '',
      extraArgs: parseSecurityExtraArgs(configuration.trivy?.args, 'DD_SECURITY_TRIVY_ARGS'),
      workerImage: configuration.trivy?.worker?.image || DEFAULT_TRIVY_WORKER_IMAGE,
    },
    grype: {
      command: configuration.grype?.command || 'grype',
      timeout: configuration.grype?.timeout || 600000,
      extraArgs: parseSecurityExtraArgs(configuration.grype?.args, 'DD_SECURITY_GRYPE_ARGS'),
      workerImage: configuration.grype?.worker?.image || DEFAULT_GRYPE_WORKER_IMAGE,
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
      generator: (configuration.sbom?.generator || 'auto').toLowerCase() as
        | 'auto'
        | 'trivy'
        | 'syft',
    },
    syft: {
      command: configuration.syft?.command || 'syft',
      timeout: configuration.syft?.timeout || 600000,
      extraArgs: parseSecurityExtraArgs(configuration.syft?.args, 'DD_SECURITY_SYFT_ARGS'),
      workerImage: configuration.syft?.worker?.image || DEFAULT_SYFT_WORKER_IMAGE,
    },
    gate: {
      mode: (configuration.gate?.mode || 'on').toLowerCase() as 'on' | 'off',
      allowNoWorse: Boolean(configuration.gate?.relative),
    },
    prune: {
      onBlock: configuration.prune?.onblock !== false,
    },
    scan: {
      cron: configuration.scan?.cron || '',
      jitter: configuration.scan?.jitter ?? 60000,
      concurrency: configuration.scan?.concurrency ?? 4,
      batchTimeout: configuration.scan?.batch?.timeout ?? 1800000,
      notifications: Boolean(configuration.scan?.notifications),
    },
  };
}

export type SecurityConfiguration = Pick<
  ReturnType<typeof getSecurityConfiguration>,
  'enabled' | 'scanner' | 'gate' | 'prune'
> & {
  backend?: ReturnType<typeof getSecurityConfiguration>['backend'];
  availabilityPolicy?: ReturnType<typeof getSecurityConfiguration>['availabilityPolicy'];
  sbom: Pick<ReturnType<typeof getSecurityConfiguration>['sbom'], 'enabled' | 'formats'> &
    Partial<Pick<ReturnType<typeof getSecurityConfiguration>['sbom'], 'generator'>>;
  signature: Pick<ReturnType<typeof getSecurityConfiguration>['signature'], 'verify'>;
};

/**
 * Get maturity gate sweep scheduler configuration.
 */
export function getMaturitySweepConfiguration() {
  const configurationFromEnv = get('dd.maturity.sweep', ddEnvVars);
  const configurationSchema = joi.object().keys({
    cron: joi.string().allow('').default('*/5 * * * *'),
  });

  const configurationToValidate = configurationSchema.validate(configurationFromEnv);
  if (configurationToValidate.error) {
    throw configurationToValidate.error;
  }
  return configurationToValidate.value;
}

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
