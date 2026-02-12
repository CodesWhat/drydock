/**
 * Registry handling all components (registries, triggers, watchers).
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import capitalize from 'capitalize';
import logger from '../log/index.js';
import { resolveFromRuntimeRoot, resolveRuntimeRoot } from '../runtime/paths.js';

const log = logger.child({ component: 'registry' });

import Agent from '../agent/components/Agent.js';
import type Authentication from '../authentications/providers/Authentication.js';
import {
  getAgentConfigurations,
  getAuthenticationConfigurations,
  getRegistryConfigurations,
  getTriggerConfigurations,
  getWatcherConfigurations,
} from '../configuration/index.js';
import type Registry from '../registries/Registry.js';
import type Trigger from '../triggers/providers/Trigger.js';
import type Watcher from '../watchers/Watcher.js';
import type Component from './Component.js';
import type { ComponentConfiguration } from './Component.js';

export interface RegistryState {
  trigger: { [key: string]: Trigger };
  watcher: { [key: string]: Watcher };
  registry: { [key: string]: Registry };
  authentication: { [key: string]: Authentication };
  agent: { [key: string]: Agent };
}

export interface RegistrationOptions {
  agent?: boolean;
}

export interface RegisterComponentOptions {
  kind: ComponentKind;
  provider: string;
  name: string;
  configuration: ComponentConfiguration;
  componentPath: string;
  agent?: string;
}

type ComponentKind = keyof RegistryState;
const SHARED_TRIGGER_CONFIGURATION_KEYS = ['threshold', 'once', 'mode', 'order'];

function isRecord(value: unknown): value is Record<string, any> {
  return (
    value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value)
  );
}

/**
 * Registry state.
 */
const state: RegistryState = {
  trigger: {},
  watcher: {},
  registry: {},
  authentication: {},
  agent: {},
};

export function getState() {
  return state;
}

/**
 * Get available providers for a given component kind.
 * @param {string} basePath relative path to the providers directory
 * @returns {string[]} sorted list of available provider names
 */
function getAvailableProviders(basePath: string) {
  try {
    const resolvedPath = resolveFromRuntimeRoot(basePath);
    const runtimeRoot = resolveRuntimeRoot();
    if (!resolvedPath.startsWith(runtimeRoot)) {
      log.warn(`Path ${resolvedPath} is outside runtime root ${runtimeRoot}`);
      return [];
    }
    const providers = fs
      .readdirSync(resolvedPath)
      .filter((file) => {
        const filePath = path.join(resolvedPath, file);
        return fs.statSync(filePath).isDirectory();
      })
      .sort();
    return providers;
  } catch (e: any) {
    log.debug(`Unable to load providers under ${basePath}: ${e.message}`);
    return [];
  }
}

function resolveComponentModuleSpecifier(componentFileBase: string) {
  const jsCandidate = `${componentFileBase}.js`;
  if (fs.existsSync(jsCandidate)) {
    return pathToFileURL(jsCandidate).href;
  }

  const tsCandidate = `${componentFileBase}.ts`;
  if (fs.existsSync(tsCandidate)) {
    if (process.env.JEST_WORKER_ID) {
      // ts-jest resolves extensionless local modules in test mode.
      return componentFileBase;
    }
    return pathToFileURL(tsCandidate).href;
  }

  return pathToFileURL(jsCandidate).href;
}

/**
 * Get documentation link for a component kind.
 * @param {string} kind component kind (trigger, watcher, etc.)
 * @returns {string} documentation path
 */
function getDocumentationLink(kind: ComponentKind) {
  const docLinks: Record<ComponentKind, string> = {
    trigger: 'https://github.com/CodesWhat/drydock/tree/main/docs/configuration/triggers',
    watcher: 'https://github.com/CodesWhat/drydock/tree/main/docs/configuration/watchers',
    registry: 'https://github.com/CodesWhat/drydock/tree/main/docs/configuration/registries',
    authentication:
      'https://github.com/CodesWhat/drydock/tree/main/docs/configuration/authentications',
    agent: 'https://github.com/CodesWhat/drydock/tree/main/docs/configuration/agents',
  };
  return docLinks[kind] || 'https://github.com/CodesWhat/drydock/tree/main/docs/configuration';
}

/**
 * Build error message when a component provider is not found.
 * @param {string} kind component kind (trigger, watcher, etc.)
 * @param {string} provider the provider name that was not found
 * @param {string} error the original error message
 * @param {string[]} availableProviders list of available providers
 * @returns {string} formatted error message
 */
