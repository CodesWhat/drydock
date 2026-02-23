import express from 'express';
import joi from 'joi';
import nocache from 'nocache';
import {
  getNotificationTriggerIdsFromState,
  normalizeNotificationTriggerIds,
} from '../notifications/trigger-policy.js';
import * as registry from '../registry/index.js';
import * as notificationStore from '../store/notification.js';

const router = express.Router();

const notificationRuleUpdateSchema = joi
  .object({
    enabled: joi.boolean(),
    triggers: joi.array().items(joi.string().trim().min(1)).unique(),
  })
  .min(1);

function getAllowedNotificationTriggerIds(): Set<string> {
  return getNotificationTriggerIdsFromState(registry.getState().trigger || {});
}

function sanitizeRuleForResponse(rule, allowedTriggerIds: Set<string>) {
  if (!rule) {
    return rule;
  }
  return {
    ...rule,
    triggers: normalizeNotificationTriggerIds(rule.triggers, allowedTriggerIds),
  };
}

/**
 * Get all notification rules.
 */
function getNotificationRules(req, res) {
  const allowedTriggerIds = getAllowedNotificationTriggerIds();
  const rules = notificationStore
    .getNotificationRules()
    .map((rule) => sanitizeRuleForResponse(rule, allowedTriggerIds));
  res.status(200).json(rules);
}

/**
 * Get one notification rule.
 */
function getNotificationRule(req, res) {
  const { id } = req.params;
  const allowedTriggerIds = getAllowedNotificationTriggerIds();
  const rule = notificationStore.getNotificationRule(id);
  if (!rule) {
    res.sendStatus(404);
    return;
  }
  res.status(200).json(sanitizeRuleForResponse(rule, allowedTriggerIds));
}

/**
 * Update one notification rule.
 */
function updateNotificationRule(req, res) {
  const { id } = req.params;
  const notificationRuleToUpdate = notificationRuleUpdateSchema.validate(req.body || {}, {
    stripUnknown: true,
  });
  if (notificationRuleToUpdate.error) {
    res.status(400).json({
      error: notificationRuleToUpdate.error.message,
    });
    return;
  }

  try {
    const allowedTriggerIds = getAllowedNotificationTriggerIds();
    const triggersRequested = notificationRuleToUpdate.value.triggers;
    if (Array.isArray(triggersRequested)) {
      const triggersNormalized = normalizeNotificationTriggerIds(triggersRequested, allowedTriggerIds);
      if (triggersNormalized.length !== triggersRequested.length) {
        const invalidTriggers = triggersRequested.filter(
          (triggerId) => !allowedTriggerIds.has(triggerId),
        );
        res.status(400).json({
          error: `Unsupported notification triggers: ${invalidTriggers.join(', ')}`,
        });
        return;
      }
      notificationRuleToUpdate.value.triggers = triggersNormalized;
    }

    const notificationRuleUpdated = notificationStore.updateNotificationRule(
      id,
      notificationRuleToUpdate.value,
    );
    if (!notificationRuleUpdated) {
      res.sendStatus(404);
      return;
    }

    res.status(200).json(sanitizeRuleForResponse(notificationRuleUpdated, allowedTriggerIds));
  } catch (e: any) {
    res.status(400).json({
      error: e.message,
    });
  }
}

/**
 * Init router.
 */
export function init() {
  router.use(nocache());
  router.get('/', getNotificationRules);
  router.get('/:id', getNotificationRule);
  router.patch('/:id', updateNotificationRule);
  router.put('/:id', updateNotificationRule);
  return router;
}
