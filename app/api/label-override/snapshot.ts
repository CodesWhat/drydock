/**
 * The JSON the label override endpoints speak (spec 7.5): the editor snapshot, the list
 * rows and the audit details. Built from plain data, so nothing here reads a store.
 */
import type { Container } from '../../model/container.js';
import {
  buildLabelOwnedState,
  captureDeclaredFromFlat,
  composeAgentEnforcedRouting,
  inferDeclaredSources,
  isAgentEnforcedRoutingField,
  LABEL_OWNED_FIELDS,
  type LabelOverrideEntry,
  type LabelOverrideFields,
  type LabelOverrideValue,
  type LabelOwnedField,
  type LabelOwnedFieldSpec,
  type LabelOwnedState,
} from '../../model/label-owned.js';
import type { LabelOverrideRecord, LabelOverrideScope } from '../../store/label-override.js';
import {
  doesReferenceMatchId,
  splitAndTrimCommaSeparatedList,
} from '../../triggers/providers/trigger-reference-matching.js';
import { getTriggerCategoryForType } from '../../triggers/trigger-category.js';
import type { OverrideWarning, TriggerInfo } from './references.js';

const AUDIT_VALUE_MAX_LENGTH = 256;

type SnapshotValue = string | string[] | null;

/** What the owning watcher reported and what the container shows: lists are always arrays. */
function toSnapshotValue(spec: LabelOwnedFieldSpec, value: unknown): SnapshotValue {
  if (value === undefined) {
    return null;
  }
  return spec.kind === 'trigger-list' && typeof value === 'string'
    ? splitAndTrimCommaSeparatedList(value)
    : (value as SnapshotValue);
}

/**
 * The container's label-owned state, or what it would be: a record the store has not
 * written yet has pristine flat values, so its declared layer is exactly those.
 */
export function resolveLabelOwnedState(
  container: Container,
  overrides: LabelOverrideFields | undefined,
): LabelOwnedState {
  if (container.labelOwned !== undefined) {
    return container.labelOwned;
  }
  const declared = captureDeclaredFromFlat(container);
  return buildLabelOwnedState(
    declared,
    inferDeclaredSources(declared, container, container.dependsOnSource),
    overrides,
  );
}

interface ScopeMember {
  id: string;
  name: string;
}

interface SnapshotInput {
  container: Container;
  scope: LabelOverrideScope;
  record: LabelOverrideRecord | undefined;
  members: ScopeMember[];
  agentEnforcedActionRouting: boolean;
  triggers: TriggerInfo[];
  readOnlyReason: 'rollback-container' | null;
}

function staleTriggerWarnings(
  spec: LabelOwnedFieldSpec,
  entry: LabelOverrideEntry | undefined,
  triggers: TriggerInfo[],
): OverrideWarning[] {
  if (spec.kind !== 'trigger-list' || entry === undefined) {
    return [];
  }
  return (entry.value as string[])
    .map((item) => item.split(':')[0])
    .filter(
      (reference) =>
        !triggers.some(
          (trigger) =>
            getTriggerCategoryForType(trigger.type) === spec.category &&
            doesReferenceMatchId(reference, trigger.id),
        ),
    )
    .map((reference) => ({ field: spec.field, code: 'stale-trigger-reference', reference }));
}

/**
 * The value an override leaves in effect. On a container whose agent re-runs admission it
 * is the override composed with the agent's labels, the same value the store writes onto
 * the container, so the editor never shows an entry the agent would refuse.
 */
function effectiveValue(
  spec: LabelOwnedFieldSpec,
  state: LabelOwnedState,
  override: LabelOverrideEntry | undefined,
  agentEnforced: boolean,
): SnapshotValue | undefined {
  if (override === undefined) {
    return undefined;
  }
  return agentEnforced && isAgentEnforcedRoutingField(spec.field)
    ? composeAgentEnforcedRouting(
        spec.field,
        state.declared[spec.field] as string | undefined,
        override.value as string[],
      )
    : override.value;
}

