/**
 * Validate a candidate `DD_*` env map against every real component schema —
 * the five component discoverers (watcher, trigger, registry, authentication,
 * agent) and the section-level Joi schemas — without starting anything.
 * Roadmap 7.1 slice 2 (spec-7.1-config-file.md, section 7): this is the one
 * function the startup check, `drydock config validate` (slice 3) and
 * `POST /api/v1/config/validate` (slice 5) all call, so an invalid file (or
 * an invalid candidate document) is reported the same way everywhere.
 *
 * Pure and side-effect-free by construction: it never calls a component's
 * `register()` or `init()` (see `constructComponent` in
 * `../../registry/component-resolution.ts`, which resolves and constructs a
 * provider class but stops there), and it never imports `../../store/index.js`
 * — the store's own configuration schema lives behind a module with real
 * side effects (opening the SQLite database) at import time, which a pure
 * validator must not trigger merely by being called. That's also why this
 * validates five section schemas, not eight: `getStoreConfiguration` in
 * `../index.ts` performs no Joi validation of its own — the schema that
 * validates its output lives in `../../store/index.ts`, which this module
 * deliberately never imports.
 */

import Agent from '../../agent/components/Agent.js';
import type Component from '../../registry/Component.js';
import {
  constructComponent,
  getAvailableProviders,
  getHelpfulErrorMessage,
  type RegistryComponentKind,
} from '../../registry/component-resolution.js';
import { getErrorMessage } from '../../util/error.js';
import {
  ddEnvVars,
  getAgentConfigurations,
  getAuthenticationConfigurations,
  getMaturitySweepConfiguration,
  getPrometheusConfiguration,
  getRegistryConfigurations,
  getSecurityConfiguration,
  getServerConfiguration,
  getTriggerConfigurations,
  getWatcherConfigurations,
  getWebhookConfiguration,
} from '../index.js';

interface ConfigurationValidationError {
  /** Dot-separated YAML path, e.g. "registry.ghcr.private.token". */
  path: string;
  /** The DD_*-prefixed env key the same value would carry, e.g.
   * "DD_REGISTRY_GHCR_PRIVATE_TOKEN". */
  envKey: string;
  message: string;
}

export interface ConfigurationValidationResult {
  errors: ConfigurationValidationError[];
}

interface DiscoveryEntry {
  kind: RegistryComponentKind;
  provider: string;
  name: string;
  configuration: unknown;
  componentPath: string;
}

// Mirrors ACTION_TRIGGER_ENV_TYPES in ../index.ts, which itself mirrors
// ACTION_TRIGGER_TYPES in ../../triggers/trigger-category.ts. Duplicated for
// the same reason ../index.ts's own copy is: this validator sits as low in
// the module graph as ../index.ts does (it composes discoverers from it),
// so importing trigger-domain modules here risks a require cycle for no
// benefit — the set is small and has changed on the order of years, not
// releases.
const ACTION_TRIGGER_PROVIDER_TYPES = new Set(['docker', 'dockercompose', 'portainer', 'command']);

function triggerEnvPrefix(provider: string): 'ACTION' | 'NOTIFICATION' {
  return ACTION_TRIGGER_PROVIDER_TYPES.has(provider.toLowerCase()) ? 'ACTION' : 'NOTIFICATION';
}

const FIXED_PROVIDER_KINDS = new Set<RegistryComponentKind>(['watcher', 'agent']);

// registerComponent's RegistryComponentKind ('authentication', used for the
// componentPath/provider-directory lookup) and get()'s DD_* prefix ('auth',
// read from ddEnvVars as `dd.auth` in getAuthenticationConfigurations) are
// two different names for the same kind — confirmed against
// authentications/providers/anonymous/Anonymous.ts and nodemon.json, both of
// which use DD_AUTH_*, never DD_AUTHENTICATION_*. Every other kind's
// RegistryComponentKind literal already matches its env prefix.
const KIND_TOP_SEGMENT: Partial<Record<RegistryComponentKind, string>> = {
  authentication: 'auth',
};

/**
 * The YAML/env segments naming one discovered instance, before any
 * field-level detail from a Joi rejection is appended. `watcher` and `agent`
 * have exactly one provider each (`docker`, `dd`) that's implied by the kind
 * rather than configured, so — matching flatten.ts's own mirror of the env
 * tree — the provider never appears as its own path segment for those two
 * kinds; every other kind names it (`registry.ghcr.private`,
 * `notification.slack.myslack`).
 */
