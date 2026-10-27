import { HttpResponse, http } from 'msw';
import type {
  LabelOverrideFieldState,
  LabelOverrideSnapshot,
  LabelOverrideValue,
} from '@/services/label-override';
import type { LabelOwnedField } from '@/types/container';
import { containers } from '../data/containers';
import { dependencyEdges } from '../data/dependencies';
import { errorResponse } from './errors';
import { readJsonRecord } from './json';

const LABEL_KEYS: Record<LabelOwnedField, string> = {
  displayName: 'dd.display.name',
  displayIcon: 'dd.display.icon',
  dependsOn: 'dd.depends_on',
  dependsOnAction: 'dd.depends_on.action',
  notificationTriggerInclude: 'dd.notification.include',
  notificationTriggerExclude: 'dd.notification.exclude',
  actionTriggerInclude: 'dd.action.include',
  actionTriggerExclude: 'dd.action.exclude',
  actionTriggerAuto: 'dd.action.auto',
};
const FIELDS = Object.keys(LABEL_KEYS) as LabelOwnedField[];
const ARRAY_FIELDS = new Set<LabelOwnedField>([
  'dependsOn',
  'notificationTriggerInclude',
  'notificationTriggerExclude',
  'actionTriggerInclude',
  'actionTriggerExclude',
]);

interface StoredOverride {
  revision: number;
  values: Map<LabelOwnedField, { value: LabelOverrideValue; updatedAt: string }>;
}

const overrides = new Map<string, StoredOverride>();

function overrideIdFor(containerId: string): string {
  return `demo-lo-${containerId}`;
}

function declaredFor(container: (typeof containers)[number], field: LabelOwnedField) {
  if (field === 'dependsOn') {
    const edges = dependencyEdges.filter((edge) => edge.from === container.name);
    if (edges.length > 0) {
      return {
        value: edges.map((edge) => edge.to),
        source: edges[0].source === 'compose' ? ('compose' as const) : ('label' as const),
      };
    }
  }
  const raw = (container.labels as Record<string, string>)[LABEL_KEYS[field]];
  return raw === undefined
    ? { value: null, source: 'unset' as const }
    : { value: raw, source: 'label' as const };
}

function snapshotFor(container: (typeof containers)[number]): LabelOverrideSnapshot {
  const stored = overrides.get(container.id);
  const fields = {} as Record<LabelOwnedField, LabelOverrideFieldState>;
  for (const field of FIELDS) {
    const declared = declaredFor(container, field);
    const override = stored?.values.get(field);
    const raw = (container.labels as Record<string, string>)[LABEL_KEYS[field]];
    fields[field] = {
      labelKey: LABEL_KEYS[field],
      label: raw ?? null,
      declared,
      override: override
        ? { value: override.value, updatedAt: override.updatedAt, updatedBy: 'demo' }
        : null,
      effective: override
        ? { value: override.value, source: 'override' }
        : { value: declared.value, source: declared.source },
    };
  }
  return {
    containerId: container.id,
    scope: {
      kind: 'container',
      agent: null,
      watcher: container.watcher,
      name: container.name,
      appliesTo: [{ id: container.id, name: container.name }],
    },
    overrideId: stored && stored.revision > 0 ? overrideIdFor(container.id) : null,
    revision: stored?.revision ?? 0,
    readOnlyReason: null,
    agentEnforcedActionRouting: false,
    fields,
    warnings: [],
  };
}

function isValidValue(field: LabelOwnedField, value: unknown): value is LabelOverrideValue {
  if (ARRAY_FIELDS.has(field)) {
    return (
      Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry !== '')
    );
  }
  return typeof value === 'string' && value !== '';
}

function staleResponse(container: (typeof containers)[number]) {
  return errorResponse(409, 'Label overrides changed since they were read', {
    snapshot: snapshotFor(container),
  });
}

export const labelOverrideHandlers = [
  http.get('/api/v1/containers/:id/label-overrides', ({ params }) => {
    const container = containers.find((c) => c.id === params.id);
    if (!container) return errorResponse(404, 'Container not found');
    return HttpResponse.json(snapshotFor(container));
  }),

  http.patch('/api/v1/containers/:id/label-overrides', async ({ params, request }) => {
    const container = containers.find((c) => c.id === params.id);
    if (!container) return errorResponse(404, 'Container not found');
    const body = await readJsonRecord(request);
    if (!body) return errorResponse(400, 'Request body must be a JSON object');
    const { revision, changes } = body;
    if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 0) {
      return errorResponse(400, 'Invalid revision; expected a non-negative integer');
    }
    if (!Array.isArray(changes) || changes.length === 0) {
      return errorResponse(400, 'Invalid changes; expected a non-empty array');
    }
    const errors: Array<{ field: string; code: string }> = [];
    const parsed: Array<
      | { field: LabelOwnedField; op: 'remove' }
      | { field: LabelOwnedField; op: 'set'; value: LabelOverrideValue }
    > = [];
    for (const change of changes as Array<Record<string, unknown>>) {
      const field = String(change?.field);
      if (!FIELDS.includes(field as LabelOwnedField)) {
        errors.push({ field, code: 'unknown-field' });
      } else if (change.op === 'remove') {
        parsed.push({ field: field as LabelOwnedField, op: 'remove' });
      } else if (change.op === 'set' && isValidValue(field as LabelOwnedField, change.value)) {
        parsed.push({ field: field as LabelOwnedField, op: 'set', value: change.value });
      } else {
        errors.push({ field, code: 'invalid-value' });
      }
    }
    if (errors.length > 0) return errorResponse(400, 'Invalid label override changes', { errors });

    const current = overrides.get(container.id) ?? { revision: 0, values: new Map() };
    if (revision !== current.revision) return staleResponse(container);

    const changed = new Set<LabelOwnedField>();
    const now = new Date().toISOString();
    for (const change of parsed) {
      if (change.op === 'set') {
        current.values.set(change.field, { value: change.value, updatedAt: now });
        changed.add(change.field);
      } else if (current.values.delete(change.field)) {
        changed.add(change.field);
      }
    }
    if (changed.size > 0) current.revision += 1;
    overrides.set(container.id, current);
    return HttpResponse.json({ ...snapshotFor(container), changed: [...changed] });
  }),

  http.delete('/api/v1/containers/:id/label-overrides', ({ params, request }) => {
    const container = containers.find((c) => c.id === params.id);
    if (!container) return errorResponse(404, 'Container not found');
    const revision = Number(new URL(request.url).searchParams.get('revision'));
    if (!Number.isInteger(revision) || revision < 0) {
      return errorResponse(400, 'Invalid revision; expected a non-negative integer');
    }
    const current = overrides.get(container.id);
    if (revision !== (current?.revision ?? 0)) return staleResponse(container);
    const changed = current ? [...current.values.keys()] : [];
    overrides.delete(container.id);
    return HttpResponse.json({ ...snapshotFor(container), changed });
  }),
];
