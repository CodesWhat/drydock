/**
 * Label-owned field overrides (spec 7.5): the nine Container fields that Docker labels own
 * and that Drydock can durably override per container identity.
 *
 * Leaf module: it imports label key constants and types only, never the store or the
 * registry, so the store, the watchers and (later) the API can all use it without the
 * require cycles `triggers/trigger-category.ts` documents.
 *
 * Two layers per field. `declared` is what the owning watcher reported (labels, Compose,
 * imgset config). An override, when the container's scope has one, replaces it. The store
 * materializes the effective value into the ordinary Container field, so every consumer
 * keeps reading the fields it reads today, and keeps the declared layer (plus where each
 * effective value came from) in `Container.labelOwned`.
 */
import { usesControllerDockerTransport } from '../agent/controller-docker-transport.js';
import {
  parseIncludeOrIncludeTriggerString,
  splitAndTrimCommaSeparatedList,
} from '../triggers/providers/trigger-reference-matching.js';
import {
  ddActionAuto,
  ddActionExclude,
  ddActionInclude,
  ddDependsOn,
  ddDependsOnAction,
  ddDisplayIcon,
  ddDisplayName,
  ddNotificationExclude,
  ddNotificationInclude,
} from '../watchers/providers/docker/label.js';
import type { Container } from './container.js';

type LabelOwnedFamily = 'display' | 'dependencies' | 'routing';
type LabelOwnedKind = 'text' | 'icon' | 'name-list' | 'action' | 'trigger-list';
type LabelOwnedCategory = 'action' | 'notification';

export interface LabelOwnedFieldSpec {
  field: LabelOwnedField;
  labelKey: string;
  family: LabelOwnedFamily;
  kind: LabelOwnedKind;
  /** Routing fields only. */
  category?: LabelOwnedCategory;
}

export const LABEL_OWNED_FIELDS = [
  { field: 'displayName', labelKey: ddDisplayName, family: 'display', kind: 'text' },
  { field: 'displayIcon', labelKey: ddDisplayIcon, family: 'display', kind: 'icon' },
  { field: 'dependsOn', labelKey: ddDependsOn, family: 'dependencies', kind: 'name-list' },
  { field: 'dependsOnAction', labelKey: ddDependsOnAction, family: 'dependencies', kind: 'action' },
  {
    field: 'notificationTriggerInclude',
    labelKey: ddNotificationInclude,
    family: 'routing',
    kind: 'trigger-list',
    category: 'notification',
  },
  {
    field: 'notificationTriggerExclude',
    labelKey: ddNotificationExclude,
    family: 'routing',
    kind: 'trigger-list',
    category: 'notification',
  },
  {
    field: 'actionTriggerInclude',
    labelKey: ddActionInclude,
    family: 'routing',
    kind: 'trigger-list',
    category: 'action',
  },
  {
    field: 'actionTriggerExclude',
    labelKey: ddActionExclude,
    family: 'routing',
    kind: 'trigger-list',
    category: 'action',
  },
  {
    field: 'actionTriggerAuto',
    labelKey: ddActionAuto,
    family: 'routing',
    kind: 'trigger-list',
    category: 'action',
  },
] as const;

export type LabelOwnedField = (typeof LABEL_OWNED_FIELDS)[number]['field'];

/** The registry as a Map: field names from outside never become computed keys. */
const FIELD_SPECS: ReadonlyMap<string, LabelOwnedFieldSpec> = new Map(
  LABEL_OWNED_FIELDS.map((spec) => [spec.field, spec as LabelOwnedFieldSpec]),
);

export function getLabelOwnedFieldSpec(field: string): LabelOwnedFieldSpec | undefined {
  return FIELD_SPECS.get(field);
}

const DEPENDS_ON_ACTIONS = ['update', 'restart'] as const;

type LabelOwnedSource = 'override' | 'label' | 'compose' | 'watcher' | 'default' | 'unset';
type LabelOwnedDeclaredSource = Exclude<LabelOwnedSource, 'override'>;

/** A declared value in the Container field's own form: routing fields are strings. */
type LabelOwnedDeclaredValue = string | string[];
/** An override value: lists stay lists, `[]` being an explicit "none". */
export type LabelOverrideValue = string | string[];

export type LabelOwnedDeclared = Partial<Record<LabelOwnedField, LabelOwnedDeclaredValue>>;
type LabelOwnedSources = Record<LabelOwnedField, LabelOwnedSource>;
export type LabelOwnedDeclaredSources = Record<LabelOwnedField, LabelOwnedDeclaredSource>;

