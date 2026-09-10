/**
 * Registry handling all components (registries, triggers, watchers).
 */

import path from 'node:path';
import capitalize from 'capitalize';
import logger from '../log/index.js';
import * as maturityScheduler from '../maturity/scheduler.js';
import * as securityScheduler from '../security/scheduler.js';
import * as storeContainer from '../store/container.js';
import * as store from '../store/index.js';

const log = logger.child({ component: 'registry' });

import Agent, { type AgentConfiguration } from '../agent/components/Agent.js';
import type Authentication from '../authentications/providers/Authentication.js';
import {
  ddEnvVars,
  getAgentConfigurations,
  getAuthenticationConfigurations,
  getLocalWatcherEnabled,
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
  constructComponent,
  getAvailableProviders,
  getHelpfulErrorMessage,
  resolveComponentModuleSpecifier,
  resolveComponentRoot,
} from './component-resolution.js';
import {
  canonicalConfigurationJSON,
  diffComponentConfigurations,
  type ReconcilePlan,
} from './reconcile.js';
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
  isOwnerValid?: () => boolean;
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

/**
 * The options the running process was actually started with — `init`'s own
 * argument, remembered here so a later reload's `buildDesiredEntriesForKind`
 * (roadmap 7.1 slice 6) can recompute desired watcher/trigger state under the
 * same `{ agent: true }` restriction real registration used, instead of the
 * `{}` it used to pass unconditionally. Passing `{}` there let a reload in
 * agent mode compute (and reconcile in) a controller-only `docker.local`
 * watcher or a trigger outside `AGENT_ALLOWED_TRIGGER_PROVIDERS`, since
 * neither builder had any way to know the process was ever started with
 * `agent: true`.
 */
let registrationOptions: RegistrationOptions = {};

/**
 * The canonical JSON of the *raw* configuration passed to `registerComponent`
 * for every currently-registered non-agent component, keyed by
 * `${kind}:${id}`. Roadmap 7.1 slice 6's reload reconciliation
 * (spec-7.1-config-file.md section 4.3) diffs this against a freshly
 * computed desired-state map to decide what to leave alone, deregister, or
 * (re-)register — hashing `component.configuration` instead would not work,
 * since that field holds the *validated* value with Joi defaults applied
 * (`Component.ts`), which never equals the raw desired input and would read
 * every component as changed on every reload.
 *
 * The `kind` prefix exists because `Component.getId()` is `type.name` with no
 * kind segment, and a `type`/`name` pair can collide across kinds — e.g. a
 * `docker` watcher and a `docker` action trigger can both be named `local`.
 */
const componentRawConfigurations = new Map<string, string>();

function rawConfigurationKey(kind: ComponentKind, id: string): string {
  return `${kind}:${id}`;
}

export function getState(): Readonly<RegistryState> {
  return state;
}

export function getRegistrationWarnings(): string[] {
  return [...registrationWarnings];
}

export function getAuthenticationRegistrationErrors(): AuthenticationRegistrationError[] {
  return [...authenticationRegistrationErrors];
}

/**
 * Returns true when the registered authentication state contains a strategy
 * whose description type is 'anonymous', i.e. anonymous authentication is
 * the configured (and confirmed) auth mode.
 */
