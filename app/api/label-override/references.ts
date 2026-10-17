/**
 * Checks that need live state (spec 7.5): the registered triggers, the container list and
 * the agent watchers. Each takes that state as an argument, so it is exercised with plain
 * data and the handler wires in the registry and the store.
 */
import { buildDependencyGraph, topologicalSort } from '../../dependencies/dependency-graph.js';
import type { Container } from '../../model/container.js';
import {
  getLabelOwnedFieldSpec,
  isEntryPermittedByDeclared,
  parseDeclaredRoutingEntries,
} from '../../model/label-owned.js';
import { doesReferenceMatchId } from '../../triggers/providers/trigger-reference-matching.js';
import { getTriggerCategoryForType } from '../../triggers/trigger-category.js';
import type { FieldError } from './validation.js';
import { normalizeRoutingEntry } from './validation.js';

export interface OverrideWarning {
  field: string;
  code: string;
  reference?: string;
}

export interface TriggerInfo {
  id: string;
  type: string;
  agent: string | undefined;
  auto: 'all' | 'oninclude' | 'onauto' | 'none';
}

interface ComponentLike {
  type?: unknown;
  agent?: unknown;
  name?: unknown;
  configuration?: Record<string, unknown>;
  getId?: () => string;
}

function normalizeAuto(auto: unknown): TriggerInfo['auto'] {
  if (auto === false) {
    return 'none';
  }
  if (auto === true || auto === undefined) {
    return 'all';
  }
  return String(auto).toLowerCase() as TriggerInfo['auto'];
}

/** The registered triggers as plain data: id, type, agent and the normalized `auto` mode. */
export function toTriggerInfos(state: Record<string, unknown> | undefined): TriggerInfo[] {
  return Object.entries(state ?? {}).map(([key, value]) => {
    const component = value as ComponentLike;
    return {
      id: typeof component.getId === 'function' ? component.getId() : key,
      type: String(component.type),
      agent: typeof component.agent === 'string' ? component.agent : undefined,
      auto: normalizeAuto(component.configuration?.auto),
    };
  });
}

/**
 * Every routing reference must match a registered trigger of the field's category: an
 * unknown reference and one that only matches the other category are both rejected. Action
 * references that only match another agent's triggers, and auto references no `onauto`
 * trigger would act on, are accepted with a warning.
 */
export function checkRoutingReferences(
  field: string,
  entries: string[],
  triggers: TriggerInfo[],
  container: { agent?: string },
): { errors: FieldError[]; warnings: OverrideWarning[] } {
  const category = getLabelOwnedFieldSpec(field)?.category;
  const unknown: string[] = [];
  const wrongCategory: string[] = [];
  const warnings: OverrideWarning[] = [];
  for (const entry of entries) {
    const reference = entry.split(':')[0];
    const matches = triggers.filter((candidate) => doesReferenceMatchId(reference, candidate.id));
    const sameCategory = matches.filter(
      (candidate) => getTriggerCategoryForType(candidate.type) === category,
    );
    if (sameCategory.length === 0) {
      (matches.length > 0 ? wrongCategory : unknown).push(entry);
      continue;
    }
    if (
      category === 'action' &&
      sameCategory.every((candidate) => (candidate.agent ?? '') !== (container.agent ?? ''))
    ) {
      warnings.push({ field, code: 'trigger-agent-mismatch', reference });
    }
    if (
      field === 'actionTriggerAuto' &&
      sameCategory.every((candidate) => candidate.auto !== 'onauto')
    ) {
      warnings.push({ field, code: 'auto-inert', reference });
    }
  }
  const errors: FieldError[] = [];
  if (unknown.length > 0) {
    errors.push({ field, code: 'unknown-trigger-reference', entries: unknown });
  }
  if (wrongCategory.length > 0) {
    errors.push({ field, code: 'wrong-trigger-category', entries: wrongCategory });
  }
  return { errors, warnings };
}

function widening(field: string, entries: string[]): FieldError | undefined {
  return entries.length === 0 ? undefined : { field, code: 'agent-enforced-widening', entries };
}