function getHelpfulErrorMessage(
  kind: ComponentKind,
  provider: string,
  error: string,
  availableProviders: string[],
) {
  let message = `Error when registering component ${provider} (${error})`;

  if (error.includes('Cannot find module')) {
    const kindDisplay = kind.charAt(0).toUpperCase() + kind.slice(1);
    const envVarPattern = `DD_${kindDisplay.toUpperCase()}_${provider.toUpperCase()}_*`;

    message = `Unknown ${kind} provider: '${provider}'.`;
    message += `\n  (Check your environment variables - this comes from: ${envVarPattern})`;

    if (availableProviders.length > 0) {
      message += `\n  Available ${kind} providers: ${availableProviders.join(', ')}`;
      const docLink = getDocumentationLink(kind);
      message += `\n  For more information, visit: ${docLink}`;
    }
  }

  return message;
}

/**
 * Register a component.
 *
 * @param {RegisterComponentOptions} options - Component registration options
 */
export async function registerComponent(options: RegisterComponentOptions): Promise<Component> {
  const { kind, provider, name, configuration, componentPath, agent } = options;
  const providerLowercase = provider.toLowerCase();
  const nameLowercase = name.toLowerCase();
  const componentRoot = resolveFromRuntimeRoot(componentPath);
  const componentFileByConvention = path.join(
    componentRoot,
    providerLowercase,
    capitalize(provider),
  );
  const componentFileLowercase = path.join(componentRoot, providerLowercase, providerLowercase);
  const componentFileByConventionExists = ['.js', '.ts'].some((extension) =>
    fs.existsSync(`${componentFileByConvention}${extension}`),
  );
  let componentFileBase = componentFileLowercase;
  if (agent) {
    componentFileBase = path.join(componentRoot, `Agent${capitalize(kind)}`);
  } else if (componentFileByConventionExists) {
    componentFileBase = componentFileByConvention;
  }
  const componentModuleSpecifier = resolveComponentModuleSpecifier(componentFileBase);
  log.debug(`Resolving ${kind}.${providerLowercase}.${nameLowercase} from ${componentFileBase}`);
  try {
    const componentModule = await import(componentModuleSpecifier);
    const ComponentClass = componentModule.default || componentModule;
    const component: Component = new ComponentClass();
    const componentRegistered = await component.register(
      kind,
      providerLowercase,
      nameLowercase,
      configuration,
      agent,
    );

    // Type assertion is safe here because we know the kind matches the expected type
    // if the file structure and inheritance are correct
    (state[kind] as any)[component.getId()] = component;
    return componentRegistered;
  } catch (e: any) {
    const availableProviders = getAvailableProviders(componentPath);
    const helpfulMessage = getHelpfulErrorMessage(
      kind,
      providerLowercase,
      e.message,
      availableProviders,
    );
    throw new Error(helpfulMessage);
  }
}

/**
 * Register all found components.
 * @param kind
 * @param configurations
 * @param path
 * @returns {*[]}
 */
async function registerComponents(
  kind: ComponentKind,
  configurations: Record<string, any>,
  path: string,
) {
  if (configurations) {
    const providers = Object.keys(configurations);
    const providerPromises = providers.flatMap((provider) => {
      log.info(`Register all components of kind ${kind} for provider ${provider}`);
      const providerConfigurations = configurations[provider];
      return Object.keys(providerConfigurations).map((configurationName) =>
        registerComponent({
          kind,
          provider,
          name: configurationName,
          configuration: providerConfigurations[configurationName],
          componentPath: path,
        }),
      );
    });
    return Promise.all(providerPromises);
  }
  return [];
}

function applyProviderSharedTriggerConfiguration(configurations: Record<string, any>) {
  const normalizedConfigurations: Record<string, any> = {};

  Object.keys(configurations || {}).forEach((provider) => {
    const providerConfigurations = configurations[provider];
    if (!isRecord(providerConfigurations)) {
      normalizedConfigurations[provider] = providerConfigurations;
      return;
    }

    const sharedConfiguration: Record<string, any> = {};
    Object.keys(providerConfigurations).forEach((key) => {
      const value = providerConfigurations[key];
      if (SHARED_TRIGGER_CONFIGURATION_KEYS.includes(key.toLowerCase()) && !isRecord(value)) {
        sharedConfiguration[key.toLowerCase()] = value;
      }
    });

    normalizedConfigurations[provider] = {};
    Object.keys(providerConfigurations).forEach((triggerName) => {
      const triggerConfiguration = providerConfigurations[triggerName];
      if (isRecord(triggerConfiguration)) {
        normalizedConfigurations[provider][triggerName] = {
          ...sharedConfiguration,
          ...triggerConfiguration,
        };
      } else if (!SHARED_TRIGGER_CONFIGURATION_KEYS.includes(triggerName.toLowerCase())) {
        normalizedConfigurations[provider][triggerName] = triggerConfiguration;
      }
    });
  });

  return normalizedConfigurations;
}

