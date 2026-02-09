/**
 * Registry handling all components (registries, triggers, watchers).
 */
import capitalize from 'capitalize';
import fs from 'fs';
import path from 'path';
import logger from '../log';
const log = logger.child({ component: 'registry' });
import {
    getWatcherConfigurations,
    getTriggerConfigurations,
    getRegistryConfigurations,
    getAuthenticationConfigurations,
    getAgentConfigurations,
} from '../configuration';
import Component, { ComponentConfiguration } from './Component';
import Trigger from '../triggers/providers/Trigger';
import Watcher from '../watchers/Watcher';
import Registry from '../registries/Registry';
import Authentication from '../authentications/providers/Authentication';
import Agent from '../agent/components/Agent';

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

type ComponentKind = keyof RegistryState;
const SHARED_TRIGGER_CONFIGURATION_KEYS = ['threshold'];

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
        const resolvedPath = path.resolve(__dirname, basePath);
        const providers = fs
            .readdirSync(resolvedPath)
            .filter((file) => {
                const filePath = path.join(resolvedPath, file);
                return fs.statSync(filePath).isDirectory();
            })
            .sort();
        return providers;
    } catch (e) {
        return [];
    }
}

/**
 * Get documentation link for a component kind.
 * @param {string} kind component kind (trigger, watcher, etc.)
 * @returns {string} documentation path
 */
