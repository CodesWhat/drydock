import { LABEL_OWNED_FIELDS } from '../../model/label-owned.js';

const FIELD_NAMES = LABEL_OWNED_FIELDS.map((spec) => spec.field);
const SOURCES = ['override', 'label', 'compose', 'watcher', 'default', 'unset'] as const;

const fieldValue = {
  type: ['string', 'array', 'null'],
  items: { type: 'string' },
  description:
    'Text for display name, icon and dependency action; a list of strings for dependencies and routing (an empty list is an explicit none); null when there is no value.',
} as const;

const fieldsOf = (schema: Record<string, unknown>) => ({
  type: 'object',
  properties: Object.fromEntries(FIELD_NAMES.map((field) => [field, schema])),
  required: [...FIELD_NAMES],
  additionalProperties: false,
});

const scopeProperties = {
  kind: { type: 'string', enum: ['container', 'compose-service'] },
  agent: { type: ['string', 'null'] },
  watcher: { type: 'string' },
  name: {
    type: 'string',
    description: 'The container name, or project/service for a Compose service.',
  },
} as const;

const invalidStoredOverride = {
  type: 'array',
  description: 'Stored fields that could not be read. They are ignored until the next write.',
  items: {
    type: 'object',
    properties: { field: { type: 'string' }, reason: { type: 'string' } },
    required: ['field', 'reason'],
    additionalProperties: false,
  },
} as const;

const snapshotProperties = {
  containerId: { type: 'string' },
  scope: {
    type: 'object',
    properties: {
      ...scopeProperties,
      appliesTo: {
        type: 'array',
        items: {
          type: 'object',
          properties: { id: { type: 'string' }, name: { type: 'string' } },
          required: ['id', 'name'],
          additionalProperties: false,
        },
      },
    },
    required: ['kind', 'agent', 'watcher', 'name', 'appliesTo'],
    additionalProperties: false,
  },
  overrideId: { type: ['string', 'null'] },
  revision: {
    type: 'integer',
    minimum: 0,
    description: '0 when the scope has no stored override yet.',
  },
  readOnlyReason: { type: ['string', 'null'], enum: ['rollback-container', null] },
  agentEnforcedActionRouting: {
    type: 'boolean',
    description:
      'True when a traditional agent re-runs action admission against its own labels, so action routing overrides can only narrow.',
  },
  fields: fieldsOf({ $ref: '#/components/schemas/LabelOverrideField' }),
  warnings: { type: 'array', items: { $ref: '#/components/schemas/LabelOverrideWarning' } },
  invalidStoredOverride,
} as const;

const snapshotRequired = [
  'containerId',
  'scope',
  'overrideId',
  'revision',
  'readOnlyReason',
  'agentEnforcedActionRouting',
  'fields',
  'warnings',
] as const;