/**
 * Collect all shared-key values across providers, grouped by trigger name.
 * Returns a map of triggerName -> key -> Set of distinct values.
 */
function addSharedTriggerValue(
  valuesByName: Record<string, Record<string, Set<any>>>,
  triggerName: string,
  key: string,
  value: any,
) {
  const normalizedTriggerName = triggerName.toLowerCase();
  valuesByName[normalizedTriggerName] ??= {};
  valuesByName[normalizedTriggerName][key] ??= new Set();
  valuesByName[normalizedTriggerName][key].add(value);
}

function collectSharedValuesForTrigger(
  valuesByName: Record<string, Record<string, Set<any>>>,
  triggerName: string,
  triggerConfiguration: Record<string, any>,
) {
  for (const key of SHARED_TRIGGER_CONFIGURATION_KEYS) {
    const value = triggerConfiguration[key];
    if (value !== undefined) {
      addSharedTriggerValue(valuesByName, triggerName, key, value);
    }
  }
}

function collectValuesForProvider(
  valuesByName: Record<string, Record<string, Set<any>>>,
  providerConfigurations: unknown,
) {
  if (!isRecord(providerConfigurations)) {
    return;
  }

  for (const triggerName of Object.keys(providerConfigurations)) {
    const triggerConfiguration = providerConfigurations[triggerName];
    if (!isRecord(triggerConfiguration)) {
      continue;
    }
    collectSharedValuesForTrigger(valuesByName, triggerName, triggerConfiguration);
  }
}

function collectValuesByName(
  configurations: Record<string, any>,
): Record<string, Record<string, Set<any>>> {
  const valuesByName: Record<string, Record<string, Set<any>>> = {};

  for (const providerConfigurations of Object.values(configurations || {})) {
    collectValuesForProvider(valuesByName, providerConfigurations);
  }

  return valuesByName;
}

/**
 * From collected values, extract keys where all providers agree on a single value.
 */
function extractSharedValues(
  valuesByName: Record<string, Record<string, Set<any>>>,
): Record<string, any> {
  const shared: Record<string, any> = {};

  for (const triggerName of Object.keys(valuesByName)) {
    for (const key of SHARED_TRIGGER_CONFIGURATION_KEYS) {
      const valuesForKey = valuesByName[triggerName][key];
      if (valuesForKey?.size === 1) {
        if (!shared[triggerName]) {
          shared[triggerName] = {};
        }
        shared[triggerName][key] = Array.from(valuesForKey)[0];
      }
    }
  }

  return shared;
}

function getSharedTriggerConfigurationByName(configurations: Record<string, any>) {
  const valuesByName = collectValuesByName(configurations);
  return extractSharedValues(valuesByName);
}

function applySharedTriggerConfigurationByName(configurations: Record<string, any>) {
  const configurationsWithProviderSharedValues =
    applyProviderSharedTriggerConfiguration(configurations);
  const sharedConfigurationByName = getSharedTriggerConfigurationByName(
    configurationsWithProviderSharedValues,
  );
  const configurationsWithSharedValues: Record<string, any> = {};

  Object.keys(configurationsWithProviderSharedValues || {}).forEach((provider) => {
    const providerConfigurations = configurationsWithProviderSharedValues[provider];
    if (!isRecord(providerConfigurations)) {
      configurationsWithSharedValues[provider] = providerConfigurations;
      return;
    }
    configurationsWithSharedValues[provider] = {};
    Object.keys(providerConfigurations).forEach((triggerName) => {
      const triggerConfiguration = providerConfigurations[triggerName];
      if (!isRecord(triggerConfiguration)) {
        configurationsWithSharedValues[provider][triggerName] = triggerConfiguration;
        return;
      }
      const sharedConfiguration = sharedConfigurationByName[triggerName.toLowerCase()] || {};
      configurationsWithSharedValues[provider][triggerName] = {
        ...sharedConfiguration,
        ...triggerConfiguration,
      };
    });
  });

  return configurationsWithSharedValues;
}

