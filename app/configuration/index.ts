// @ts-nocheck
import fs from 'node:fs';
import joi from 'joi';
import setValue from 'set-value';
import { recordLegacyInput } from '../prometheus/compatibility.js';
import { resolveConfiguredPath } from '../runtime/paths.js';

const VAR_FILE_SUFFIX = '__FILE';
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
export function get(prop, env = process.env) {
  const object = {};
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
export function replaceSecrets(ddEnvVars) {
  const secretFileEnvVars = Object.keys(ddEnvVars).filter((ddEnvVar) =>
    ddEnvVar.toUpperCase().endsWith(VAR_FILE_SUFFIX),
  );
  secretFileEnvVars.forEach((secretFileEnvVar) => {
    const secretKey = secretFileEnvVar.replaceAll(VAR_FILE_SUFFIX, '');
    const secretFilePath = resolveConfiguredPath(ddEnvVars[secretFileEnvVar], {
      label: `${secretFileEnvVar} path`,
    });
    const secretFileValue = fs.readFileSync(secretFilePath, 'utf-8');
    delete ddEnvVars[secretFileEnvVar];
    ddEnvVars[secretKey] = secretFileValue;
  });
}

// 1. Get a copy of all dd-related env vars (DD_ primary, WUD_ legacy fallback)
export const ddEnvVars = {};
const mappedLegacyEnvVars = new Set<string>();

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
    `Detected legacy WUD_* environment variables. Please migrate to DD_* equivalents: ${envVarPreview}${suffix}`,
  );
}

// Then, collect DD_ vars (overrides WUD_ if both set)
Object.keys(process.env)
  .filter((envVar) => envVar.toUpperCase().startsWith('DD_'))
  .forEach((envVar) => {
    ddEnvVars[envVar] = process.env[envVar];
  });

// 2. Replace all secret files referenced by their secret values
replaceSecrets(ddEnvVars);

export function getVersion() {
  return ddEnvVars.DD_VERSION || 'unknown';
}

export function getLogLevel() {
  return ddEnvVars.DD_LOG_LEVEL || 'info';
}

export function getLogFormat() {
  return ddEnvVars.DD_LOG_FORMAT?.toLowerCase() === 'json' ? 'json' : 'text';
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

function normalizeWatcherMaintenanceEnvAliases(watcherConfigurations: Record<string, any>) {
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
/**
 * Get watcher configuration.
 */
export function getWatcherConfigurations() {
  const watcherConfigurations = get('dd.watcher', ddEnvVars);
  normalizeWatcherMaintenanceEnvAliases(watcherConfigurations);
  return watcherConfigurations;
}

/**
 * Get trigger configurations.
 */
export function getTriggerConfigurations() {
  return get('dd.trigger', ddEnvVars);
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
    feature: joi
      .object({
        delete: joi.boolean().default(true),
        containeractions: joi.boolean().default(true),
        webhook: joi.boolean().default(true),
      })
      .default({
        delete: true,
        containeractions: true,
        webhook: true,
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
    metrics: joi
      .object({
        auth: joi.boolean().default(true),
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
    token: joi.string().when('enabled', {
      is: true,
      then: joi.string().min(1).required(),
      otherwise: joi.string().allow('').default(''),
    }),
  });
  const configurationToValidate = configurationSchema.validate(configurationFromEnv);
  if (configurationToValidate.error) {
    throw configurationToValidate.error;
  }
  return configurationToValidate.value;
}

function parseSecuritySeverityList(rawValue: string | undefined): SecuritySeverity[] {
  return parseDelimitedEnumList(
    rawValue,
    DEFAULT_SECURITY_BLOCK_SEVERITY,
    (severity) => severity.toUpperCase(),
    (severity): severity is SecuritySeverity =>
      SECURITY_SEVERITY_VALUES.includes(severity as SecuritySeverity),
  );
}

function parseSecuritySbomFormatList(rawValue: string | undefined): SecuritySbomFormat[] {
  return parseDelimitedEnumList(
    rawValue,
    DEFAULT_SECURITY_SBOM_FORMATS,
    (format) => format.toLowerCase(),
    (format): format is SecuritySbomFormat =>
      SECURITY_SBOM_FORMAT_VALUES.includes(format as SecuritySbomFormat),
  );
}

function parseDelimitedEnumList<T extends string>(
  rawValue: string | undefined,
  defaultRawValue: string,
  normalizeValue: (value: string) => string,
  isAllowedValue: (value: string) => value is T,
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
  if (parsedValues.length === 0) {
    return defaultValues;
  }
  return parsedValues;
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
        key: configuration.cosign?.key || '',
        identity: configuration.cosign?.identity || '',
        issuer: configuration.cosign?.issuer || '',
      },
    },
    sbom: {
      enabled: Boolean(configuration.sbom?.enabled),
      formats: sbomFormats,
    },
  };
}

export function getPublicUrl(req) {
  const publicUrl = ddEnvVars.DD_PUBLIC_URL;
  if (publicUrl) {
    return publicUrl;
  }
  // Try to guess from request, with validation to prevent open redirect
  try {
    const candidate = `${req.protocol}://${req.hostname}`;
    const parsed = new URL(candidate);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return candidate;
    }
    return '/';
  } catch {
    return '/';
  }
}
