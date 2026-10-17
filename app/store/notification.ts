/**
 * Notification rules store.
 *
 * Backed by three tables (roadmap 7-STORE, slice 6): `notification_rules`
 * holds the scalar fields, `notification_rule_trigger` holds the `triggers:
 * string[]` allow-list (one row per trigger, `ordinal` preserving array
 * order), and `notification_rule_template` holds the `templates` map (one
 * row per `(triggerId, field)` pair). Both join tables are read as whole sets
 * on every access and rewritten wholesale, exactly as the LokiJS-era
 * `triggers`/`templates` arrays were, so the join tables cost nothing extra
 * here and make "which rules reference trigger X" a query instead of a scan.
 *
 * `normalizeRules`'s defaults-merge is unchanged: it is pure and operates on
 * plain `NotificationRule` objects regardless of where they came from.
 */
import joi from 'joi';
import { byString } from 'sort-es';
import { doesNotificationTriggerReferenceMatchId } from '../notifications/trigger-policy.js';
import { uniqStrings } from '../util/string-array.js';
import type { Database, Row } from './db/driver.js';

let db: Database | undefined;
let notificationRulesCache: NotificationRule[] | null = null;

export const NOTIFICATION_BELL_THRESHOLDS = ['all', 'major', 'minor', 'patch'] as const;
type NotificationBellThreshold = (typeof NOTIFICATION_BELL_THRESHOLDS)[number];

export interface NotificationTemplateOverride {
  simpleTitle?: string;
  simpleBody?: string;
  batchTitle?: string;
}

export type NotificationTemplateField = keyof NotificationTemplateOverride;
type NotificationTemplateOverrides = Record<string, NotificationTemplateOverride>;

export interface NotificationRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  triggers: string[];
  bellEnabled: boolean;
  bellThreshold: NotificationBellThreshold;
  templates: NotificationTemplateOverrides;
}

export interface NotificationRuleDispatchOptions {
  allowAllWhenNoTriggers?: boolean;
  defaultWhenRuleMissing?: boolean;
}

type NotificationRuleDispatchReason =
  | 'invalid-input'
  | 'missing-rule'
  | 'default-when-rule-missing'
  | 'rule-disabled'
  | 'allow-all-when-empty'
  | 'empty-trigger-list'
  | 'matched-allow-list'
  | 'excluded-from-allow-list'
  | 'action-trigger-exempt-from-allow-list';

export interface NotificationRuleDispatchDecision {
  enabled: boolean;
  reason: NotificationRuleDispatchReason;
}

export const DEFAULT_NOTIFICATION_RULES: NotificationRule[] = [
  {
    id: 'update-available',
    name: 'Update Available',
    enabled: true,
    triggers: [],
    bellEnabled: true,
    bellThreshold: 'all',
    templates: {},
    description: 'When a container has a new version',
  },
  {
    id: 'update-applied',
    name: 'Update Applied',
    enabled: true,
    triggers: [],
    bellEnabled: true,
    bellThreshold: 'all',
    templates: {},
    description: 'After a container is successfully updated',
  },
  {
    id: 'update-failed',
    name: 'Update Failed',
    enabled: true,
    triggers: [],
    bellEnabled: true,
    bellThreshold: 'all',
    templates: {},
    description: 'When an update fails or is rolled back',
  },
  {
    id: 'security-alert',
    name: 'Security Alert',
    enabled: true,
    triggers: [],
    bellEnabled: true,
    bellThreshold: 'all',
    templates: {},
    description: 'Critical/High vulnerability detected',
  },
  {
    id: 'agent-disconnect',
    name: 'Agent Disconnected',
    enabled: false,
    triggers: [],
    bellEnabled: true,
    bellThreshold: 'all',
    templates: {},
    description: 'When a remote agent loses connection',
  },
  {
    id: 'agent-reconnect',
    name: 'Agent Reconnected',
    enabled: false,
    triggers: [],
    bellEnabled: false,
    bellThreshold: 'all',
    templates: {},
    description: 'When a remote agent reconnects after losing connection',
  },
  {
    id: 'container-unhealthy',
    name: 'Container Unhealthy',
    enabled: false,
    triggers: [],
    bellEnabled: false,
    bellThreshold: 'all',
    templates: {},
    description: "When a container's Docker health check enters the unhealthy state",
  },
  {
    id: 'maturity-cleared',
    name: 'Maturity Gate Cleared',
    enabled: true,
    triggers: [],
    bellEnabled: true,
    bellThreshold: 'all',
    templates: {},
    description: 'When an update held back by the maturity policy becomes applicable',
  },
  {
    id: 'update-pending-approval',
    name: 'Update Pending Approval',
    enabled: false,
    triggers: [],
    bellEnabled: false,
    bellThreshold: 'all',
    templates: {},
    description: 'When a manual-mode update enters the approval queue',
  },
];

