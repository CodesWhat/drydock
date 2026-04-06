/**
 * Notification rules store.
 */
import joi from 'joi';
import { byString } from 'sort-es';
import { uniqStrings } from '../util/string-array.js';
import { initCollection } from './util.js';

type NotificationCollectionDocument = NotificationRule;

interface NotificationCollection {
  find(query?: Record<string, unknown>): NotificationCollectionDocument[];
  findOne(query: { id: string }): NotificationCollectionDocument | null;
  insert(document: NotificationCollectionDocument): void;
  remove(document: NotificationCollectionDocument): void;
}

interface NotificationStoreDb {
  getCollection(name: string): NotificationCollection | null;
  addCollection(name: string): NotificationCollection;
}

let notifications: NotificationCollection | undefined;
let notificationRulesCache: NotificationRule[] | null = null;

interface NotificationRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  triggers: string[];
}

export interface NotificationRuleDispatchOptions {
  allowAllWhenNoTriggers?: boolean;
  defaultWhenRuleMissing?: boolean;
}

export type NotificationRuleDispatchReason =
  | 'invalid-input'
  | 'missing-rule'
  | 'default-when-rule-missing'
  | 'rule-disabled'
  | 'allow-all-when-empty'
  | 'empty-trigger-list'
  | 'matched-allow-list'
  | 'excluded-from-allow-list';

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
    description: 'When a container has a new version',
  },
  {
    id: 'update-applied',
    name: 'Update Applied',
    enabled: true,
    triggers: [],
    description: 'After a container is successfully updated',
  },
  {
    id: 'update-failed',
    name: 'Update Failed',
    enabled: true,
    triggers: [],
    description: 'When an update fails or is rolled back',
  },
  {
    id: 'security-alert',
    name: 'Security Alert',
    enabled: true,
    triggers: [],
    description: 'Critical/High vulnerability detected',
  },
  {
    id: 'agent-disconnect',
    name: 'Agent Disconnected',
    enabled: false,
    triggers: [],
    description: 'When a remote agent loses connection',
  },
  {
    id: 'agent-reconnect',
    name: 'Agent Reconnected',
    enabled: false,
    triggers: [],
    description: 'When a remote agent reconnects after losing connection',
  },
];

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

function normalizeRules(rulesToNormalize: unknown): NotificationRule[] {
  const rulesById = new Map<string, Partial<NotificationRule>>();
  const rules = Array.isArray(rulesToNormalize) ? rulesToNormalize : [];

  rules.forEach((rule) => {
    if (rule && typeof rule === 'object' && 'id' in rule && typeof rule.id === 'string') {
      rulesById.set(rule.id.toLowerCase(), rule as Partial<NotificationRule>);
    }
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
  }));
}

function invalidateNotificationRulesCache() {
  notificationRulesCache = null;
}

function hasNotificationCollection() {
  return Boolean(notifications);
}

function replaceRules(rulesToSave: NotificationRule[]) {
  notifications.find().forEach((rule) => notifications.remove(rule));
  rulesToSave.forEach((rule) => notifications.insert(rule));
  invalidateNotificationRulesCache();
}

/**
 * Create notification collection.
 * @param db
 */
export function createCollections(db: NotificationStoreDb): void {
  notifications = initCollection(db, 'notifications') as NotificationCollection;
  const rulesSaved = notifications.find();
  const rulesNormalized = normalizeRules(rulesSaved);
  replaceRules(rulesNormalized);
  notificationRulesCache = rulesNormalized;
}

/**
 * Get all notification rules.
 */
export function getNotificationRules(): NotificationRule[] {
  if (notificationRulesCache) {
    return cloneRules(notificationRulesCache);
  }

  const rulesNormalized = hasNotificationCollection()
    ? normalizeRules(notifications.find())
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

/**
 * Update one notification rule by id.
 */
export function updateNotificationRule(
  id: string,
  update: Partial<NotificationRule>,
): NotificationRule | undefined {
  if (!hasNotificationCollection()) {
    return undefined;
  }
  const idNormalized = id?.toLowerCase();
  const ruleCurrent = notifications.findOne({ id: idNormalized });
  if (!ruleCurrent) {
    return undefined;
  }

  const ruleUpdated = normalizeRule({
    ...ruleCurrent,
    ...update,
    id: idNormalized,
  });

  notifications.remove(ruleCurrent);
  notifications.insert(ruleUpdated);
  invalidateNotificationRulesCache();

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

  const matched = rule.triggers.some(
    (configuredTriggerId) => configuredTriggerId.toLowerCase() === triggerIdNormalized,
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