/** The editor GET: every field with its declared, overridden and effective value. */
export function buildSnapshot(input: SnapshotInput) {
  const { container, scope, record, members, triggers } = input;
  const state = resolveLabelOwnedState(container, record?.fields);
  const warnings: OverrideWarning[] = [];
  const fields = Object.fromEntries(
    (LABEL_OWNED_FIELDS as readonly LabelOwnedFieldSpec[]).map((spec) => {
      const override = record?.fields[spec.field];
      const declared = toSnapshotValue(spec, state.declared[spec.field]);
      warnings.push(...staleTriggerWarnings(spec, override, triggers));
      return [
        spec.field,
        {
          labelKey: spec.labelKey,
          label: container.labels?.[spec.labelKey] ?? null,
          declared: { value: declared, source: state.declaredSources[spec.field] },
          override:
            override === undefined
              ? null
              : {
                  value: override.value,
                  updatedAt: override.updatedAt,
                  updatedBy: override.updatedBy,
                },
          effective: {
            value:
              effectiveValue(spec, state, override, input.agentEnforcedActionRouting) ?? declared,
            source: override === undefined ? state.declaredSources[spec.field] : 'override',
          },
        },
      ];
    }),
  );
  return {
    containerId: container.id,
    scope: {
      kind: scope.kind,
      agent: scope.agent === '' ? null : scope.agent,
      watcher: scope.watcher,
      name: scope.name,
      appliesTo: members,
    },
    overrideId: record?.id ?? null,
    revision: record?.revision ?? 0,
    readOnlyReason: input.readOnlyReason,
    agentEnforcedActionRouting: input.agentEnforcedActionRouting,
    fields,
    warnings,
    ...(record !== undefined && record.invalid.length > 0
      ? { invalidStoredOverride: record.invalid }
      : {}),
  };
}

/** One row of the top-level list: the stored override with the containers it matches. */
export function buildRow(record: LabelOverrideRecord, matchedContainerIds: string[]) {
  return {
    id: record.id,
    scope: {
      kind: record.scopeKind,
      agent: record.agent === '' ? null : record.agent,
      watcher: record.watcher,
      name: record.scopeName,
    },
    revision: record.revision,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    fields: Object.fromEntries(
      Object.entries(record.fields).map(([field, entry]) => [
        field,
        { value: entry.value, updatedAt: entry.updatedAt, updatedBy: entry.updatedBy },
      ]),
    ),
    matchedContainerIds,
    ...(record.invalid.length > 0 ? { invalidStoredOverride: record.invalid } : {}),
  };
}

function toAuditValue(value: LabelOverrideValue | string | string[] | null): string | null {
  if (value === null) {
    return null;
  }
  const text = Array.isArray(value) ? value.join(',') : value;
  return text.slice(0, AUDIT_VALUE_MAX_LENGTH);
}

type AuditOperation = 'patch' | 'reset-all' | 'delete-row';

interface AuditDetailsInput {
  operation: AuditOperation;
  scope: Pick<LabelOverrideScope, 'kind' | 'agent' | 'watcher' | 'name'>;
  fields: LabelOwnedField[];
  before: LabelOverrideFields;
  after: LabelOverrideFields;
  /** The container state the rows were applied to, when there is one. */
  container: Container | undefined;
  state: LabelOwnedState | undefined;
}

/**
 * The audit details JSON: per field the label value, the declared value, the override
 * before and after, and the source that is effective afterwards. Each value is cut to 256
 * characters, and none of them is a secret.
 */
export function buildAuditDetails(input: AuditDetailsInput): string {
  const { container, state } = input;
  return JSON.stringify({
    operation: input.operation,
    scope: {
      kind: input.scope.kind,
      agent: input.scope.agent === '' ? null : input.scope.agent,
      watcher: input.scope.watcher,
      name: input.scope.name,
    },
    fields: Object.fromEntries(
      input.fields.map((field) => {
        const spec = (LABEL_OWNED_FIELDS as readonly LabelOwnedFieldSpec[]).find(
          (candidate) => candidate.field === field,
        ) as LabelOwnedFieldSpec;
        const before = input.before[field];
        const after = input.after[field];
        return [
          field,
          {
            label: toAuditValue(container?.labels?.[spec.labelKey] ?? null),
            declared: toAuditValue(toSnapshotValue(spec, state?.declared[field])),
            before: toAuditValue(before?.value ?? null),
            after: toAuditValue(after?.value ?? null),
            effectiveSource:
              after === undefined ? (state?.declaredSources[field] ?? null) : 'override',
          },
        ];
      }),
    ),
  });
}