const notificationTemplateOverrideSchema = joi
  .object({
    simpleTitle: joi.string().allow('').max(10_000),
    simpleBody: joi.string().allow('').max(50_000),
    batchTitle: joi.string().allow('').max(10_000),
  })
  .min(1);

const notificationRuleSchema = joi.object({
  id: joi
    .string()
    .trim()
    .min(1)
    .pattern(/^[a-z0-9-]+$/)
    .required(),
  name: joi.string().trim().min(1).required(),
  description: joi.string().allow('').default(''),
  enabled: joi.boolean().default(true),
  triggers: joi.array().items(joi.string().trim().min(1)).default([]),
  bellEnabled: joi.boolean().default(false),
  bellThreshold: joi
    .string()
    .valid(...NOTIFICATION_BELL_THRESHOLDS)
    .default('all'),
  templates: joi
    .object()
    .pattern(/^[a-zA-Z0-9_.:-]+$/, notificationTemplateOverrideSchema)
    .default({}),
});

function normalizeRule(ruleToValidate: Partial<NotificationRule>): NotificationRule {
  const ruleValidated = notificationRuleSchema.validate(
    {
      ...ruleToValidate,
      id: ruleToValidate.id?.toLowerCase(),
      triggers: uniqStrings(ruleToValidate.triggers, {
        trim: true,
        removeEmpty: true,
        sortComparator: byString(),
      }),
    },
    {
      stripUnknown: true,
    },
  );
  if (ruleValidated.error) {
    throw ruleValidated.error;
  }
  return ruleValidated.value as NotificationRule;
}

// Every caller passes an already-typed NotificationRule[] (readStoredRules() or
// DEFAULT_NOTIFICATION_RULES), both SQLite- or catalog-shaped and never malformed,
// so this no longer needs to defend against a non-array or a malformed entry the
// way it did when it normalized whatever JSON a LokiJS document happened to hold.
function normalizeRules(rulesToNormalize: NotificationRule[]): NotificationRule[] {
  const rulesById = new Map<string, Partial<NotificationRule>>();

  rulesToNormalize.forEach((rule) => {
    rulesById.set(rule.id.toLowerCase(), rule);
  });

  const rulesNormalized: NotificationRule[] = [];

  DEFAULT_NOTIFICATION_RULES.forEach((defaultRule) => {
    const existingRule = rulesById.get(defaultRule.id);
    rulesById.delete(defaultRule.id);
    rulesNormalized.push(
      normalizeRule({
        ...defaultRule,
        enabled: existingRule?.enabled ?? defaultRule.enabled,
        triggers: existingRule?.triggers ?? defaultRule.triggers,
        bellEnabled: existingRule?.bellEnabled ?? defaultRule.bellEnabled,
        bellThreshold: existingRule?.bellThreshold ?? defaultRule.bellThreshold,
        templates: existingRule?.templates ?? defaultRule.templates,
      }),
    );
  });

  const customRules = Array.from(rulesById.values())
    .map((rule) => normalizeRule(rule))
    .sort((ruleA, ruleB) => ruleA.id.localeCompare(ruleB.id));

  return [...rulesNormalized, ...customRules];
}

function cloneRules(rules: NotificationRule[]): NotificationRule[] {
  return rules.map((rule) => ({
    ...rule,
    triggers: [...rule.triggers],
    templates: Object.fromEntries(
      Object.entries(rule.templates).map(([triggerId, templates]) => [triggerId, { ...templates }]),
    ),
  }));
}

function invalidateNotificationRulesCache() {
  notificationRulesCache = null;
}