/**
 * Check whether a record contains only shared trigger configuration keys
 * with scalar values (i.e. it qualifies as a trigger group entry).
 */
function isValidTriggerGroup(entry: Record<string, any>): boolean {
  const keys = Object.keys(entry);
  return (
    keys.length > 0 &&
    keys.every(
      (k) => SHARED_TRIGGER_CONFIGURATION_KEYS.includes(k.toLowerCase()) && !isRecord(entry[k]),
    )
  );
}

/**
 * Classify a single top-level configuration entry as either a known provider,
 * a trigger group (shared defaults), or an unknown provider.
 */
function classifyConfigurationEntry(
  key: string,
  value: any,
  knownProviderSet: Set<string>,
): 'provider' | 'trigger-group' {
  const keyLower = key.toLowerCase();
  if (knownProviderSet.has(keyLower)) {
    return 'provider';
  }
  if (isRecord(value) && isValidTriggerGroup(value)) {
    return 'trigger-group';
  }
  return 'provider';
}

function splitTriggerGroupDefaults(
  configurations: Record<string, any>,
  knownProviderSet: Set<string>,
) {
  const triggerGroupDefaults: Record<string, Record<string, any>> = {};
  const providerConfigurations: Record<string, any> = {};

  for (const key of Object.keys(configurations)) {
    const value = configurations[key];
    const classification = classifyConfigurationEntry(key, value, knownProviderSet);
    if (classification === 'trigger-group') {
      const keyLower = key.toLowerCase();
      triggerGroupDefaults[keyLower] = value;
      log.info(
        `Detected trigger group '${keyLower}' with shared configuration: ${JSON.stringify(value)}`,
      );
      continue;
    }
    providerConfigurations[key] = value;
  }

  return { triggerGroupDefaults, providerConfigurations };
}

function mergeTriggerConfigurationWithDefaults(
  triggerConfiguration: any,
  groupDefaults: Record<string, any> | undefined,
) {
  if (!groupDefaults || !isRecord(triggerConfiguration)) {
    return triggerConfiguration;
  }

  return {
    ...groupDefaults,
    ...triggerConfiguration,
  };
}

function applyDefaultsToProviderConfiguration(
  providerConfig: unknown,
  triggerGroupDefaults: Record<string, Record<string, any>>,
) {
  if (!isRecord(providerConfig)) {
    return providerConfig;
  }

  const providerResult: Record<string, any> = {};
  for (const triggerName of Object.keys(providerConfig)) {
    const triggerConfig = providerConfig[triggerName];
    const groupDefaults = triggerGroupDefaults[triggerName.toLowerCase()];
    providerResult[triggerName] = mergeTriggerConfigurationWithDefaults(triggerConfig, groupDefaults);
  }

  return providerResult;
}

function applyDefaultsToProviderConfigurations(
  providerConfigurations: Record<string, any>,
  triggerGroupDefaults: Record<string, Record<string, any>>,
) {
  const result: Record<string, any> = {};

  for (const provider of Object.keys(providerConfigurations)) {
    result[provider] = applyDefaultsToProviderConfiguration(
      providerConfigurations[provider],
      triggerGroupDefaults,
    );
  }

  return result;
}

function hasConfigurationEntries(configurations: Record<string, any> | null | undefined): boolean {
  return !!configurations && Object.keys(configurations).length > 0;
}

function getKnownProviderSet(providerPath: string): Set<string> {
  return new Set(getAvailableProviders(providerPath).map((provider) => provider.toLowerCase()));
}

/**
 * Extract trigger group defaults and apply them across providers.
 *
 * A "trigger group" entry is a top-level key in the trigger configuration
 * that is NOT a real trigger provider directory (e.g. "update") but instead
 * a trigger name shared across multiple providers.
 *
 * For example, given the env vars:
 *   DD_TRIGGER_DOCKER_UPDATE_PRUNE=true
 *   DD_TRIGGER_DISCORD_UPDATE_URL=http://...
 *   DD_TRIGGER_UPDATE_THRESHOLD=minor
 *
 * The parsed configuration looks like:
 *   { docker: { update: { prune: "true" } },
 *     discord: { update: { url: "http://..." } },
 *     update: { threshold: "minor" } }
 *
 * This function detects "update" as a trigger group (not a provider),
 * merges { threshold: "minor" } as defaults into docker.update and
 * discord.update, and removes the "update" entry so it is not
 * registered as a provider.
 */
