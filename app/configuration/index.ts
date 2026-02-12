// @ts-nocheck
import fs from 'node:fs';
import joi from 'joi';
import setValue from 'set-value';

const VAR_FILE_SUFFIX = '__FILE';

/*
 * Get a prop by path from environment variables.
 * @param prop
 * @returns {{}}
 */
export function get(prop, env = process.env) {
    const object = {};
    const envVarPattern = prop.replace(/\./g, '_').toUpperCase();
    const matchingEnvVars = Object.keys(env).filter((envKey) =>
        envKey.startsWith(envVarPattern),
    );
    matchingEnvVars.forEach((matchingEnvVar) => {
        const envVarValue = env[matchingEnvVar];
        const matchingPropPath = matchingEnvVar
            .replace(/_/g, '.')
            .toLowerCase();
        const matchingPropPathWithoutPrefix = matchingPropPath.replace(
            `${prop}.`,
            '',
        );
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
        const secretKey = secretFileEnvVar.replace(VAR_FILE_SUFFIX, '');
        const secretFilePath = ddEnvVars[secretFileEnvVar];
        const secretFileValue = fs.readFileSync(secretFilePath, 'utf-8');
        delete ddEnvVars[secretFileEnvVar];
        ddEnvVars[secretKey] = secretFileValue;
    });
}

// 1. Get a copy of all dd-related env vars (DD_ primary, WUD_ legacy fallback)
export const ddEnvVars = {};

// First, collect legacy WUD_ vars and remap to DD_ keys
Object.keys(process.env)
    .filter((envVar) => envVar.toUpperCase().startsWith('WUD_'))
    .forEach((envVar) => {
        const ddKey = `DD_${envVar.substring(4)}`; // WUD_FOO → DD_FOO
        ddEnvVars[ddKey] = process.env[envVar];
    });

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
/**
 * Get watcher configuration.
 */
export function getWatcherConfigurations() {
    return get('dd.watcher', ddEnvVars);
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
        feature: joi
            .object({
                delete: joi.boolean().default(true),
            })
            .default({
                delete: true,
            }),
        trustproxy: joi
            .alternatives()
            .try(
                joi.boolean(),
                joi.number().integer().min(0),
                joi.string(),
            )
            .default(false),
        metrics: joi
            .object({
                auth: joi.boolean().default(true),
            })
            .default({}),
    });

    // Validate Configuration
    const configurationToValidate = configurationSchema.validate(
        configurationFromEnv || {},
    );
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

    const configurationToValidate = configurationSchema.validate(
        configurationFromEnv || {},
    );
    if (configurationToValidate.error) {
        throw configurationToValidate.error;
    }
    return configurationToValidate.value;
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