export interface LabelOverrideEntry {
  value: LabelOverrideValue;
  updatedAt: string;
  /** The principal's display identity, never a credential. */
  updatedBy: string;
}

export type LabelOverrideFields = Partial<Record<LabelOwnedField, LabelOverrideEntry>>;

export interface LabelOwnedState {
  v: 1;
  /** What the owning watcher reported. */
  declared: LabelOwnedDeclared;
  declaredSources: LabelOwnedDeclaredSources;
  /** Effective source per field. */
  sources: LabelOwnedSources;
}

export interface InvalidLabelOverrideField {
  field: string;
  reason: string;
}

const FIELD_NAMES: readonly LabelOwnedField[] = LABEL_OWNED_FIELDS.map((spec) => spec.field);

type LabelOwnedFlat = Pick<Container, LabelOwnedField | 'dependsOnSource'>;
type LabelOwnedContext = Pick<Container, 'name' | 'labels'>;

/**
 * The rules the Container schema applies to the flat field (`joi.string()`, and
 * `joi.array().items(joi.string())` for `dependsOn`): a stored override has to be a value
 * the container reader will accept, or one bad row would fail every container read.
 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isOverrideValueValid(kind: LabelOwnedKind, value: unknown): value is LabelOverrideValue {
  switch (kind) {
    case 'text':
    case 'icon':
      return isNonEmptyString(value);
    case 'action':
      return (DEPENDS_ON_ACTIONS as readonly unknown[]).includes(value);
    default:
      return Array.isArray(value) && value.every(isNonEmptyString);
  }
}

/**
 * Read a stored `fields` JSON document. An unreadable document or field is dropped and
 * reported, never thrown: a bad override row must not be able to fail a container write.
 */
export function parseLabelOverrideFields(raw: unknown): {
  fields: LabelOverrideFields;
  invalid: InvalidLabelOverrideField[];
} {
  const fields: LabelOverrideFields = {};
  const invalid: InvalidLabelOverrideField[] = [];
  let document: unknown = raw;
  if (typeof raw === 'string') {
    try {
      document = JSON.parse(raw);
    } catch {
      return { fields, invalid: [{ field: '*', reason: 'not valid JSON' }] };
    }
  }
  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    return { fields, invalid: [{ field: '*', reason: 'not an object' }] };
  }
  const entries: [string, LabelOverrideEntry][] = [];
  for (const [name, entry] of Object.entries(document)) {
    const spec = getLabelOwnedFieldSpec(name);
    const candidate = entry as Partial<LabelOverrideEntry> | null;
    if (spec === undefined) {
      invalid.push({ field: name, reason: 'unknown field' });
    } else if (
      candidate === null ||
      typeof candidate !== 'object' ||
      !isOverrideValueValid(spec.kind, candidate.value) ||
      typeof candidate.updatedAt !== 'string' ||
      typeof candidate.updatedBy !== 'string'
    ) {
      invalid.push({ field: name, reason: 'invalid value' });
    } else {
      entries.push([name, candidate as LabelOverrideEntry]);
    }
  }
  return { fields: Object.fromEntries(entries) as LabelOverrideFields, invalid };
}

/** The declared layer a container's flat fields currently show. */
export function captureDeclaredFromFlat(
  container: Pick<Container, LabelOwnedField>,
): LabelOwnedDeclared {
  return Object.fromEntries(
    FIELD_NAMES.filter((field) => container[field] !== undefined).map((field) => [
      field,
      structuredClone(container[field]),
    ]),
  ) as LabelOwnedDeclared;
}

function nonBlank(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '';
}

function inferDeclaredSource(
  spec: LabelOwnedFieldSpec,
  declared: LabelOwnedDeclared,
  context: LabelOwnedContext,
  dependsOnSource: Container['dependsOnSource'],
): LabelOwnedDeclaredSource {
  const value = declared[spec.field];
  if (value === undefined) {
    return 'unset';
  }
  const labelValue = context.labels?.[spec.labelKey];
  switch (spec.field) {
    case 'displayName':
      if (nonBlank(labelValue) && labelValue === value) {
        return 'label';
      }
      return value === context.name ? 'default' : 'watcher';
    case 'displayIcon':
      if (nonBlank(labelValue) && labelValue === value) {
        return 'label';
      }
      return value === 'mdi:docker' || value === '' ? 'default' : 'watcher';
    case 'dependsOn':
      return dependsOnSource === 'label' || dependsOnSource === 'compose'
        ? dependsOnSource
        : 'unset';
    case 'dependsOnAction':
      return (DEPENDS_ON_ACTIONS as readonly unknown[]).includes(
        labelValue?.trim().toLowerCase(),
      ) && labelValue?.trim().toLowerCase() === value
        ? 'label'
        : 'default';
    default:
      return labelValue === value ? 'label' : 'watcher';
  }
}

