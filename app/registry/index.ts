/**
 * Registry handling all components (registries, triggers, watchers).
 */

import fs from 'node:fs';
import path from 'node:path';
import capitalize from 'capitalize';
import logger from '../log/index.js';
import * as securityScheduler from '../security/scheduler.js';
import * as storeContainer from '../store/container.js';
import * as store from '../store/index.js';

const log = logger.child({ component: 'registry' });

import Agent from '../agent/components/Agent.js';
import type Authentication from '../authentications/providers/Authentication.js';
import {
  ddEnvVars,
  getAgentConfigurations,
  getAuthenticationConfigurations,
  getRegistryConfigurations,
  getTriggerConfigurations,
  getWatcherConfigurations,
} from '../configuration/index.js';
import type Registry from '../registries/Registry.js';
import type Trigger from '../triggers/providers/Trigger.js';
import { getErrorMessage } from '../util/error.js';
import type Watcher from '../watchers/Watcher.js';
import type Component from './Component.js';
import type { ComponentConfiguration } from './Component.js';
import {
  getAvailableProviders,
  getHelpfulErrorMessage,
  resolveComponentModuleSpecifier,
  resolveComponentRoot,
} from './component-resolution.js';
import {
  applySharedTriggerConfigurationByName as applySharedTriggerConfigurationByNameHelper,
  applyTriggerGroupDefaults as applyTriggerGroupDefaultsHelper,
} from './trigger-shared-config.js';

type SharedTriggerConfigurationInput = Parameters<
  typeof applySharedTriggerConfigurationByNameHelper
>[0];
type TriggerGroupConfigurationInput = Parameters<typeof applyTriggerGroupDefaultsHelper>[0];

export interface RegistryState {
  trigger: { [key: string]: Trigger };
  watcher: { [key: string]: Watcher };
  registry: { [key: string]: Registry };
  authentication: { [key: string]: Authentication };
  agent: { [key: string]: Agent };
}

export interface AuthenticationRegistrationError {
  provider: string;
  error: string;
}

interface RegistrationOptions {
  agent?: boolean;
}

interface RegisterComponentOptions {
  kind: ComponentKind;
  provider: string;
  name: string;
  configuration: ComponentConfiguration;
  componentPath: string;
  agent?: string;
}

interface ProviderConfiguration {
  [configurationName: string]:
    | ComponentConfiguration
    | string
    | number
    | boolean
    | null
    | undefined;
}

type ProviderConfigurationsByProvider = Record<string, ProviderConfiguration>;

type ComponentKind = keyof RegistryState;

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

const registrationWarnings: string[] = [];
const authenticationRegistrationErrors: AuthenticationRegistrationError[] = [];

export function getState() {
  return state;
}

export function getRegistrationWarnings(): string[] {
  return [...registrationWarnings];
}

export function getAuthenticationRegistrationErrors(): AuthenticationRegistrationError[] {
  return [...authenticationRegistrationErrors];
}

function addComponentToState(kind: ComponentKind, component: Component) {
  const components = state[kind] as Record<string, Component>;
  components[component.getId()] = component;
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
  const componentRoot = resolveComponentRoot(kind, componentPath);
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

    addComponentToState(kind, component);
    return componentRegistered;
  } catch (e: unknown) {
    const availableProviders = getAvailableProviders(componentPath, (message) =>
      log.debug(message),
    );
    const helpfulMessage = getHelpfulErrorMessage(
      kind,
      providerLowercase,
      getErrorMessage(e),
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
  configurations: ProviderConfigurationsByProvider | null | undefined,
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
          configuration: providerConfigurations[configurationName] as ComponentConfiguration,
          componentPath: path,
        }),
      );
    });
    const registrationResults = await Promise.allSettled(providerPromises);
    const failures = registrationResults.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (failures.length > 0) {
      const failureMessages = failures.map((failure) => getErrorMessage(failure.reason));
      throw new Error(failureMessages.join('; '));
    }
    return registrationResults
      .filter(
        (result): result is PromiseFulfilledResult<Component> => result.status === 'fulfilled',
      )
      .map((result) => result.value);
  }
  return [];
}

function toNamedConfigurationMap(configuration: unknown): ProviderConfiguration {
  if (configuration && typeof configuration === 'object' && !Array.isArray(configuration)) {
    return configuration as ProviderConfiguration;
  }
  return {};
}