export const labelOverrideSchemas = {
  LabelOwnedSources: {
    ...fieldsOf({ type: 'string', enum: [...SOURCES] }),
    description:
      'Where each label-owned field effective value comes from: a Drydock override, a Docker label, Compose, watcher configuration, a default, or not set.',
  },
  LabelOverrideStoredField: {
    type: 'object',
    properties: {
      value: { ...fieldValue, type: ['string', 'array'] },
      updatedAt: { type: 'string', format: 'date-time' },
      updatedBy: {
        type: 'string',
        description: 'user:<name> or api-key:<keyId>. Never a credential.',
      },
    },
    required: ['value', 'updatedAt', 'updatedBy'],
    additionalProperties: false,
  },
  LabelOverrideWarning: {
    type: 'object',
    properties: {
      field: { type: 'string' },
      code: {
        type: 'string',
        enum: [
          'unresolved-dependency',
          'cross-host-dependency',
          'trigger-agent-mismatch',
          'auto-inert',
          'stale-trigger-reference',
        ],
      },
      reference: { type: 'string' },
    },
    required: ['field', 'code'],
    additionalProperties: false,
  },
  LabelOverrideField: {
    type: 'object',
    properties: {
      labelKey: { type: 'string' },
      label: { type: ['string', 'null'], description: 'The raw Docker label value, if any.' },
      declared: {
        type: 'object',
        properties: {
          value: fieldValue,
          source: { type: 'string', enum: SOURCES.filter((source) => source !== 'override') },
        },
        required: ['value', 'source'],
        additionalProperties: false,
      },
      override: {
        oneOf: [{ $ref: '#/components/schemas/LabelOverrideStoredField' }, { type: 'null' }],
      },
      effective: {
        type: 'object',
        properties: { value: fieldValue, source: { type: 'string', enum: [...SOURCES] } },
        required: ['value', 'source'],
        additionalProperties: false,
      },
    },
    required: ['labelKey', 'label', 'declared', 'override', 'effective'],
    additionalProperties: false,
  },
  LabelOverrideSnapshot: {
    type: 'object',
    properties: snapshotProperties,
    required: [...snapshotRequired],
    additionalProperties: false,
  },
  LabelOverridePatchRequest: {
    type: 'object',
    properties: {
      revision: { type: 'integer', minimum: 0 },
      overrideId: {
        type: 'string',
        description:
          'The `overrideId` the caller last read. Required when `revision` is above 0: a row deleted and saved again restarts at revision 1, so the id is what tells a stale row from a new one.',
      },
      changes: {
        type: 'array',
        minItems: 1,
        maxItems: 9,
        items: {
          type: 'object',
          properties: {
            field: { type: 'string', enum: FIELD_NAMES },
            op: { type: 'string', enum: ['set', 'remove'] },
            value: { ...fieldValue, type: ['string', 'array'] },
          },
          required: ['field', 'op'],
          additionalProperties: false,
        },
      },
    },
    required: ['revision', 'changes'],
    additionalProperties: false,
  },
  LabelOverrideChangeResult: {
    type: 'object',
    properties: {
      ...snapshotProperties,
      changed: { type: 'array', items: { type: 'string', enum: FIELD_NAMES } },
    },
    required: [...snapshotRequired, 'changed'],
    additionalProperties: false,
  },
  LabelOverrideRow: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      scope: {
        type: 'object',
        properties: scopeProperties,
        required: ['kind', 'agent', 'watcher', 'name'],
        additionalProperties: false,
      },
      revision: { type: 'integer', minimum: 1 },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
      fields: {
        type: 'object',
        properties: Object.fromEntries(
          FIELD_NAMES.map((field) => [
            field,
            { $ref: '#/components/schemas/LabelOverrideStoredField' },
          ]),
        ),
        additionalProperties: false,
      },
      matchedContainerIds: {
        type: 'array',
        description: 'Containers the override currently applies to. Empty for an orphan.',
        items: { type: 'string' },
      },
      invalidStoredOverride,
    },
    required: [
      'id',
      'scope',
      'revision',
      'createdAt',
      'updatedAt',
      'fields',
      'matchedContainerIds',
    ],
    additionalProperties: false,
  },
  LabelOverrideList: {
    type: 'object',
    properties: {
      data: { type: 'array', items: { $ref: '#/components/schemas/LabelOverrideRow' } },
      total: { type: 'integer', minimum: 0 },
    },
    required: ['data', 'total'],
    additionalProperties: false,
  },
  LabelOverrideRowDeleted: {
    type: 'object',
    properties: {
      deleted: { $ref: '#/components/schemas/LabelOverrideRow' },
      refreshed: {
        type: 'integer',
        minimum: 0,
        description: 'How many stored containers were rewritten.',
      },
    },
    required: ['deleted', 'refreshed'],
    additionalProperties: false,
  },
  LabelOverrideInvalidRequest: {
    type: 'object',
    properties: {
      error: { type: 'string' },
      errors: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            field: { type: 'string' },
            code: { type: 'string' },
            entries: { type: 'array', items: { type: 'string' } },
          },
          required: ['field', 'code'],
          additionalProperties: false,
        },
      },
    },
    required: ['error', 'errors'],
    additionalProperties: false,
  },
  LabelOverrideConflict: {
    type: 'object',
    description:
      'A stale revision (with the current snapshot or row) or a read-only rollback container.',
    properties: {
      error: { type: 'string' },
      snapshot: { $ref: '#/components/schemas/LabelOverrideSnapshot' },
      current: { $ref: '#/components/schemas/LabelOverrideRow' },
      readOnlyReason: { type: 'string', enum: ['rollback-container'] },
    },
    required: ['error'],
    additionalProperties: false,
  },
  LabelOverrideCycle: {
    type: 'object',
    properties: {
      error: { type: 'string' },
      cycle: { type: 'array', items: { type: 'string' }, description: 'Container names.' },
    },
    required: ['error', 'cycle'],
    additionalProperties: false,
  },
} as const;