/** Where each declared value came from, inferred from the value, the labels and the name. */
export function inferDeclaredSources(
  declared: LabelOwnedDeclared,
  context: LabelOwnedContext,
  dependsOnSource: Container['dependsOnSource'],
): LabelOwnedDeclaredSources {
  return Object.fromEntries(
    LABEL_OWNED_FIELDS.map((spec) => [
      spec.field,
      inferDeclaredSource(spec, declared, context, dependsOnSource),
    ]),
  ) as LabelOwnedDeclaredSources;
}

export type AgentEnforcedRoutingField =
  | 'actionTriggerInclude'
  | 'actionTriggerExclude'
  | 'actionTriggerAuto';

interface RoutingReference {
  id: string;
  threshold: string;
  /** The comparison form, `id:threshold`. */
  key: string;
  text: string;
}

function toRoutingReferences(entries: readonly string[]): RoutingReference[] {
  return entries.map((entry) => {
    const parsed = parseIncludeOrIncludeTriggerString(entry);
    const id = parsed.id.toLowerCase();
    return {
      id,
      threshold: parsed.threshold,
      key: `${id}:${parsed.threshold}`,
      text: entry.trim(),
    };
  });
}

/** A declared routing value as comparison entries, read the way the matcher reads it. */
export function parseDeclaredRoutingEntries(declared: string | undefined): string[] {
  return toRoutingReferences(splitAndTrimCommaSeparatedList(declared ?? '')).map(
    (reference) => reference.key,
  );
}

function isIdSuffix(shorter: string, longer: string): boolean {
  const short = shorter.split('.');
  const long = longer.split('.');
  return (
    short.length <= long.length && short.every((part, i) => part === long.at(i - short.length))
  );
}

/** Two references can match one trigger id only when one is a dotted suffix of the other. */
function mayOverlap(first: string, second: string): boolean {
  return isIdSuffix(first, second) || isIdSuffix(second, first);
}

/**
 * Whether an include or auto override entry stays inside the declared list under
 * first-match. The first declared reference that can match the same trigger decides what
 * the label allows, so the entry has to name that reference and ask for no wider threshold.
 * Sound for any trigger: every trigger the entry matches is matched by that same declared
 * reference first.
 */
export function isEntryPermittedByDeclared(entry: string, declared: string | undefined): boolean {
  const [candidate] = toRoutingReferences([entry]);
  const first = toRoutingReferences(splitAndTrimCommaSeparatedList(declared ?? '')).find(
    (reference) => mayOverlap(reference.id, candidate.id),
  );
  return (
    first !== undefined &&
    first.id === candidate.id &&
    (first.threshold === 'all' || first.threshold === candidate.threshold)
  );
}

/**
 * The override entries an agent container may keep: an include or auto entry only when
 * the declared list permits it, and for an exclude the declared entries first and then
 * the override's extras, so first-match still reads the agent's own entries before them.
 * Applied to the effective value at every write, so a later change to the agent's labels
 * can never be cancelled by an override stored before it.
 */
export function composeAgentEnforcedRouting(
  field: AgentEnforcedRoutingField,
  declared: string | undefined,
  entries: readonly string[],
): string[] {
  if (field !== 'actionTriggerExclude') {
    return entries.filter((entry) => isEntryPermittedByDeclared(entry, declared));
  }
  const declaredEntries = splitAndTrimCommaSeparatedList(declared ?? '');
  const declaredKeys = new Set(toRoutingReferences(declaredEntries).map((entry) => entry.key));
  const extras = toRoutingReferences(entries)
    .filter((entry) => !declaredKeys.has(entry.key))
    .map((entry) => entry.text);
  return [...declaredEntries, ...extras];
}

const AGENT_ENFORCED_ROUTING_FIELDS: ReadonlySet<string> = new Set<AgentEnforcedRoutingField>([
  'actionTriggerInclude',
  'actionTriggerExclude',
  'actionTriggerAuto',
]);

export function isAgentEnforcedRoutingField(field: string): field is AgentEnforcedRoutingField {
  return AGENT_ENFORCED_ROUTING_FIELDS.has(field);
}

type AgentEnforcementResolver = (container: Pick<Container, 'agent' | 'watcher'>) => boolean;

/** Until the registry reports otherwise, any container with an agent is treated as enforced. */
const failClosedEnforcement: AgentEnforcementResolver = (container) => Boolean(container.agent);
let agentEnforcement: AgentEnforcementResolver = failClosedEnforcement;