function mergeProviderConfigurations(
  defaultConfiguration: ProviderConfiguration,
  configuredConfiguration: ProviderConfiguration,
) {
  // Preserve user-defined component ordering first (for precedence), then fallback defaults.
  const mergedConfiguration = { ...configuredConfiguration };
  for (const [configurationName, configuration] of Object.entries(defaultConfiguration)) {
    if (!(configurationName in mergedConfiguration)) {
      mergedConfiguration[configurationName] = configuration;
    }
  }
  return mergedConfiguration;
}

const LEGACY_PUBLIC_TOKEN_AUTH_PROVIDERS = ['hub', 'dhi'] as const;
const TOKEN_AUTH_CREDENTIAL_KEYS = ['login', 'password', 'token', 'auth'] as const;
type TokenAuthCredentialKey = (typeof TOKEN_AUTH_CREDENTIAL_KEYS)[number];
type CredentialKeyPresence = Record<TokenAuthCredentialKey, boolean>;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasOwnKey(value: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(value, key);
}

function hasNonEmptyString(value: Record<string, unknown>, key: string): boolean {
  const candidate = value[key];
  return typeof candidate === 'string' && candidate.trim().length > 0;
}

function hasExactlyCredentialKeys(
  keyPresence: CredentialKeyPresence,
  expectedKeys: readonly TokenAuthCredentialKey[],
): boolean {
  const expectedKeySet = new Set(expectedKeys);
  return TOKEN_AUTH_CREDENTIAL_KEYS.every((key) => keyPresence[key] === expectedKeySet.has(key));
}

function shouldFallbackLegacyPublicTokenAuthConfiguration(configuration: unknown): boolean {
  if (!isObjectRecord(configuration)) {
    return false;
  }

  const hasAnyCredentialKey = TOKEN_AUTH_CREDENTIAL_KEYS.some((key) =>
    hasOwnKey(configuration, key),
  );
  if (!hasAnyCredentialKey) {
    return false;
  }

  const keyPresence: CredentialKeyPresence = {
    login: hasOwnKey(configuration, 'login'),
    password: hasOwnKey(configuration, 'password'),
    token: hasOwnKey(configuration, 'token'),
    auth: hasOwnKey(configuration, 'auth'),
  };

  const validLoginPasswordConfiguration =
    hasExactlyCredentialKeys(keyPresence, ['login', 'password']) &&
    hasNonEmptyString(configuration, 'login') &&
    hasNonEmptyString(configuration, 'password');

  const validLoginTokenConfiguration =
    hasExactlyCredentialKeys(keyPresence, ['login', 'token']) &&
    hasNonEmptyString(configuration, 'login') &&
    hasNonEmptyString(configuration, 'token');

  const validAuthConfiguration =
    hasExactlyCredentialKeys(keyPresence, ['auth']) && hasNonEmptyString(configuration, 'auth');

  return !(
    validLoginPasswordConfiguration ||
    validLoginTokenConfiguration ||
    validAuthConfiguration
  );
}

function getConfiguredCredentialKeys(configuration: Record<string, unknown>): string[] {
  return TOKEN_AUTH_CREDENTIAL_KEYS.filter((key) => hasOwnKey(configuration, key));
}

function sanitizeLegacyPublicTokenAuthConfigurations(
  configurations: ProviderConfigurationsByProvider | null | undefined,
) {
  if (!configurations || typeof configurations !== 'object' || Array.isArray(configurations)) {
    return configurations;
  }

  let sanitizedConfigurations = configurations;
  for (const provider of LEGACY_PUBLIC_TOKEN_AUTH_PROVIDERS) {
    const providerConfiguration = sanitizedConfigurations[provider];
    if (!isObjectRecord(providerConfiguration)) {
      continue;
    }
    if (!shouldFallbackLegacyPublicTokenAuthConfiguration(providerConfiguration.public)) {
      continue;
    }

    const publicConfiguration = providerConfiguration.public as Record<string, unknown>;
    const configuredCredentialKeys = getConfiguredCredentialKeys(publicConfiguration);
    const configuredCredentialKeysSuffix = ` Configured keys: ${configuredCredentialKeys.join(', ')}.`;

    log.warn(
      `Detected incompatible DD_REGISTRY_${provider.toUpperCase()}_PUBLIC_* token-auth credentials for ${provider}.public.${configuredCredentialKeysSuffix} Falling back to anonymous ${provider}.public registry for backward compatibility. This fallback is deprecated and will be removed in v1.6.0; migrate to LOGIN+PASSWORD, LOGIN+TOKEN, AUTH, or no credentials.`,
    );

    sanitizedConfigurations = {
      ...sanitizedConfigurations,
      [provider]: {
        ...providerConfiguration,
        public: '',
      },
    };
  }

  return sanitizedConfigurations;
}