function instanceSegments(entry: DiscoveryEntry): string[] {
  const topSegment =
    entry.kind === 'trigger'
      ? triggerEnvPrefix(entry.provider).toLowerCase()
      : (KIND_TOP_SEGMENT[entry.kind] ?? entry.kind);
  const segments = [topSegment];
  if (!FIXED_PROVIDER_KINDS.has(entry.kind)) {
    segments.push(entry.provider.toLowerCase());
  }
  segments.push(entry.name.toLowerCase());
  return segments;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// The top-level shape of every discoverer's return value is guaranteed by
// get() (configuration/index.ts), which always builds and returns a plain
// object literal — never null, an array, or a primitive — so collectors take
// that shape as given rather than re-guarding against it. What get() cannot
// guarantee is the shape ONE LEVEL DOWN: `DD_REGISTRY_GHCR=token` (no name
// segment) leaves configurations.ghcr as the string 'token', not a nested
// {name: config} object, which is why collectProviderEntries still checks
// each provider's own value.
function collectWatcherEntries(configurations: Record<string, unknown>): DiscoveryEntry[] {
  return Object.keys(configurations).map((name) => ({
    kind: 'watcher',
    provider: 'docker',
    name,
    configuration: configurations[name],
    componentPath: 'watchers/providers',
  }));
}

function collectProviderEntries(
  kind: RegistryComponentKind,
  configurations: Record<string, unknown>,
  componentPath: string,
): DiscoveryEntry[] {
  const entries: DiscoveryEntry[] = [];
  for (const provider of Object.keys(configurations)) {
    const instances = configurations[provider];
    if (!isObjectRecord(instances)) {
      continue;
    }
    for (const name of Object.keys(instances)) {
      entries.push({ kind, provider, name, configuration: instances[name], componentPath });
    }
  }
  return entries;
}

function collectAgentEntries(configurations: Record<string, unknown>): DiscoveryEntry[] {
  return Object.keys(configurations).map((name) => ({
    kind: 'agent',
    provider: 'dd',
    name,
    configuration: configurations[name],
    componentPath: 'agent/components',
  }));
}

/**
 * getTriggerConfigurations() throws when a legacy (removed as of v1.7.0)
 * trigger-prefix key is present (assertNoLegacyTriggerEnvVars), the same way
 * it does for the real controller startup path — that's a real, actionable
 * configuration error, so it becomes one error entry rather than aborting
 * the whole validation. The thrown message already names every offending
 * key and its replacement, so it carries the detail; this only needs a
 * stable path/envKey since there's no single instance to point at.
 */
function collectTriggerEntries(errors: ConfigurationValidationError[]): DiscoveryEntry[] {
  try {
    return collectProviderEntries('trigger', getTriggerConfigurations(), 'triggers/providers');
  } catch (error) {
    errors.push({ path: 'trigger', envKey: 'trigger', message: getErrorMessage(error) });
    return [];
  }
}

/**
 * Temporarily substitutes `candidate` for the live `ddEnvVars` singleton for
 * the duration of a synchronous callback, then restores the original
 * contents. Safe specifically *because* `run` is synchronous: nothing else
 * can observe the substituted state, since JS never interleaves other code
 * into a running synchronous callback. This is what lets every existing
 * discoverer and section getter in `../index.ts` — none of which take an
 * env override — validate an arbitrary candidate map unmodified, instead of
 * threading a second parameter through ten call sites that are read from
 * dozens of others. Never call this with an async `run`: holding the
 * substitution across an `await` would let concurrent code (another
 * request, a scheduled job) read the candidate map as if it were live.
 *
 * `candidate` is snapshotted before ddEnvVars is touched. Without that,
 * `validateStartupConfiguration()`'s real call — `validateConfiguration(
 * ddEnvVars)`, the same object as the singleton this function mutates —
 * would alias `candidate` to `ddEnvVars` itself: deleting the singleton's
 * keys would delete `candidate`'s keys too (same object), so the very next
 * line would reassign from an already-emptied map. Every unit test in
 * validate.test.ts passes a fresh object literal, which is why this only
 * surfaced in configuration/index.test.ts's real-module integration test.
 */
function withCandidateEnv<T>(candidate: Record<string, string | undefined>, run: () => T): T {
  const candidateSnapshot: Record<string, string | undefined> = { ...candidate };
  const original: Record<string, string | undefined> = { ...ddEnvVars };
  for (const key of Object.keys(ddEnvVars)) {
    delete ddEnvVars[key];
  }
  Object.assign(ddEnvVars, candidateSnapshot);
  try {
    return run();
  } finally {
    for (const key of Object.keys(ddEnvVars)) {
      delete ddEnvVars[key];
    }
    Object.assign(ddEnvVars, original);
  }
}

interface SectionSchema {
  /** Dot path prefix matching the YAML shape, e.g. "server.webhook". */
  path: string;
  getter: () => unknown;
}

// The five section-level Joi schemas that live in ../index.ts and validate
// on every call (throwing on failure) rather than lazily on first read.
// getStoreConfiguration is deliberately excluded — see the module doc
// comment above for why.
const SECTION_SCHEMAS: SectionSchema[] = [
  { path: 'server', getter: getServerConfiguration },
  { path: 'prometheus', getter: getPrometheusConfiguration },
  { path: 'server.webhook', getter: getWebhookConfiguration },
  { path: 'security', getter: getSecurityConfiguration },
  { path: 'maturity.sweep', getter: getMaturitySweepConfiguration },
];

interface JoiLikeDetail {
  path?: Array<string | number>;
}

interface JoiLikeError {
  details?: JoiLikeDetail[];
}

function joiFieldSegments(error: unknown): string[] {
  const detailPath = (error as JoiLikeError)?.details?.[0]?.path;
  if (!Array.isArray(detailPath)) {
    return [];
  }
  return detailPath.map((segment) => String(segment));
}

function buildPath(rootPath: string, fieldSegments: string[]): string {
  return fieldSegments.length > 0 ? `${rootPath}.${fieldSegments.join('.')}` : rootPath;
}

function buildEnvKey(rootEnvKey: string, fieldSegments: string[]): string {
  return fieldSegments.length > 0
    ? `${rootEnvKey}_${fieldSegments.map((segment) => segment.toUpperCase()).join('_')}`
    : rootEnvKey;
}

function validateSectionSchemas(errors: ConfigurationValidationError[]): void {
  for (const section of SECTION_SCHEMAS) {
    try {
      section.getter();
    } catch (error) {
      const fieldSegments = joiFieldSegments(error);
      const rootEnvKey = `DD_${section.path
        .split('.')
        .map((segment) => segment.toUpperCase())
        .join('_')}`;
      errors.push({
        path: buildPath(section.path, fieldSegments),
        envKey: buildEnvKey(rootEnvKey, fieldSegments),
        message: getErrorMessage(error),
      });
    }
  }
}

/**
 * Resolve and construct the class for one discovered instance — never
 * calling `register()` or `init()` — the same way `registerComponent` in
 * `../../registry/index.ts` does for the ordinary (non-agent-wrapped) case,
 * via the shared `constructComponent` helper. `agent` is the one kind with
 * no per-provider module to resolve (there's exactly one Agent class,
 * statically imported here the same way `registry/index.ts`'s
 * `registerAgents` does).
 */
async function constructForEntry(entry: DiscoveryEntry): Promise<Component> {
  if (entry.kind === 'agent') {
    return new Agent() as unknown as Component;
  }
  return (await constructComponent(entry.kind, entry.provider, entry.componentPath)) as Component;
}

async function validateEntry(
  entry: DiscoveryEntry,
  errors: ConfigurationValidationError[],
): Promise<void> {
  const segments = instanceSegments(entry);
  const rootPath = segments.join('.');
  const rootEnvKey = `DD_${segments.map((segment) => segment.toUpperCase()).join('_')}`;

  let component: Component;
  try {
    component = await constructForEntry(entry);
  } catch (error) {
    const availableProviders = getAvailableProviders(entry.componentPath);
    const helpfulMessage = getHelpfulErrorMessage(
      entry.kind,
      entry.provider,
      getErrorMessage(error),
      availableProviders,
    );
    errors.push({ path: rootPath, envKey: rootEnvKey, message: helpfulMessage });
    return;
  }

  try {
    component.validateConfiguration(entry.configuration as object);
  } catch (error) {
    const fieldSegments = joiFieldSegments(error);
    errors.push({
      path: buildPath(rootPath, fieldSegments),
      envKey: buildEnvKey(rootEnvKey, fieldSegments),
      message: getErrorMessage(error),
    });
  }
}

/**
 * Validate `envMap` against every component schema and section schema.
 * Never starts I/O, never calls `register()`/`init()`. `envMap` is a
 * standalone candidate map — the caller is responsible for it already being
 * the merged (env-over-file) result when validating a running instance's
 * effective configuration; this function does no merging of its own.
 */
export async function validateConfiguration(
  envMap: Record<string, string | undefined>,
): Promise<ConfigurationValidationResult> {
  const errors: ConfigurationValidationError[] = [];

  const discoveryEntries = withCandidateEnv(envMap, () => {
    validateSectionSchemas(errors);
    return [
      ...collectWatcherEntries(getWatcherConfigurations()),
      ...collectTriggerEntries(errors),
      ...collectProviderEntries('registry', getRegistryConfigurations(), 'registries/providers'),
      ...collectProviderEntries(
        'authentication',
        getAuthenticationConfigurations(),
        'authentications/providers',
      ),
      ...collectAgentEntries(getAgentConfigurations()),
    ];
  });

  for (const entry of discoveryEntries) {
    await validateEntry(entry, errors);
  }

  return { errors };
}