function applyTriggerGroupDefaults(
  configurations: Record<string, any>,
  providerPath: string,
): Record<string, any> {
  if (!hasConfigurationEntries(configurations)) {
    return configurations;
  }

  const knownProviderSet = getKnownProviderSet(providerPath);
  const { triggerGroupDefaults, providerConfigurations } = splitTriggerGroupDefaults(
    configurations,
    knownProviderSet,
  );

  if (!hasConfigurationEntries(triggerGroupDefaults)) {
    return configurations;
  }

  return applyDefaultsToProviderConfigurations(providerConfigurations, triggerGroupDefaults);
}

/**
 * Register watchers.
 * @param options
 * @returns {Promise}
 */
async function registerWatchers(options: RegistrationOptions = {}) {
  const configurations = getWatcherConfigurations();
  let watchersToRegister: Promise<any>[] = [];
  try {
    if (Object.keys(configurations).length === 0) {
      if (options.agent) {
        log.error('Agent mode requires at least one watcher configured.');
        process.exit(1);
      }
      log.info('No Watcher configured => Init a default one (Docker with default options)');
      watchersToRegister.push(
        registerComponent({
          kind: 'watcher',
          provider: 'docker',
          name: 'local',
          configuration: {},
          componentPath: 'watchers/providers',
        }),
      );
    } else {
      watchersToRegister = watchersToRegister.concat(
        Object.keys(configurations).map((watcherKey) => {
          const watcherKeyNormalize = watcherKey.toLowerCase();
          return registerComponent({
            kind: 'watcher',
            provider: 'docker',
            name: watcherKeyNormalize,
            configuration: configurations[watcherKeyNormalize],
            componentPath: 'watchers/providers',
          });
        }),
      );
    }
    await Promise.all(watchersToRegister);
  } catch (e: any) {
    log.warn(`Some watchers failed to register (${e.message})`);
    log.debug(e);
  }
}

/**
 * Register triggers.
 * @param options
 */
async function registerTriggers(options: RegistrationOptions = {}) {
  const rawConfigurations = getTriggerConfigurations();
  const configurationsWithGroupDefaults = applyTriggerGroupDefaults(
    rawConfigurations,
    'triggers/providers',
  );
  const configurations = applySharedTriggerConfigurationByName(configurationsWithGroupDefaults);
  const allowedTriggers = new Set(['docker', 'dockercompose']);

  if (options.agent && configurations) {
    const filteredConfigurations: Record<string, any> = {};
    Object.keys(configurations).forEach((provider) => {
      if (allowedTriggers.has(provider.toLowerCase())) {
        filteredConfigurations[provider] = configurations[provider];
      } else {
        log.warn(`Trigger type '${provider}' is not supported in Agent mode and will be ignored.`);
      }
    });
    try {
      await registerComponents('trigger', filteredConfigurations, 'triggers/providers');
    } catch (e: any) {
      log.warn(`Some triggers failed to register (${e.message})`);
      log.debug(e);
    }
    return;
  }

  try {
    await registerComponents('trigger', configurations, 'triggers/providers');
  } catch (e: any) {
    log.warn(`Some triggers failed to register (${e.message})`);
    log.debug(e);
  }
}

/**
 * Register registries.
 * @returns {Promise}
 */
async function registerRegistries() {
  const defaultRegistries = {
    codeberg: { public: '' },
    dhi: { public: '' },
    docr: { public: '' },
    ecr: { public: '' },
    gcr: { public: '' },
    ghcr: { public: '' },
    hub: { public: '' },
    lscr: { public: '' },
    quay: { public: '' },
  };
  const registriesToRegister = {
    ...defaultRegistries,
    ...getRegistryConfigurations(),
  };

  try {
    await registerComponents('registry', registriesToRegister, 'registries/providers');
  } catch (e: any) {
    log.warn(`Some registries failed to register (${e.message})`);
    log.debug(e);
  }
}

/**
 * Register authentications.
 */
async function registerAuthentications() {
  const configurations = getAuthenticationConfigurations();
  try {
    if (Object.keys(configurations).length === 0) {
      log.info('No authentication configured => Allow anonymous access');
      await registerComponent({
        kind: 'authentication',
        provider: 'anonymous',
        name: 'anonymous',
        configuration: {},
        componentPath: 'authentications/providers',
      });
    }
    await registerComponents('authentication', configurations, 'authentications/providers');
  } catch (e: any) {
    log.warn(`Some authentications failed to register (${e.message})`);
    log.debug(e);
  }
}