function applySharedTriggerConfigurationByName(
  configurations: ProviderConfigurationsByProvider | null | undefined,
) {
  if (!configurations) {
    return configurations;
  }
  return applySharedTriggerConfigurationByNameHelper(
    configurations as SharedTriggerConfigurationInput,
  ) as ProviderConfigurationsByProvider;
}

function getKnownProviderSet(providerPath: string): Set<string> {
  return new Set(
    getAvailableProviders(providerPath, (message) => log.debug(message)).map((provider) =>
      provider.toLowerCase(),
    ),
  );
}

function applyTriggerGroupDefaults(
  configurations: ProviderConfigurationsByProvider | null | undefined,
  providerPath: string,
) {
  const knownProviderSet = getKnownProviderSet(providerPath);
  return applyTriggerGroupDefaultsHelper(
    configurations as TriggerGroupConfigurationInput,
    knownProviderSet,
    (groupName, value) => {
      const sharedConfigurationKeys = Object.keys(value);
      log.info(
        `Detected trigger group '${groupName}' with shared configuration keys: ${sharedConfigurationKeys.join(', ')}`,
      );
    },
  ) as ProviderConfigurationsByProvider | null | undefined;
}

/**
 * Register watchers.
 * @param options
 * @returns {Promise}
 */
async function registerWatchers(options: RegistrationOptions = {}) {
  const configurations = getWatcherConfigurations();
  let watchersToRegister: Promise<Component>[] = [];
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
  } catch (e: unknown) {
    log.warn(`Some watchers failed to register (${getErrorMessage(e)})`);
    log.debug(e);
  }
}

function pruneOrphanedLocalContainers() {
  const localWatcherNames = new Set(
    Object.values(getState().watcher)
      .filter((watcher) => !watcher.agent)
      .map((watcher) => watcher.name)
      .filter((watcherName): watcherName is string => typeof watcherName === 'string')
      .map((watcherName) => watcherName.toLowerCase()),
  );

  if (localWatcherNames.size === 0) {
    return;
  }

  const orphanedLocalContainers = storeContainer.getContainersRaw().filter((container) => {
    if (container.agent) {
      return false;
    }
    if (typeof container.watcher !== 'string') {
      return true;
    }
    return !localWatcherNames.has(container.watcher.toLowerCase());
  });

  orphanedLocalContainers.forEach((container) => {
    storeContainer.deleteContainer(container.id);
  });

  if (orphanedLocalContainers.length > 0) {
    log.warn(
      `Pruned ${orphanedLocalContainers.length} container entries from missing local watcher(s)`,
    );
  }
}

/**
 * Register triggers.
 * @param options
 */
async function registerTriggers(options: RegistrationOptions = {}) {
  const rawConfigurations = getTriggerConfigurations() as
    | ProviderConfigurationsByProvider
    | null
    | undefined;
  const configurationsWithGroupDefaults = applyTriggerGroupDefaults(
    rawConfigurations,
    'triggers/providers',
  );
  const configurations = applySharedTriggerConfigurationByName(configurationsWithGroupDefaults);
  const allowedTriggers = new Set(['docker', 'dockercompose']);

  if (options.agent && configurations) {
    const filteredConfigurations: ProviderConfigurationsByProvider = {};
    Object.keys(configurations).forEach((provider) => {
      if (allowedTriggers.has(provider.toLowerCase())) {
        filteredConfigurations[provider] = configurations[provider];
      } else {
        log.warn(`Trigger type '${provider}' is not supported in Agent mode and will be ignored.`);
      }
    });
    try {
      await registerComponents('trigger', filteredConfigurations, 'triggers/providers');
    } catch (e: unknown) {
      log.warn(`Some triggers failed to register (${getErrorMessage(e)})`);
      log.debug(e);
    }
    return;
  }

  try {
    await registerComponents('trigger', configurations, 'triggers/providers');
  } catch (e: unknown) {
    log.warn(`Some triggers failed to register (${getErrorMessage(e)})`);
    log.debug(e);
  }
}

