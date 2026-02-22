/**
 * Registry handling all components (registries, triggers, watchers).
 */

import fs from 'node:fs';
import path from 'node:path';
import capitalize from 'capitalize';
import logger from '../log/index.js';
import * as store from '../store/index.js';

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

    // Type assertion is safe here because we know the kind matches the expected type
    // if the file structure and inheritance are correct
    (state[kind] as any)[component.getId()] = component;
    return componentRegistered;
  } catch (e: any) {
    const availableProviders = getAvailableProviders(componentPath, (message) =>
      log.debug(message),
    );
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
  configurations: Record<string, any> | null | undefined,
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

function applySharedTriggerConfigurationByName(configurations: Record<string, any>) {
  return applySharedTriggerConfigurationByNameHelper(configurations);
}

function getKnownProviderSet(providerPath: string): Set<string> {
  return new Set(
    getAvailableProviders(providerPath, (message) => log.debug(message)).map((provider) =>
      provider.toLowerCase(),
    ),
  );
}

function applyTriggerGroupDefaults(
  configurations: Record<string, any> | null | undefined,
  providerPath: string,
): Record<string, any> | null | undefined {
  const knownProviderSet = getKnownProviderSet(providerPath);
  return applyTriggerGroupDefaultsHelper(configurations, knownProviderSet, (groupName, value) => {
    log.info(
      `Detected trigger group '${groupName}' with shared configuration: ${JSON.stringify(value)}`,
    );
  });
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
    ocir: { public: '' },
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
    await store.save();
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
  getKnownProviderSet as testable_getKnownProviderSet,
  applySharedTriggerConfigurationByName as testable_applySharedTriggerConfigurationByName,
  log as testable_log,
};