/**
 * Wire in how the registry tells a traditional agent from a Portwing controller transport.
 * The registry owns the watcher state and this module is a leaf, so it is injected.
 */
export function setAgentEnforcementResolver(resolver: AgentEnforcementResolver | undefined): void {
  agentEnforcement = resolver ?? failClosedEnforcement;
}

/**
 * Whether a container's action admission is re-run by an agent against its own labels. A
 * controller-local container is not, and neither is a Portwing controller-transport
 * container, which executes on the controller. An agent whose watcher is not registered
 * right now is treated as enforcing: narrowing is always safe, widening is not.
 */
export function isAgentEnforcedWatcher(
  container: { agent?: string; watcher: string },
  watcherState: Record<string, unknown> | undefined,
): boolean {
  if (!container.agent) {
    return false;
  }
  const watcher = Object.values(watcherState ?? {}).find((candidate) => {
    const component = candidate as {
      agent?: unknown;
      name?: unknown;
    };
    return component.agent === container.agent && component.name === container.watcher;
  }) as { type?: unknown; configuration?: unknown } | undefined;
  return !(watcher && usesControllerDockerTransport(watcher.type, watcher.configuration));
}

/** The Container-field form of an override value. */
function overrideToFlat(
  spec: LabelOwnedFieldSpec,
  value: LabelOverrideValue,
  container: Container,
  state: LabelOwnedState,
): string | string[] | undefined {
  if (spec.kind === 'trigger-list') {
    const entries =
      isAgentEnforcedRoutingField(spec.field) && agentEnforcement(container)
        ? composeAgentEnforcedRouting(
            spec.field,
            state.declared[spec.field] as string | undefined,
            value as string[],
          )
        : (value as string[]);
    return entries.length === 0 ? undefined : entries.join(',');
  }
  return Array.isArray(value) ? [...value] : value;
}

/** Build the state for a declared layer under an optional set of overrides. */
export function buildLabelOwnedState(
  declared: LabelOwnedDeclared,
  declaredSources: LabelOwnedDeclaredSources,
  overrides: LabelOverrideFields | undefined,
): LabelOwnedState {
  return {
    v: 1,
    declared: structuredClone(declared),
    declaredSources,
    sources: Object.fromEntries(
      FIELD_NAMES.map((field) => [
        field,
        overrides?.[field] === undefined ? declaredSources[field] : 'override',
      ]),
    ) as LabelOwnedSources,
  };
}

/**
 * Write the effective value of every label-owned field onto `container`: the override when
 * there is one, else the declared value. Lists replace whole and never merge.
 */
export function applyLabelOwnedState(
  container: Container,
  state: LabelOwnedState,
  overrides: LabelOverrideFields | undefined,
): Container {
  const target = container as unknown as Record<string, unknown>;
  for (const spec of LABEL_OWNED_FIELDS as readonly LabelOwnedFieldSpec[]) {
    const override = overrides?.[spec.field];
    const effective =
      override === undefined
        ? structuredClone(state.declared[spec.field])
        : overrideToFlat(spec, override.value, container, state);
    // Display name and icon are required on a Container: a state that lacks one (only a
    // hand-built round trip can) keeps the value the record already shows.
    if (effective === undefined && (spec.kind === 'text' || spec.kind === 'icon')) {
      continue;
    }
    target[spec.field] = effective;
  }
  const declaredDependencySource = state.declaredSources.dependsOn;
  container.dependsOnSource =
    state.sources.dependsOn === 'override'
      ? 'override'
      : declaredDependencySource === 'label' || declaredDependencySource === 'compose'
        ? declaredDependencySource
        : undefined;
  container.labelOwned = state;
  return container;
}

/**
 * A record read from the store, with its label-owned fields shown as the owning watcher
 * declared them. Watcher paths that re-derive label fields on a stored record start from
 * this, so an override is never mistaken for a watcher-side change and a display-name
 * override cannot stop rename tracking. A record with no state is returned as is.
 */
export function toDeclaredProjection(container: Container): Container {
  const state = container.labelOwned;
  if (state === undefined) {
    return container;
  }
  const projected = { ...container } as Container;
  const target = projected as unknown as Record<string, unknown>;
  for (const field of FIELD_NAMES) {
    target[field] = structuredClone(state.declared[field]);
  }
  const source = state.declaredSources.dependsOn;
  projected.dependsOnSource = source === 'label' || source === 'compose' ? source : undefined;
  return projected;
}

/**
 * An agent reports what it declares, never what the controller overrides, so any state it
 * sends is ignored and a claimed `override` dependency source is not a source it can have.
 * Returns the payload itself when there is nothing to strip.
 */