/** Every rule row, with its trigger allow-list and template overrides joined in. */
function readStoredRules(database: Database): NotificationRule[] {
  const ruleRows = database.prepare('SELECT * FROM notification_rules').all();
  if (ruleRows.length === 0) {
    return [];
  }

  const triggersByRule = new Map<string, string[]>();
  for (const row of database
    .prepare('SELECT rule_id, trigger_id FROM notification_rule_trigger ORDER BY rule_id, ordinal')
    .all()) {
    const ruleId = String(row.rule_id);
    const existing = triggersByRule.get(ruleId);
    if (existing) {
      existing.push(String(row.trigger_id));
    } else {
      triggersByRule.set(ruleId, [String(row.trigger_id)]);
    }
  }

  const templatesByRule = new Map<string, NotificationTemplateOverrides>();
  for (const row of database
    .prepare('SELECT rule_id, trigger_id, field, value FROM notification_rule_template')
    .all()) {
    const ruleId = String(row.rule_id);
    const templates = templatesByRule.get(ruleId) ?? {};
    const triggerId = String(row.trigger_id);
    const fieldOverrides = templates[triggerId] ?? {};
    fieldOverrides[String(row.field) as NotificationTemplateField] = String(row.value);
    templates[triggerId] = fieldOverrides;
    templatesByRule.set(ruleId, templates);
  }

  return ruleRows.map((row: Row) => {
    const id = String(row.id);
    return {
      id,
      name: String(row.name),
      description: String(row.description),
      enabled: Boolean(row.enabled),
      triggers: triggersByRule.get(id) ?? [],
      bellEnabled: Boolean(row.bell_enabled),
      bellThreshold: row.bell_threshold as NotificationBellThreshold,
      templates: templatesByRule.get(id) ?? {},
    };
  });
}

/** One rule row plus its joined triggers and templates, or `undefined` when no such row exists. */
function readStoredRule(database: Database, id: string): NotificationRule | undefined {
  const row = database.prepare('SELECT * FROM notification_rules WHERE id = ?').get(id);
  if (!row) {
    return undefined;
  }
  const triggers = database
    .prepare('SELECT trigger_id FROM notification_rule_trigger WHERE rule_id = ? ORDER BY ordinal')
    .all(id)
    .map((triggerRow) => String(triggerRow.trigger_id));
  const templates: NotificationTemplateOverrides = {};
  for (const templateRow of database
    .prepare('SELECT trigger_id, field, value FROM notification_rule_template WHERE rule_id = ?')
    .all(id)) {
    const triggerId = String(templateRow.trigger_id);
    const fieldOverrides = templates[triggerId] ?? {};
    fieldOverrides[String(templateRow.field) as NotificationTemplateField] = String(
      templateRow.value,
    );
    templates[triggerId] = fieldOverrides;
  }
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description),
    enabled: Boolean(row.enabled),
    triggers,
    bellEnabled: Boolean(row.bell_enabled),
    bellThreshold: row.bell_threshold as NotificationBellThreshold,
    templates,
  };
}