function getDocumentationLink(kind: ComponentKind) {
    const docLinks: Record<ComponentKind, string> = {
        trigger:
            'https://github.com/CodesWhat/whatsupdocker-ce/tree/main/docs/configuration/triggers',
        watcher:
            'https://github.com/CodesWhat/whatsupdocker-ce/tree/main/docs/configuration/watchers',
        registry:
            'https://github.com/CodesWhat/whatsupdocker-ce/tree/main/docs/configuration/registries',
        authentication:
            'https://github.com/CodesWhat/whatsupdocker-ce/tree/main/docs/configuration/authentications',
        agent:
            'https://github.com/CodesWhat/whatsupdocker-ce/tree/main/docs/configuration/agents',
    };
    return (
        docLinks[kind] ||
        'https://github.com/CodesWhat/whatsupdocker-ce/tree/main/docs/configuration'
    );
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
        const envVarPattern = `WUD_${kindDisplay.toUpperCase()}_${provider.toUpperCase()}_*`;

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
 * @param {*} kind
 * @param {*} provider
 * @param {*} name
 * @param {*} configuration
 * @param {*} componentPath
 */
export async function registerComponent(
    kind: ComponentKind,
    provider: string,
    name: string,
    configuration: ComponentConfiguration,
    componentPath: string,
    agent?: string,
): Promise<Component> {
    const providerLowercase = provider.toLowerCase();
    const nameLowercase = name.toLowerCase();
    const componentFileByConvention = `${componentPath}/${providerLowercase}/${capitalize(provider)}`;
    const componentFileLowercase = `${componentPath}/${providerLowercase}/${providerLowercase}`;
    const componentFile = agent
        ? `${componentPath}/Agent${capitalize(kind)}`
        : fs.existsSync(path.resolve(__dirname, `${componentFileByConvention}.js`))
          ? componentFileByConvention
          : componentFileLowercase;
    try {
        const componentModule = await import(componentFile);
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
        const providerPromises = providers
            .map((provider) => {
                log.info(
                    `Register all components of kind ${kind} for provider ${provider}`,
                );
                const providerConfigurations = configurations[provider];
                return Object.keys(providerConfigurations).map(
                    (configurationName) =>
                        registerComponent(
                            kind,
                            provider,
                            configurationName,
                            providerConfigurations[configurationName],
                            path,
                        ),
                );
            })
            .flat();
        return Promise.all(providerPromises);
    }
    return [];
}

function getSharedTriggerConfigurationByName(configurations: Record<string, any>) {
    const valuesByName: Record<string, Record<string, Set<any>>> = {};

    Object.keys(configurations || {}).forEach((provider) => {
        const providerConfigurations = configurations[provider];
        if (
            !providerConfigurations ||
            typeof providerConfigurations !== 'object'
        ) {
            return;
        }
        Object.keys(providerConfigurations).forEach((triggerName) => {
            const triggerConfiguration = providerConfigurations[triggerName];
            if (
                !triggerConfiguration ||
                typeof triggerConfiguration !== 'object'
            ) {
                return;
            }
            const triggerNameNormalized = triggerName.toLowerCase();
            if (!valuesByName[triggerNameNormalized]) {
                valuesByName[triggerNameNormalized] = {};
            }

            SHARED_TRIGGER_CONFIGURATION_KEYS.forEach((key) => {
                if (triggerConfiguration[key] === undefined) {
                    return;
                }
                if (!valuesByName[triggerNameNormalized][key]) {
                    valuesByName[triggerNameNormalized][key] = new Set();
                }
                valuesByName[triggerNameNormalized][key].add(
                    triggerConfiguration[key],
                );
            });
        });
    });

    const sharedConfigurationByName: Record<string, any> = {};
    Object.keys(valuesByName).forEach((triggerName) => {
        SHARED_TRIGGER_CONFIGURATION_KEYS.forEach((key) => {
            const valuesForKey = valuesByName[triggerName][key];
            if (valuesForKey && valuesForKey.size === 1) {
                if (!sharedConfigurationByName[triggerName]) {
                    sharedConfigurationByName[triggerName] = {};
                }
                sharedConfigurationByName[triggerName][key] =
                    Array.from(valuesForKey)[0];
            }
        });
    });

    return sharedConfigurationByName;
}

function applySharedTriggerConfigurationByName(
    configurations: Record<string, any>,
) {
    const sharedConfigurationByName =
        getSharedTriggerConfigurationByName(configurations);
    const configurationsWithSharedValues: Record<string, any> = {};

    Object.keys(configurations || {}).forEach((provider) => {
        const providerConfigurations = configurations[provider];
        if (
            !providerConfigurations ||
            typeof providerConfigurations !== 'object'
        ) {
            configurationsWithSharedValues[provider] = providerConfigurations;
            return;
        }
        configurationsWithSharedValues[provider] = {};
        Object.keys(providerConfigurations).forEach((triggerName) => {
            const triggerConfiguration = providerConfigurations[triggerName];
            if (
                !triggerConfiguration ||
                typeof triggerConfiguration !== 'object'
            ) {
                configurationsWithSharedValues[provider][triggerName] =
                    triggerConfiguration;
                return;
            }
            const sharedConfiguration =
                sharedConfigurationByName[triggerName.toLowerCase()] || {};
            configurationsWithSharedValues[provider][triggerName] = {
                ...sharedConfiguration,
                ...triggerConfiguration,
            };
        });
    });

    return configurationsWithSharedValues;
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
                log.error(
                    'Agent mode requires at least one watcher configured.',
                );
                process.exit(1);
            }
            log.info(
                'No Watcher configured => Init a default one (Docker with default options)',
            );
            watchersToRegister.push(
                registerComponent(
                    'watcher',
                    'docker',
                    'local',
                    {},
                    '../watchers/providers',
                ),
            );
        } else {
            watchersToRegister = watchersToRegister.concat(
                Object.keys(configurations).map((watcherKey) => {
                    const watcherKeyNormalize = watcherKey.toLowerCase();
                    return registerComponent(
                        'watcher',
                        'docker',
                        watcherKeyNormalize,
                        configurations[watcherKeyNormalize],
                        '../watchers/providers',
                    );
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
    const configurations = applySharedTriggerConfigurationByName(
        getTriggerConfigurations(),
    );
    const allowedTriggers = ['docker', 'dockercompose'];

    if (options.agent && configurations) {
        const filteredConfigurations: Record<string, any> = {};
        Object.keys(configurations).forEach((provider) => {
            if (allowedTriggers.includes(provider.toLowerCase())) {
                filteredConfigurations[provider] = configurations[provider];
            } else {
                log.warn(
                    `Trigger type '${provider}' is not supported in Agent mode and will be ignored.`,
                );
            }
        });
        try {
            await registerComponents(
                'trigger',
                filteredConfigurations,
                '../triggers/providers',
            );
        } catch (e: any) {
            log.warn(`Some triggers failed to register (${e.message})`);
            log.debug(e);
        }
        return;
    }

    try {
        await registerComponents(
            'trigger',
            configurations,
            '../triggers/providers',
        );
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
        ecr: { public: '' },
        gcr: { public: '' },
        ghcr: { public: '' },
        hub: { public: '' },
        quay: { public: '' },
    };
    const registriesToRegister = {
        ...defaultRegistries,
        ...getRegistryConfigurations(),
    };

    try {
        await registerComponents(
            'registry',
            registriesToRegister,
            '../registries/providers',
        );
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
            await registerComponent(
                'authentication',
                'anonymous',
                'anonymous',
                {},
                '../authentications/providers',
            );
        }
        await registerComponents(
            'authentication',
            configurations,
            '../authentications/providers',
        );
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
            const registered = await agent.register(
                'agent',
                'wud',
                name,
                config,
            );
            state.agent[registered.getId()] = registered as Agent;
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
        throw new Error(
            `Error when deregistering component ${component.getId()} (${e.message})`,
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
async function deregisterComponents(
    components: Component[],
    kind: ComponentKind,
) {
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
    return deregisterComponents(
        Object.values(getState().authentication),
        'authentication',
    );
}

/**
 * Deregister all components registered against the specified agent.
 * @returns {Promise}
 */
export async function deregisterAgentComponents(agent: string) {
    const watchers = Object.values(getState().watcher).filter(
        (watcher) => watcher.agent === agent,
    );
    const triggers = Object.values(getState().trigger).filter(
        (trigger) => trigger.agent === agent,
    );
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
    process.on('SIGINT', deregisterAll);
    process.on('SIGTERM', deregisterAll);
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
    log as testable_log,
};