/**
 * Traditional agents re-run admission against their own labels, so an action routing
 * override there may only narrow what the labels allow. `declared` is the label value the
 * agent enforces, and matching is first-match, so order matters:
 * - An exclude must carry the declared entries as an exact prefix, because a wider entry
 *   placed ahead of a declared one would shadow it.
 * - An include or auto entry must name the first declared reference that can match the
 *   same trigger, with no wider threshold. With nothing declared, no entry qualifies, and
 *   an include must also keep every declared entry (under `AUTO=oninclude` an empty include
 *   includes nothing, so it narrows, but it is not a way to drop a declared restriction).
 * Resetting an override is always allowed and never reaches this check. The same rules are
 * applied again to the effective value at every write (`composeAgentEnforcedRouting`).
 */
export function checkAgentRestriction(
  field: string,
  entries: string[],
  declared: string | undefined,
): FieldError | undefined {
  const declaredEntries = parseDeclaredRoutingEntries(declared);
  const overrideEntries = entries.map(normalizeRoutingEntry);
  switch (field) {
    case 'actionTriggerExclude': {
      const missing = declaredEntries.filter((entry) => !overrideEntries.includes(entry));
      return widening(
        field,
        missing.length > 0
          ? missing
          : declaredEntries.filter((entry, index) => overrideEntries[index] !== entry),
      );
    }
    case 'actionTriggerInclude':
      if (overrideEntries.length === 0) {
        return widening(field, declaredEntries);
      }
      return widening(field, notPermitted(entries, declared));
    case 'actionTriggerAuto':
      return widening(field, notPermitted(entries, declared));
    default:
      return undefined;
  }
}

function notPermitted(entries: string[], declared: string | undefined): string[] {
  return entries
    .filter((entry) => !isEntryPermittedByDeclared(entry, declared))
    .map(normalizeRoutingEntry);
}

function cycleKey(cycle: string[]): string {
  return [...cycle].sort().join('\u0000');
}

/**
 * Check a candidate `dependsOn` list for a scope against the current containers. A name
 * that is any container of the scope is an error. Names no container answers to, or that
 * only a container on another agent answers to, are warnings, matching how labels tolerate
 * containers that are not discovered yet. A cycle that runs through the scope and did not
 * exist before the change is returned as `cycle` (container names); cycles that already
 * existed never block.
 */
export function evaluateDependencyOverride(
  names: string[],
  scopeIds: ReadonlySet<string>,
  containers: Container[],
): { errors: FieldError[]; warnings: OverrideWarning[]; cycle?: string[] } {
  const scopeNames = new Set(
    containers.filter((container) => scopeIds.has(container.id)).map((container) => container.name),
  );
  const self = names.filter((name) => scopeNames.has(name));
  if (self.length > 0) {
    return {
      errors: [{ field: 'dependsOn', code: 'depends-on-self', entries: self }],
      warnings: [],
    };
  }
  const candidate = containers.map((container) =>
    scopeIds.has(container.id)
      ? ({ ...container, dependsOn: names, dependsOnSource: 'override' } as Container)
      : container,
  );
  const before = buildDependencyGraph(containers);
  const after = buildDependencyGraph(candidate);
  const nameById = new Map(candidate.map((container) => [container.id, container.name]));
  const unresolved = new Set(
    after.unresolved.filter((edge) => scopeIds.has(edge.nodeId)).map((edge) => edge.missingTarget),
  );
  const crossHost = new Set(
    after.crossHostIgnored
      .filter((edge) => scopeIds.has(edge.from))
      .map((edge) => nameById.get(edge.to)),
  );
  const warnings: OverrideWarning[] = [];
  for (const name of names) {
    if (unresolved.has(name)) {
      warnings.push({ field: 'dependsOn', code: 'unresolved-dependency', reference: name });
    } else if (crossHost.has(name)) {
      warnings.push({ field: 'dependsOn', code: 'cross-host-dependency', reference: name });
    }
  }
  const existing = new Set(topologicalSort(before.nodes, before.edges).cycles.map(cycleKey));
  const created = topologicalSort(after.nodes, after.edges).cycles.find(
    (cycle) => cycle.some((id) => scopeIds.has(id)) && !existing.has(cycleKey(cycle)),
  );
  return {
    errors: [],
    warnings,
    ...(created === undefined
      ? {}
      : { cycle: created.map((id) => nameById.get(id) as string).sort() }),
  };
}