/** Write one rule's row plus its trigger and template join rows. Caller owns the transaction. */
function insertRule(database: Database, rule: NotificationRule): void {
  database
    .prepare(
      `INSERT INTO notification_rules (id, name, description, enabled, bell_enabled, bell_threshold)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      rule.id,
      rule.name,
      rule.description,
      rule.enabled ? 1 : 0,
      rule.bellEnabled ? 1 : 0,
      rule.bellThreshold,
    );

  const insertTrigger = database.prepare(
    'INSERT INTO notification_rule_trigger (rule_id, trigger_id, ordinal) VALUES (?, ?, ?)',
  );
  rule.triggers.forEach((triggerId, ordinal) => {
    insertTrigger.run(rule.id, triggerId, ordinal);
  });

  const insertTemplateField = database.prepare(
    'INSERT INTO notification_rule_template (rule_id, trigger_id, field, value) VALUES (?, ?, ?, ?)',
  );
  for (const [triggerId, fields] of Object.entries(rule.templates)) {
    for (const [field, value] of Object.entries(fields)) {
      insertTemplateField.run(rule.id, triggerId, field, value);
    }
  }
}

/**
 * Replace the whole rule set: delete every row and reinsert. `ON DELETE
 * CASCADE` on both join tables' foreign keys means deleting the parent row is
 * enough to clear its triggers and templates.
 */
function replaceRules(database: Database, rulesToSave: NotificationRule[]): void {
  database.transaction(() => {
    database.prepare('DELETE FROM notification_rules').run();
    rulesToSave.forEach((rule) => insertRule(database, rule));
  });
  invalidateNotificationRulesCache();
}

/**
 * Replace a single rule's row and join rows in place. Used by
 * `updateNotificationRule`, which only ever changes one rule at a time.
 */
function writeRule(database: Database, rule: NotificationRule): void {
  database.transaction(() => {
    database.prepare('DELETE FROM notification_rules WHERE id = ?').run(rule.id);
    insertRule(database, rule);
  });
  invalidateNotificationRulesCache();
}

/**
 * Wire the notification store to the shared SQLite database, normalizing
 * whatever rules are already there (filling in defaults, dropping unknown
 * fields, sorting custom rules) and persisting the result back.
 * @param database
 */
export function createCollections(database: Database): void {
  db = database;
  const rulesSaved = readStoredRules(database);
  const rulesNormalized = normalizeRules(rulesSaved);
  replaceRules(database, rulesNormalized);
  notificationRulesCache = rulesNormalized;
}

/**
 * Get all notification rules.
 */
export function getNotificationRules(): NotificationRule[] {
  if (notificationRulesCache) {
    return cloneRules(notificationRulesCache);
  }

  const rulesNormalized = db
    ? normalizeRules(readStoredRules(db))
    : normalizeRules(DEFAULT_NOTIFICATION_RULES);
  notificationRulesCache = rulesNormalized;
  return cloneRules(rulesNormalized);
}

/**
 * Get one notification rule by id.
 */
export function getNotificationRule(id: string): NotificationRule | undefined {
  const idNormalized = id?.toLowerCase();
  if (!idNormalized) {
    return undefined;
  }
  return getNotificationRules().find((rule) => rule.id === idNormalized);
}

export function getNotificationTemplate(
  ruleId: string,
  triggerId: string,
  field: NotificationTemplateField,
): string | undefined {
  return getNotificationRule(ruleId)?.templates[triggerId]?.[field];
}

/**
 * Update one notification rule by id.
 */
export function updateNotificationRule(
  id: string,
  update: Partial<NotificationRule>,
): NotificationRule | undefined {
  if (!db) {
    return undefined;
  }
  const database = db;
  const idNormalized = id?.toLowerCase();
  const ruleCurrent = readStoredRule(database, idNormalized);
  if (!ruleCurrent) {
    return undefined;
  }

  const ruleUpdated = normalizeRule({
    ...ruleCurrent,
    ...update,
    id: idNormalized,
  });

  writeRule(database, ruleUpdated);

  return ruleUpdated;
}

/**
 * Explain whether a trigger should execute for a given notification rule.
 */
export function getTriggerDispatchDecisionForRule(
  ruleId: string,
  triggerId: string,
  options: NotificationRuleDispatchOptions = {},
): NotificationRuleDispatchDecision {
  const ruleIdNormalized = ruleId?.toLowerCase();
  const triggerIdNormalized = triggerId?.toLowerCase();
  if (!ruleIdNormalized || !triggerIdNormalized) {
    return {
      enabled: false,
      reason: 'invalid-input',
    };
  }

  const { allowAllWhenNoTriggers = false, defaultWhenRuleMissing = false } = options;
  const rule = getNotificationRule(ruleIdNormalized);
  if (!rule) {
    return {
      enabled: defaultWhenRuleMissing,
      reason: defaultWhenRuleMissing ? 'default-when-rule-missing' : 'missing-rule',
    };
  }

  if (!rule.enabled) {
    return {
      enabled: false,
      reason: 'rule-disabled',
    };
  }

  if (rule.triggers.length === 0) {
    return {
      enabled: allowAllWhenNoTriggers,
      reason: allowAllWhenNoTriggers ? 'allow-all-when-empty' : 'empty-trigger-list',
    };
  }

  const matched = rule.triggers.some((configuredTriggerId) =>
    doesNotificationTriggerReferenceMatchId(configuredTriggerId, triggerIdNormalized),
  );
  return {
    enabled: matched,
    reason: matched ? 'matched-allow-list' : 'excluded-from-allow-list',
  };
}

/**
 * Return true when a trigger should execute for a given notification rule.
 */
export function isTriggerEnabledForRule(
  ruleId: string,
  triggerId: string,
  options: NotificationRuleDispatchOptions = {},
): boolean {
  return getTriggerDispatchDecisionForRule(ruleId, triggerId, options).enabled;
}