export function isAnonymousAuthenticationActive(): boolean {
  return Object.values(state.authentication).some(
    (authentication) => authentication.getStrategyDescription().type === 'anonymous',
  );
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
  log.debug(`Resolving ${kind}.${providerLowercase}.${nameLowercase}`);
  try {
    let component: Component;
    if (agent) {
      // A remote-agent-owned watcher/trigger is always the fixed
      // `AgentWatcher`/`AgentTrigger` proxy class, one per kind, never a
      // per-provider module — structurally different from an ordinary
      // provider lookup, so it isn't part of constructComponent's
      // kind+provider+componentPath contract and stays resolved inline.
      const componentRoot = resolveComponentRoot(kind, componentPath);
      const componentFileBase = path.join(componentRoot, `Agent${capitalize(kind)}`);
      const componentModuleSpecifier = resolveComponentModuleSpecifier(componentFileBase);
      const componentModule = await import(componentModuleSpecifier);
      const ComponentClass = componentModule.default || componentModule;
      component = new ComponentClass();
    } else {
      component = (await constructComponent(kind, providerLowercase, componentPath)) as Component;
    }
    const componentRegistered = await component.register(
      kind,
      providerLowercase,
      nameLowercase,
      configuration,
      agent,
    );

    if (options.isOwnerValid && !options.isOwnerValid()) {
      await component.deregister();
      throw new Error('Agent component registration owner retired');
    }
    addComponentToState(kind, component);
    // Only tracked for controller-owned (non-agent) components: an
    // agent-owned watcher/trigger is already reconciled by
    // `AgentClient._doHandshake()`'s own deregister-all-then-re-register
    // cycle on every reconnect, not by a file reload, so it has no desired
    // state for `reconcileComponentsWithConfiguration` to compare against.
    if (!agent) {
      componentRawConfigurations.set(
        rawConfigurationKey(kind, componentRegistered.getId()),
        canonicalConfigurationJSON(configuration),
      );
    }
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

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
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
 *
 * Resolves to the names of the local watchers registration was attempted for,
 * which `pruneOrphanedLocalContainers` needs: a watcher the operator still has
 * configured is coming back once whatever broke it is fixed, whether or not it
 * registered this time, so its container records are not orphans.
 * @param options
 * @returns {Promise<Set<string>>}
 */
interface WatcherRegistrationEntry {
  name: string;
  configuration: ComponentConfiguration;
}

/**
 * The set of `docker` watcher entries `registerWatchers` would register, and
 * the local watcher names `pruneOrphanedLocalContainers` needs — pulled out
 * of `registerWatchers` so roadmap 7.1 slice 6's reload reconciliation
 * (`buildDesiredEntriesForKind`) can compute the *desired* watcher state the
 * same way real registration does, without also registering anything or
 * exiting the process. Pure: no logging, no I/O, no `registerComponent` call.
 */
function buildWatcherProviderConfigurations(
  configurations: Record<string, Record<string, unknown>>,
  options: RegistrationOptions,
): {
  entries: WatcherRegistrationEntry[];
  configuredLocalWatcherNames: Set<string>;
} {
  const configuredLocalWatcherNames = new Set<string>();
  if (Object.keys(configurations).length === 0) {
    if (options.agent || !getLocalWatcherEnabled()) {
      return { entries: [], configuredLocalWatcherNames };
    }
    configuredLocalWatcherNames.add('local');
    return {
      entries: [{ name: 'local', configuration: {} }],
      configuredLocalWatcherNames,
    };
  }
  const entries = Object.keys(configurations).map((watcherKey) => {
    const watcherKeyNormalize = watcherKey.toLowerCase();
    configuredLocalWatcherNames.add(watcherKeyNormalize);
    return {
      name: watcherKeyNormalize,
      configuration: configurations[watcherKeyNormalize] as ComponentConfiguration,
    };
  });
  return { entries, configuredLocalWatcherNames };
}

/**
 * Register watchers.
 *
 * Resolves to the names of the local watchers registration was attempted for,
 * which `pruneOrphanedLocalContainers` needs: a watcher the operator still has
 * configured is coming back once whatever broke it is fixed, whether or not it
 * registered this time, so its container records are not orphans.
 * @param options
 * @returns {Promise<Set<string>>}
 */
async function registerWatchers(options: RegistrationOptions = {}): Promise<Set<string>> {
  const configurations = getWatcherConfigurations();
  const { entries, configuredLocalWatcherNames } = buildWatcherProviderConfigurations(
    configurations,
    options,
  );
  try {
    if (Object.keys(configurations).length === 0) {
      if (options.agent) {
        log.error('Agent mode requires at least one watcher configured.');
        process.exit(1);
      }
      if (!getLocalWatcherEnabled()) {
        log.info('Default local watcher disabled (DD_LOCAL_WATCHER=false)');
      } else {
        log.info('No Watcher configured => Init a default one (Docker with default options)');
      }
    }
    const watchersToRegister = entries.map((entry) =>
      registerComponent({
        kind: 'watcher',
        provider: 'docker',
        name: entry.name,
        configuration: entry.configuration,
        componentPath: 'watchers/providers',
      }),
    );
    // allSettled rather than all: Promise.all settles the await on the first
    // rejection while the other registrations are still in flight, so a watcher
    // that registers perfectly well can land in the registry after init has
    // already run the orphan prune and read an emptier registry than the one it
    // is deciding about.
    const registrations = await Promise.allSettled(watchersToRegister);
    const failedRegistration = registrations.find(
      (registration): registration is PromiseRejectedResult => registration.status === 'rejected',
    );
    if (failedRegistration) {
      throw failedRegistration.reason;
    }
  } catch (e: unknown) {
    log.warn(`Some watchers failed to register (${getErrorMessage(e)})`);
    log.debug(e);
  }
  return configuredLocalWatcherNames;
}

/**
 * Delete container records that belong to the controller itself (no `agent`
 * field) but name a local watcher that is neither registered nor configured,
 * e.g. after an operator renames a `DD_WATCHER_<NAME>_SOCKET` key.
 *
 * A record is kept when its watcher is registered, and also when its watcher is
 * only still configured. Registration fails for reasons that are usually
 * transient and have nothing to do with what the store holds (unreachable
 * socket, unreadable CA file, invalid cron), and the operator who still has
 * that watcher in `DD_WATCHER_*` expects it back once the configuration is
 * fixed. Pruning on registration alone would delete the records of one failed
 * watcher out of two configured, since the surviving one keeps the registered
 * set non-empty (DR-113).
 *
 * `configuredLocalWatcherNames` being empty is a different thing again and does
 * mean prune. Nothing was even attempted when the operator disabled the default
 * local watcher (`DD_LOCAL_WATCHER=false`) and configured none of their own: the
 * controller is a pure aggregator, so every controller-owned record it still
 * holds is genuinely orphaned. A container that moved from the controller's
 * local watcher to a remote agent is exactly that case, and leaving the record
 * behind strands the container for good: the agent's report is refused by the
 * ownership gate in `AgentClient` because the id is already owned by the
 * controller, and the record is never rewritten to name the agent.
 *
 * The remaining case is configured watchers where every one of them failed. The
 * union below already keeps those records, and the early return keeps every
 * other controller-owned record with them, on the same reasoning as a single
 * failure: a restart where the whole watcher subsystem is down is not the
 * moment to decide anything in the store is stale.
 *
 * Every delete passes `identityChangeExpected` so the record's update-policy
 * overrides (snooze, maturity mode and minimum age, skipped tags and digests)
 * are stashed under the container's Docker id. Whatever reports that container
 * next — the renamed watcher, or the agent that took it over — arrives under the
 * same id and inherits them (DR-112).
 */
function pruneOrphanedLocalContainers(configuredLocalWatcherNames: Set<string>) {
  const registeredLocalWatcherNames = new Set(
    Object.values(getState().watcher)
      .filter((watcher) => !watcher.agent)
      .map((watcher) => watcher.name)
      .filter((watcherName): watcherName is string => typeof watcherName === 'string')
      .map((watcherName) => watcherName.toLowerCase()),
  );

  if (registeredLocalWatcherNames.size === 0 && configuredLocalWatcherNames.size > 0) {
    return;
  }

  const knownLocalWatcherNames = new Set([
    ...registeredLocalWatcherNames,
    ...configuredLocalWatcherNames,
  ]);

  const orphanedLocalContainers = storeContainer.getContainersRaw().filter((container) => {
    if (container.agent) {
      return false;
    }
    if (typeof container.watcher !== 'string') {
      return true;
    }
    return !knownLocalWatcherNames.has(container.watcher.toLowerCase());
  });

  orphanedLocalContainers.forEach((container) => {
    storeContainer.deleteContainer(container.id, { identityChangeExpected: true });
  });

  if (orphanedLocalContainers.length > 0) {
    log.warn(
      `Pruned ${orphanedLocalContainers.length} container entries from missing local watcher(s)`,
    );
  }
}

function pruneOrphanedAgentContainers() {
  const registeredAgentNames = new Set(
    Object.values(getState().agent)
      .map((agent) => agent.name)
      .filter((name): name is string => typeof name === 'string')
      .map((name) => name.toLowerCase()),
  );

  const orphanedAgentContainers = storeContainer.getContainersRaw().filter((container) => {
    if (typeof container.agent !== 'string' || container.agent === '') {
      return false;
    }
    return !registeredAgentNames.has(container.agent.toLowerCase());
  });

  orphanedAgentContainers.forEach((container) => {
    // DR-115: the agent that owned this record was removed from config or renamed,
    // not shut down, so the same physical container is likely to reappear under a
    // different agent name or back on the controller's own watcher. The Docker id
    // is what survives that hand-off, so stash the update policy under it the same
    // way DR-112's identity-change path does.
    storeContainer.deleteContainer(container.id, { identityChangeExpected: true });
  });

  if (orphanedAgentContainers.length > 0) {
    log.warn(`Pruned ${orphanedAgentContainers.length} container entries from removed agent(s)`);
  }
}

const AGENT_ALLOWED_TRIGGER_PROVIDERS = new Set(['docker', 'dockercompose']);

/**
 * The trigger provider configurations `registerTriggers` would register
 * (`action.*`/`notification.*`, group defaults and same-name shared
 * threshold applied, agent-mode's provider allow-list applied) — pulled out
 * of `registerTriggers` for the same reason `buildWatcherProviderConfigurations`
 * is pulled out of `registerWatchers`: roadmap 7.1 slice 6's reload
 * reconciliation needs the desired trigger state without registering
 * anything. Pure: no logging beyond what's needed to explain a dropped
 * agent-mode provider, no I/O, no `registerComponent` call.
 */
function buildTriggerProviderConfigurations(
  options: RegistrationOptions,
): ProviderConfigurationsByProvider {
  const rawConfigurations = getTriggerConfigurations() as
    | ProviderConfigurationsByProvider
    | null
    | undefined;
  const configurationsWithGroupDefaults = applyTriggerGroupDefaults(
    rawConfigurations,
    'triggers/providers',
  );
  const configurations = applySharedTriggerConfigurationByName(configurationsWithGroupDefaults);

  if (!options.agent || !configurations) {
    return configurations ?? {};
  }

  const filteredConfigurations: ProviderConfigurationsByProvider = {};
  Object.keys(configurations).forEach((provider) => {
    if (AGENT_ALLOWED_TRIGGER_PROVIDERS.has(provider.toLowerCase())) {
      filteredConfigurations[provider] = configurations[provider];
    } else {
      log.warn(`Trigger type '${provider}' is not supported in Agent mode and will be ignored.`);
    }
  });
  return filteredConfigurations;
}

/**
 * Register triggers.
 * @param options
 */
async function registerTriggers(options: RegistrationOptions = {}) {
  const configurations = buildTriggerProviderConfigurations(options);
  try {
    await registerComponents('trigger', configurations, 'triggers/providers');
  } catch (e: unknown) {
    log.warn(`Some triggers failed to register (${getErrorMessage(e)})`);
    log.debug(e);
  }
}

/**
 * Secret-bearing fields that indicate a registry instance is credentialed.
 * A username/login alone without a paired secret is NOT sufficient.
 */
export const CREDENTIALED_REGISTRY_SECRET_FIELDS = [
  'token',
  'password',
  'auth',
  'clientemail',
  'privatekey',
  'accesskeyid',
  'secretaccesskey',
] as const;

/**
 * Returns true if `instance` (a registry configuration object) has at least
 * one non-blank secret-bearing field. Whitespace-only strings do NOT count.
 */
export function isCredentialedInstance(instance: unknown): boolean {
  if (!isObjectRecord(instance)) {
    return false;
  }
  return CREDENTIALED_REGISTRY_SECRET_FIELDS.some(
    (field) => typeof instance[field] === 'string' && (instance[field] as string).trim().length > 0,
  );
}

/**
 * Returns true if `configuredRegistries[providerName]` has at least one
 * instance with a non-empty secret-bearing auth field.
 */
function providerHasCredentialedInstance(
  providerName: string,
  configuredRegistries: ProviderConfigurationsByProvider | null | undefined,
): boolean {
  if (!configuredRegistries) {
    return false;
  }
  const providerConfig = (configuredRegistries as Record<string, unknown>)[providerName];
  if (!isObjectRecord(providerConfig)) {
    return false;
  }
  return Object.values(providerConfig).some(isCredentialedInstance);
}

const DEFAULT_REGISTRIES: ProviderConfigurationsByProvider = {
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

/**
 * The registry provider configurations `registerRegistries` would register
 * (every default anonymous-public seed, merged with whatever the operator
 * configured, with a provider's anonymous default dropped once a credentialed
 * instance is configured for it) — pulled out of `registerRegistries` for
 * the same reason `buildWatcherProviderConfigurations` is pulled out of
 * `registerWatchers`: roadmap 7.1 slice 6's reload reconciliation needs the
 * desired registry state without registering anything.
 */
function buildRegistryProviderConfigurations(): ProviderConfigurationsByProvider {
  const configuredRegistries = getRegistryConfigurations() as
    | ProviderConfigurationsByProvider
    | null
    | undefined;
  const providers = new Set([
    ...Object.keys(DEFAULT_REGISTRIES),
    ...Object.keys(configuredRegistries || {}),
  ]);
  return Array.from(providers).reduce((mergedRegistries, provider) => {
    const rawDefaultProviderConfiguration = toNamedConfigurationMap(
      (DEFAULT_REGISTRIES as Record<string, unknown>)[provider],
    );
    const configuredProviderConfiguration = toNamedConfigurationMap(
      (configuredRegistries as Record<string, unknown>)?.[provider],
    );
    // Skip the anonymous 'public' default when the user has configured at
    // least one credentialed instance for this provider. The credentialed
    // instance(s) will handle all traffic; keeping the public seed would
    // create a second, anonymous instance that can win the routing race and
    // send authenticated users through the anonymous tier (→ 429s).
    let defaultProviderConfiguration = rawDefaultProviderConfiguration;
    if (
      'public' in rawDefaultProviderConfiguration &&
      providerHasCredentialedInstance(provider, configuredRegistries)
    ) {
      const { public: _dropped, ...rest } = rawDefaultProviderConfiguration;
      defaultProviderConfiguration = rest;
      log.info(
        `Skipping anonymous '${provider}.public' default because credentialed instance(s) are configured`,
      );
    }
    mergedRegistries[provider] = mergeProviderConfigurations(
      defaultProviderConfiguration,
      configuredProviderConfiguration,
    );
    return mergedRegistries;
  }, {} as ProviderConfigurationsByProvider);
}

/**
 * Register registries.
 * @returns {Promise}
 */
async function registerRegistries() {
  const registriesToRegister = buildRegistryProviderConfigurations();
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
  // The Anonymous provider itself requires DD_ANONYMOUS_AUTH_CONFIRM=true
  // on every installation, so the security boundary stays inside Anonymous.
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
      const registered = await agent.register('agent', 'dd', name, config as AgentConfiguration);
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
    if (components?.[component.getId()] === component) {
      delete components[component.getId()];
      componentRawConfigurations.delete(rawConfigurationKey(kind, component.getId()));
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

interface DesiredComponentEntry {
  provider: string;
  name: string;
  configuration: ComponentConfiguration;
  componentPath: string;
}

type ReloadableComponentKind = 'watcher' | 'registry' | 'trigger';

/**
 * `authentication` and `agent` are excluded: both are restart-required in
 * v1.8 (spec-7.1-config-file.md section 4.3's table — auth strategies are
 * consulted per request and rebuilding mid-request is an auth bypass
 * surface; an `AgentClient` owns a live SSE connection). Reload only ever
 * reconciles the three kinds whose teardown is a complete, generation- or
 * subscription-guarded no-op for anything in flight.
 */
const RELOADABLE_COMPONENT_KINDS: ReloadableComponentKind[] = ['watcher', 'registry', 'trigger'];

const COMPONENT_PATH_BY_RELOADABLE_KIND: Record<ReloadableComponentKind, string> = {
  watcher: 'watchers/providers',
  registry: 'registries/providers',
  trigger: 'triggers/providers',
};

/**
 * The desired state for one reloadable kind, keyed by `provider.name` (the
 * same shape `Component.getId()` produces for a non-agent component) —
 * computed the same way real registration would (`buildWatcherProviderConfigurations`,
 * `buildRegistryProviderConfigurations`, `buildTriggerProviderConfigurations`),
 * from whatever `ddEnvVars` holds right now.
 */
function buildDesiredEntriesForKind(
  kind: ReloadableComponentKind,
): Map<string, DesiredComponentEntry> {
  const entries = new Map<string, DesiredComponentEntry>();
  const componentPath = COMPONENT_PATH_BY_RELOADABLE_KIND[kind];

  if (kind === 'watcher') {
    const { entries: watcherEntries } = buildWatcherProviderConfigurations(
      getWatcherConfigurations(),
      registrationOptions,
    );
    for (const entry of watcherEntries) {
      entries.set(`docker.${entry.name}`, {
        provider: 'docker',
        name: entry.name,
        configuration: entry.configuration,
        componentPath,
      });
    }
    return entries;
  }

  const providerConfigurations =
    kind === 'registry'
      ? buildRegistryProviderConfigurations()
      : buildTriggerProviderConfigurations(registrationOptions);

  for (const [provider, instances] of Object.entries(providerConfigurations)) {
    if (!isObjectRecord(instances)) {
      continue;
    }
    for (const [name, configuration] of Object.entries(instances)) {
      entries.set(`${provider}.${name}`, {
        provider,
        name,
        configuration: configuration as ComponentConfiguration,
        componentPath,
      });
    }
  }
  return entries;
}

export interface ComponentReconcileError {
  kind: ReloadableComponentKind;
  id: string;
  action: 'add' | 'change' | 'remove';
  message: string;
}

export interface ComponentReconcileResult {
  /** `${kind}:${id}` for every component newly registered. */
  added: string[];
  /** `${kind}:${id}` for every component deregistered then re-registered with a new configuration. */
  changed: string[];
  /** `${kind}:${id}` for every component deregistered with no replacement. */
  removed: string[];
  /** `${kind}:${id}` for every component whose configuration is unchanged — never torn down. */
  unchanged: string[];
  errors: ComponentReconcileError[];
}

/**
 * `plan.remove`/`plan.change` ids come from `diffComponentConfigurations`
 * over `currentJsonById`, whose keys are always a subset of `currentState`'s
 * own keys (`reconcileComponentsWithConfiguration` builds it from
 * `Object.entries(getState()[kind])`); `plan.change`/`plan.add` ids come
 * from the same `desiredEntries` this function is handed. Both lookups
 * below are therefore always defined — asserted, not guarded, so a broken
 * invariant fails loudly (a thrown `TypeError`, caught by the same
 * try/catch every other per-component failure already goes through) rather
 * than silently skipping a component reload was supposed to reconcile.
 */
async function applyReconcilePlanForKind(
  kind: ReloadableComponentKind,
  plan: ReconcilePlan,
  desiredEntries: Map<string, DesiredComponentEntry>,
  result: ComponentReconcileResult,
): Promise<void> {
  const currentState = getState()[kind] as Record<string, Component>;

  for (const id of plan.remove) {
    try {
      await deregisterComponent(currentState[id], kind);
      result.removed.push(rawConfigurationKey(kind, id));
    } catch (e: unknown) {
      result.errors.push({ kind, id, action: 'remove', message: getErrorMessage(e) });
    }
  }

  for (const id of plan.change) {
    try {
      await deregisterComponent(currentState[id], kind);
    } catch (e: unknown) {
      result.errors.push({ kind, id, action: 'remove', message: getErrorMessage(e) });
    }
    try {
      await registerComponent({ kind, ...desiredEntries.get(id)! });
      result.changed.push(rawConfigurationKey(kind, id));
    } catch (e: unknown) {
      result.errors.push({ kind, id, action: 'change', message: getErrorMessage(e) });
    }
  }

  for (const id of plan.add) {
    try {
      await registerComponent({ kind, ...desiredEntries.get(id)! });
      result.added.push(rawConfigurationKey(kind, id));
    } catch (e: unknown) {
      result.errors.push({ kind, id, action: 'add', message: getErrorMessage(e) });
    }
  }

  result.unchanged.push(...plan.unchanged.map((id) => rawConfigurationKey(kind, id)));
}

/**
 * Diff-based reload reconciliation (spec-7.1-config-file.md section 4.3):
 * recompute the desired watcher/registry/trigger configuration from whatever
 * `ddEnvVars` holds right now — the caller, `configuration/file/reload.ts`,
 * has already applied a validated reload's reloadable-section changes to it
 * before calling this — and reconcile the registry's current state against
 * it by difference. Never deregisters everything and starts over: a
 * component whose raw configuration is unchanged is never touched
 * (`unchanged`); a removed/changed one is torn down via the same complete
 * `deregisterComponent()` every other deregistration path already uses; an
 * added/changed one is (re-)registered via the same `registerComponent()`
 * every other registration path uses.
 *
 * Deliberately never calls `pruneOrphanedLocalContainers` or
 * `pruneOrphanedAgentContainers` (see `init()` below for those): a watcher
 * that reads as momentarily absent mid-reload must not delete its container
 * rows (section 4.3's first hazard). The caller is responsible for wrapping
 * this in the exclusive update-lifecycle lock (section 4.3's second hazard);
 * this function has no lock awareness of its own.
 *
 * A per-component failure (a deregister or register call throwing) is
 * collected in `errors` and reconciliation continues with the next
 * component — there is no whole-reconcile rollback. Rolling back would mean
 * re-registering an already-torn-down component with its old configuration,
 * itself a register call that can fail no less than the first one did, and
 * `deregisterComponent` already unconditionally removes a component from
 * `state` in its `finally` block regardless of whether teardown itself
 * threw — so by the time an error reaches this function the registry's own
 * bookkeeping for that component is never left half-applied, only that
 * component's own internal teardown may be incomplete, which re-registering
 * it cannot undo either. Continuing keeps one component's teardown failure
 * from blocking every other, independent component's reconciliation —
 * the same reasoning that makes this diff-based rather than
 * deregister-all-and-reinit in the first place.
 */
export async function reconcileComponentsWithConfiguration(): Promise<ComponentReconcileResult> {
  const result: ComponentReconcileResult = {
    added: [],
    changed: [],
    removed: [],
    unchanged: [],
    errors: [],
  };

  for (const kind of RELOADABLE_COMPONENT_KINDS) {
    const desiredEntries = buildDesiredEntriesForKind(kind);
    const desiredJsonById = new Map<string, string>();
    for (const [id, entry] of desiredEntries) {
      desiredJsonById.set(id, canonicalConfigurationJSON(entry.configuration));
    }

    const currentIds = Object.entries(getState()[kind])
      .filter(([, component]) => !(component as Component).agent)
      .map(([id]) => id);
    const currentJsonById = new Map<string, string>();
    for (const id of currentIds) {
      const raw = componentRawConfigurations.get(rawConfigurationKey(kind, id));
      if (raw !== undefined) {
        currentJsonById.set(id, raw);
      }
    }

    const plan = diffComponentConfigurations(currentJsonById, desiredJsonById);
    await applyReconcilePlanForKind(kind, plan, desiredEntries, result);
  }

  return result;
}

async function shutdown() {
  try {
    securityScheduler.shutdown();
    maturityScheduler.shutdown();
    await deregisterAll();
    await store.save();
    process.exit(0);
  } catch (e: unknown) {
    log.error(getErrorMessage(e));
    process.exit(1);
  }
}

export async function init(options: RegistrationOptions = {}) {
  registrationOptions = options;
  // Register triggers
  await registerTriggers(options);

  // Register registries
  await registerRegistries();

  // Register watchers
  const configuredLocalWatcherNames = await registerWatchers(options);
  try {
    pruneOrphanedLocalContainers(configuredLocalWatcherNames);
  } catch (e: unknown) {
    log.warn(`Unable to prune orphaned local containers (${getErrorMessage(e)})`);
    log.debug(e);
  }

  if (!options.agent) {
    // Register authentications
    await registerAuthentications();

    // Register agents
    await registerAgents();
    try {
      pruneOrphanedAgentContainers();
    } catch (e: unknown) {
      log.warn(`Unable to prune orphaned agent containers (${getErrorMessage(e)})`);
      log.debug(e);
    }
  }

  // Gracefully exit when possible — use once() to prevent stacking if init re-runs
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
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
  mergeProviderConfigurations as testable_mergeProviderConfigurations,
  pruneOrphanedAgentContainers as testable_pruneOrphanedAgentContainers,
  registerAuthentications as testable_registerAuthentications,
  registerComponent as testable_registerComponent,
  registerComponents as testable_registerComponents,
  registerRegistries as testable_registerRegistries,
  registerTriggers as testable_registerTriggers,
  registerWatchers as testable_registerWatchers,
  registrationWarnings as testable_registrationWarnings,
  shutdown as testable_shutdown,
};