export function stripAgentLabelOwnedState(container: Container): Container {
  if (container.labelOwned === undefined && container.dependsOnSource !== 'override') {
    return container;
  }
  const { labelOwned: _labelOwned, ...rest } = container;
  return (
    rest.dependsOnSource === 'override' ? { ...rest, dependsOnSource: undefined } : rest
  ) as Container;
}

/**
 * A container as an agent may be sent it: declared values only and no `labelOwned`, because
 * overrides live on the controller and never flow to agents. Returns the container itself
 * when it carries nothing to project.
 */
export function toAgentPayload(container: Container): Container {
  return stripAgentLabelOwnedState(toDeclaredProjection(container));
}

/**
 * How an admission message names where an action routing value came from: the Docker label,
 * or the Drydock override that replaced it ("by container label dd.action.exclude", "by the
 * Drydock override of dd.action.exclude").
 */
export function describeRoutingOrigin(
  container: Pick<Container, 'labelOwned'>,
  field: 'actionTriggerInclude' | 'actionTriggerExclude',
): string {
  const labelKey = field === 'actionTriggerInclude' ? ddActionInclude : ddActionExclude;
  return container.labelOwned?.sources[field] === 'override'
    ? `by the Drydock override of ${labelKey}`
    : `by container label ${labelKey}`;
}

/** The label-owned slice of a record, for change detection and write-backs. */
export function pickLabelOwnedFlat(container: Container): LabelOwnedFlat {
  const picked = Object.fromEntries(
    [...FIELD_NAMES, 'dependsOnSource' as const].map((field) => [field, container[field]]),
  );
  return picked as LabelOwnedFlat;
}

const STATE_SOURCES: readonly LabelOwnedSource[] = [
  'override',
  'label',
  'compose',
  'watcher',
  'default',
  'unset',
];

const DECLARED_SOURCES: readonly LabelOwnedSource[] = [
  'label',
  'compose',
  'watcher',
  'default',
  'unset',
];

export interface ParsedLabelOwnedState {
  /** Always well formed: a field that could not be read is unset in it. */
  state: LabelOwnedState;
  /** The fields whose declared value or source could not be read from the document. */
  unknown: LabelOwnedField[];
}

function isDeclaredValue(value: unknown): value is LabelOwnedDeclaredValue {
  return (
    typeof value === 'string' || (Array.isArray(value) && value.every((v) => typeof v === 'string'))
  );
}

/**
 * Read a stored state document tolerantly, never throwing. A field whose source or declared
 * value is missing or malformed reads as unset and is reported in `unknown`; a document that
 * is not an object, or carries a version this build does not know, has every field unknown.
 * The caller decides how to rebuild an unknown field: it must not guess the declared value
 * of a field an override is hiding.
 */
export function parseLabelOwnedState(raw: unknown): ParsedLabelOwnedState {
  const document =
    raw !== null && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : undefined;
  const readable =
    document?.v === 1 && document.declared !== null && typeof document.declared === 'object';
  const declaredDocument = readable ? (document.declared as Record<string, unknown>) : {};
  const sourceDocument =
    readable && document?.declaredSources !== null && typeof document?.declaredSources === 'object'
      ? (document.declaredSources as Record<string, unknown>)
      : {};
  const effectiveDocument =
    readable && document?.sources !== null && typeof document?.sources === 'object'
      ? (document.sources as Record<string, unknown>)
      : {};
  const declared: LabelOwnedDeclared = {};
  const unknown: LabelOwnedField[] = [];
  const declaredSources = {} as Record<LabelOwnedField, LabelOwnedDeclaredSource>;
  const sources = {} as Record<LabelOwnedField, LabelOwnedSource>;
  for (const field of FIELD_NAMES) {
    const source = sourceDocument[field] as LabelOwnedSource;
    const value = declaredDocument[field];
    const valueReadable = value === undefined || isDeclaredValue(value);
    const effective = effectiveDocument[field] as LabelOwnedSource;
    if (
      !DECLARED_SOURCES.includes(source) ||
      !STATE_SOURCES.includes(effective) ||
      !valueReadable
    ) {
      unknown.push(field);
      declaredSources[field] = 'unset';
      sources[field] = 'unset';
    } else {
      declaredSources[field] = source as LabelOwnedDeclaredSource;
      sources[field] = effective;
      if (value !== undefined) {
        declared[field] = value as LabelOwnedDeclaredValue;
      }
    }
  }
  return { state: { v: 1, declared, declaredSources, sources }, unknown };
}
