/**
 * Notification rules store.
 */
import joi from 'joi';
import { byString } from 'sort-es';
import { initCollection } from './util.js';

let notifications;

export interface NotificationRule {
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

function uniqStrings(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  ).sort(byString());
}

function normalizeRule(ruleToValidate: Partial<NotificationRule>): NotificationRule {
  const ruleValidated = notificationRuleSchema.validate(
    {
      ...ruleToValidate,
      id: ruleToValidate.id?.toLowerCase(),
      triggers: uniqStrings(ruleToValidate.triggers),
    },
    {
      stripUnknown: true,
    },
  );
  if (ruleValidated.error) {
    throw ruleValidated.error;
  }
  return ruleValidated.value;
}

function normalizeRules(rulesToNormalize: unknown): NotificationRule[] {
  const rulesById = new Map<string, Partial<NotificationRule>>();
  const rules = Array.isArray(rulesToNormalize) ? rulesToNormalize : [];

  rules.forEach((rule: any) => {
    if (rule && typeof rule === 'object' && typeof rule.id === 'string') {
      rulesById.set(rule.id.toLowerCase(), rule);
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

function hasNotificationCollection() {
  return notifications && typeof notifications.find === 'function';
}

function findDefaultRule(id: string): NotificationRule | undefined {
  return DEFAULT_NOTIFICATION_RULES.find((rule) => rule.id === id);
}

function replaceRules(rulesToSave: NotificationRule[]) {
  notifications.find().forEach((rule) => notifications.remove(rule));
  rulesToSave.forEach((rule) => notifications.insert(rule));
}

/**
 * Create notification collection.
 * @param db
 */
export function createCollections(db) {
  notifications = initCollection(db, 'notifications');
  const rulesSaved = notifications.find();
  const rulesNormalized = normalizeRules(rulesSaved);
  replaceRules(rulesNormalized);
}

/**
 * Get all notification rules.
 */
export function getNotificationRules(): NotificationRule[] {
  if (!hasNotificationCollection()) {
    return normalizeRules(DEFAULT_NOTIFICATION_RULES);
  }
  return normalizeRules(notifications.find());
}

/**
 * Get one notification rule by id.
 */
export function getNotificationRule(id: string): NotificationRule | undefined {
  const idNormalized = id?.toLowerCase();
  if (!idNormalized) {
    return undefined;
  }
  if (!hasNotificationCollection()) {
    const defaultRule = findDefaultRule(idNormalized);
    return defaultRule ? normalizeRule(defaultRule) : undefined;
  }
  const rule = notifications.findOne({ id: idNormalized });
  if (!rule) {
    const defaultRule = findDefaultRule(idNormalized);
    return defaultRule ? normalizeRule(defaultRule) : undefined;
  }
  return normalizeRule(rule);
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

  return ruleUpdated;
}

/**
 * Return true when a trigger should execute for a given notification rule.
 */
export function isTriggerEnabledForRule(
  ruleId: string,
  triggerId: string,
  options: NotificationRuleDispatchOptions = {},
): boolean {
  const ruleIdNormalized = ruleId?.toLowerCase();
  const triggerIdNormalized = triggerId?.toLowerCase();
  if (!ruleIdNormalized || !triggerIdNormalized) {
    return false;
  }

  const { allowAllWhenNoTriggers = false, defaultWhenRuleMissing = false } = options;
  const rule = getNotificationRule(ruleIdNormalized);
  if (!rule) {
    return defaultWhenRuleMissing;
  }

  if (!rule.enabled) {
    return false;
  }

  if (rule.triggers.length === 0) {
    return allowAllWhenNoTriggers;
  }

  return rule.triggers.some(
    (configuredTriggerId) => configuredTriggerId.toLowerCase() === triggerIdNormalized,
  );
}