/**
 * Register registries.
 * @returns {Promise}
 */
async function registerRegistries() {
  const defaultRegistries = {
    alicr: { public: '' },
    codeberg: { public: '' },
    dhi: { public: '' },
    docr: { public: '' },
    ecr: { public: '' },
    gar: { public: '' },
    gcr: { public: '' },
    ghcr: { public: '' },
    hub: { public: '' },
    ibmcr: { public: '' },
    lscr: { public: '' },
    mau: { public: '' },
    ocir: { public: '' },
    quay: { public: '' },
    trueforge: { public: '' },
  };
  const configuredRegistries = sanitizeLegacyPublicTokenAuthConfigurations(
    getRegistryConfigurations() as ProviderConfigurationsByProvider | null | undefined,
  );
  const providers = new Set([
    ...Object.keys(defaultRegistries),
    ...Object.keys(configuredRegistries || {}),
  ]);
  const registriesToRegister = {
    ...Array.from(providers).reduce((mergedRegistries, provider) => {
      const defaultProviderConfiguration = toNamedConfigurationMap(
        (defaultRegistries as Record<string, unknown>)[provider],
      );
      const configuredProviderConfiguration = toNamedConfigurationMap(
        (configuredRegistries as Record<string, unknown>)?.[provider],
      );
      mergedRegistries[provider] = mergeProviderConfigurations(
        defaultProviderConfiguration,
        configuredProviderConfiguration,
      );
      return mergedRegistries;
    }, {} as ProviderConfigurationsByProvider),
  };

  try {
    await registerComponents('registry', registriesToRegister, 'registries/providers');
  } catch (e: unknown) {
    log.warn(`Some registries failed to register (${getErrorMessage(e)})`);
    log.debug(e);
  }
}

/**
 * Register authentications.
 */