/**
 * Register agents.
 */
async function registerAgents() {
  const configurations = getAgentConfigurations();
  const promises = Object.keys(configurations).map(async (name) => {
    try {
      const config = configurations[name];
      const agent = new Agent();
      const registered = await agent.register('agent', 'dd', name, config);
      state.agent[registered.getId()] = registered;
    } catch (e: any) {
      log.warn(`Agent ${name} failed to register (${e.message})`);
      log.debug(e);
    }
  });
  await Promise.all(promises);
}

/**
 * Deregister a component.
 * @param component
 * @param kind
 * @returns {Promise}
 */
async function deregisterComponent(component: Component, kind: ComponentKind) {
  try {
    await component.deregister();
  } catch (e: any) {
    throw new Error(`Error when deregistering component ${component.getId()} (${e.message})`);
  } finally {
    const components = getState()[kind];
    if (components) {
      delete components[component.getId()];
    }
  }
}

/**
 * Deregister all components of kind.
 * @param components
 * @param kind
 * @returns {Promise}
 */
async function deregisterComponents(components: Component[], kind: ComponentKind) {
  const deregisterPromises = components.map(async (component) =>
    deregisterComponent(component, kind),
  );
  return Promise.all(deregisterPromises);
}

/**
 * Deregister all watchers.
 * @returns {Promise}
 */
async function deregisterWatchers() {
  return deregisterComponents(Object.values(getState().watcher), 'watcher');
}

/**
 * Deregister all triggers.
 * @returns {Promise}
 */
async function deregisterTriggers() {
  return deregisterComponents(Object.values(getState().trigger), 'trigger');
}

/**
 * Deregister all registries.
 * @returns {Promise}
 */
async function deregisterRegistries() {
  return deregisterComponents(Object.values(getState().registry), 'registry');
}

/**
 * Deregister all authentications.
 * @returns {Promise<unknown>}
 */
async function deregisterAuthentications() {
  return deregisterComponents(Object.values(getState().authentication), 'authentication');
}

/**
 * Deregister all components registered against the specified agent.
 * @returns {Promise}
 */
export async function deregisterAgentComponents(agent: string) {
  const watchers = Object.values(getState().watcher).filter((watcher) => watcher.agent === agent);
  const triggers = Object.values(getState().trigger).filter((trigger) => trigger.agent === agent);
  await deregisterComponents(watchers, 'watcher');
  await deregisterComponents(triggers, 'trigger');
}

/**
 * Deregister all agents.
 * @returns {Promise<unknown>}
 */
async function deregisterAgents() {
  return deregisterComponents(Object.values(getState().agent), 'agent');
}

/**
 * Deregister all components.
 * @returns {Promise}
 */
async function deregisterAll() {
  try {
    await deregisterWatchers();
    await deregisterTriggers();
    await deregisterRegistries();
    await deregisterAuthentications();
    await deregisterAgents();
  } catch (e: any) {
    throw new Error(`Error when trying to deregister ${e.message}`);
  }
}

async function shutdown() {
  try {
    await deregisterAll();
    process.exit(0);
  } catch (e: any) {
    log.error(e.message);
    process.exit(1);
  }
}

export async function init(options: RegistrationOptions = {}) {
  // Register triggers
  await registerTriggers(options);

  // Register registries
  await registerRegistries();

  // Register watchers
  await registerWatchers(options);

  if (!options.agent) {
    // Register authentications
    await registerAuthentications();

    // Register agents
    await registerAgents();
  }

  // Gracefully exit when possible
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// The following exports are meant for testing only
export {
  registerComponent as testable_registerComponent,
  registerComponents as testable_registerComponents,
  registerRegistries as testable_registerRegistries,
  registerTriggers as testable_registerTriggers,
  registerWatchers as testable_registerWatchers,
  registerAuthentications as testable_registerAuthentications,
  deregisterComponent as testable_deregisterComponent,
  deregisterRegistries as testable_deregisterRegistries,
  deregisterTriggers as testable_deregisterTriggers,
  deregisterWatchers as testable_deregisterWatchers,
  deregisterAuthentications as testable_deregisterAuthentications,
  deregisterAll as testable_deregisterAll,
  shutdown as testable_shutdown,
  applyTriggerGroupDefaults as testable_applyTriggerGroupDefaults,
  applySharedTriggerConfigurationByName as testable_applySharedTriggerConfigurationByName,
  log as testable_log,
};