async function registerAuthentications() {
  authenticationRegistrationErrors.length = 0;
  const configurations = getAuthenticationConfigurations() as
    | ProviderConfigurationsByProvider
    | null
    | undefined;
  const hasAuthEnvConfiguration = Object.keys(ddEnvVars).some((envKey) =>
    envKey.toUpperCase().startsWith('DD_AUTH_'),
  );

  if (!configurations || Object.keys(configurations).length === 0) {
    log.info('No authentication configured => Allow anonymous access');
    try {
      await registerComponent({
        kind: 'authentication',
        provider: 'anonymous',
        name: 'anonymous',
        configuration: {},
        componentPath: 'authentications/providers',
      });
    } catch (e: unknown) {
      log.error(`Some authentications failed to register (${getErrorMessage(e)})`);
      log.debug(e);
    }
    if (hasAuthEnvConfiguration) {
      log.error(
        'Detected DD_AUTH_* environment variables, but no configured authentication providers were registered successfully. Validate DD_AUTH_* values (for basic auth: DD_AUTH_BASIC_<NAME>_USER and DD_AUTH_BASIC_<NAME>_HASH). Drydock will continue running without auth if anonymous access is allowed.',
      );
    }
    return;
  }

  const registrationAttempts = Object.keys(configurations).flatMap((provider) => {
    const providerConfigurations = configurations[provider];
    return Object.keys(providerConfigurations).map((name) => ({
      provider: provider.toLowerCase(),
      name,
      configuration: providerConfigurations[name] as ComponentConfiguration,
    }));
  });
  const registrationResults = await Promise.allSettled(
    registrationAttempts.map((attempt) =>
      registerComponent({
        kind: 'authentication',
        provider: attempt.provider,
        name: attempt.name,
        configuration: attempt.configuration,
        componentPath: 'authentications/providers',
      }),
    ),
  );
  const failures = registrationResults
    .map((result, index) => ({ result, attempt: registrationAttempts[index] }))
    .filter(
      (
        candidate,
      ): candidate is {
        result: PromiseRejectedResult;
        attempt: (typeof registrationAttempts)[number];
      } => candidate.result.status === 'rejected',
    );
  const successfulRegistrations = registrationResults.length - failures.length;

  if (failures.length > 0) {
    const failureMessages = failures.map((failure) => getErrorMessage(failure.result.reason));
    const message = `Some authentications failed to register (${failureMessages.join('; ')})`;
    log.error(message);
    failures.forEach((failure) => log.debug(failure.result.reason));
    registrationWarnings.push(message);

    authenticationRegistrationErrors.push(
      ...failures.map(({ attempt, result }) => {
        const rawMessage = getErrorMessage(result.reason);
        const wrappedMessageMatch = rawMessage.match(
          /^Error when registering component .* \((?<error>.*)\)$/,
        );
        /* v8 ignore next -- wrappedMessageMatch group extraction depends on provider-specific error formatting */
        const normalizedMessage = (wrappedMessageMatch?.groups?.error ?? rawMessage).replaceAll(
          /"([^"]+)"/g,
          '$1',
        );
        return {
          provider: `${attempt.provider}:${attempt.name}`,
          error: normalizedMessage,
        };
      }),
    );
  }

  if (hasAuthEnvConfiguration && successfulRegistrations === 0) {
    log.error(
      'Detected DD_AUTH_* environment variables, but no configured authentication providers were registered successfully. Validate DD_AUTH_* values (for basic auth: DD_AUTH_BASIC_<NAME>_USER and DD_AUTH_BASIC_<NAME>_HASH). Drydock will continue running without auth if anonymous access is allowed.',
    );
  }

  // If all configured auth providers failed, attempt anonymous fallback.
  // The Anonymous provider itself enforces fail-closed on fresh installs
  // without DD_ANONYMOUS_AUTH_CONFIRM=true — the security boundary is
  // inside Anonymous, not here.
  if (Object.keys(state.authentication).length === 0) {
    log.error(
      'All configured authentication providers failed to register — attempting anonymous fallback',
    );
    try {
      await registerComponent({
        kind: 'authentication',
        provider: 'anonymous',
        name: 'anonymous',
        configuration: {},
        componentPath: 'authentications/providers',
      });
    } catch (e: unknown) {
      const fallbackMessage = `Anonymous authentication fallback also failed (${getErrorMessage(e)}). Check your DD_AUTH_BASIC_* environment variables. Set DD_ANONYMOUS_AUTH_CONFIRM=true to allow anonymous access as a fallback.`;
      log.error(fallbackMessage);
      log.debug(e);
      registrationWarnings.push(fallbackMessage);
    }
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
    } catch (e: unknown) {
      log.warn(`Agent ${name} failed to register (${getErrorMessage(e)})`);
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
  } catch (e: unknown) {
    throw new Error(
      `Error when deregistering component ${component.getId()} (${getErrorMessage(e)})`,
    );
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
  } catch (e: unknown) {
    throw new Error(`Error when trying to deregister ${getErrorMessage(e)}`);
  }
}

async function shutdown() {
  try {
    securityScheduler.shutdown();
    await deregisterAll();
    await store.save();
    process.exit(0);
  } catch (e: unknown) {
    log.error(getErrorMessage(e));
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
  try {
    pruneOrphanedLocalContainers();
  } catch (e: unknown) {
    log.warn(`Unable to prune orphaned local containers (${getErrorMessage(e)})`);
    log.debug(e);
  }

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
  applySharedTriggerConfigurationByName as testable_applySharedTriggerConfigurationByName,
  applyTriggerGroupDefaults as testable_applyTriggerGroupDefaults,
  deregisterAll as testable_deregisterAll,
  deregisterAuthentications as testable_deregisterAuthentications,
  deregisterComponent as testable_deregisterComponent,
  deregisterRegistries as testable_deregisterRegistries,
  deregisterTriggers as testable_deregisterTriggers,
  deregisterWatchers as testable_deregisterWatchers,
  getKnownProviderSet as testable_getKnownProviderSet,
  log as testable_log,
  registerAuthentications as testable_registerAuthentications,
  registerComponent as testable_registerComponent,
  registerComponents as testable_registerComponents,
  registerRegistries as testable_registerRegistries,
  registerTriggers as testable_registerTriggers,
  registerWatchers as testable_registerWatchers,
  registrationWarnings as testable_registrationWarnings,
  shutdown as testable_shutdown,
};
