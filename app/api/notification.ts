import express from 'express';
import joi from 'joi';
import nocache from 'nocache';
import {
  getNotificationTriggerIdsFromState,
  normalizeNotificationTriggerIds,
  resolveNotificationTriggerIds,
} from '../notifications/trigger-policy.js';
import * as registry from '../registry/index.js';
import * as notificationStore from '../store/notification.js';
import { sendErrorResponse } from './error-response.js';
import { sanitizeApiError } from './helpers.js';

const router = express.Router();

const notificationTemplateSchema = joi.object({
  simpleTitle: joi.string().allow('').max(10_000),
  simpleBody: joi.string().allow('').max(50_000),
  batchTitle: joi.string().allow('').max(10_000),
});

const notificationTemplateOverridesSchema = joi
  .object()
  .pattern(/^[a-zA-Z0-9_.:-]+$/, notificationTemplateSchema.min(1));

const notificationRuleUpdateSchema = joi
  .object({
    enabled: joi.boolean(),
    triggers: joi.array().items(joi.string().trim().min(1)).unique(),
    bellEnabled: joi.boolean(),
    bellThreshold: joi.string().valid(...notificationStore.NOTIFICATION_BELL_THRESHOLDS),
    templates: notificationTemplateOverridesSchema,
  })
  .min(1);

const notificationTemplatePreviewSchema = joi.object({
  triggerId: joi.string().trim().min(1).required(),
  templates: notificationTemplateSchema.default({}),
});

function getAllowedNotificationTriggerIds(): Set<string> {
  return getNotificationTriggerIdsFromState(registry.getState().trigger || {});
}

function normalizeTemplateOverrides(templates, allowedTriggerIds: Set<string>) {
  return Object.fromEntries(
    Object.entries(templates || {}).flatMap(([triggerId, template]) =>
      resolveNotificationTriggerIds(triggerId, allowedTriggerIds).map((resolvedId) => [
        resolvedId,
        template,
      ]),
    ),
  );
}

function sanitizeRuleForResponse(rule, allowedTriggerIds: Set<string>) {
  if (!rule) {
    return rule;
  }
  return {
    ...rule,
    triggers: normalizeNotificationTriggerIds(rule.triggers, allowedTriggerIds),
    templates: normalizeTemplateOverrides(rule.templates, allowedTriggerIds),
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
  res.status(200).json({
    data: rules,
    total: rules.length,
  });
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
    sendErrorResponse(res, 400, sanitizeApiError(notificationRuleToUpdate.error));
    return;
  }

  try {
    const allowedTriggerIds = getAllowedNotificationTriggerIds();
    const triggersRequested = notificationRuleToUpdate.value.triggers;
    if (Array.isArray(triggersRequested)) {
      const invalidTriggers = triggersRequested.filter(
        (triggerId) => resolveNotificationTriggerIds(triggerId, allowedTriggerIds).length === 0,
      );
      if (invalidTriggers.length > 0) {
        sendErrorResponse(
          res,
          400,
          `Unsupported notification triggers: ${invalidTriggers.join(', ')}`,
        );
        return;
      }

      const triggersNormalized = normalizeNotificationTriggerIds(
        triggersRequested,
        allowedTriggerIds,
      );
      notificationRuleToUpdate.value.triggers = triggersNormalized;
    }

    const templatesRequested = notificationRuleToUpdate.value.templates;
    if (templatesRequested) {
      const invalidTriggers = Object.keys(templatesRequested).filter(
        (triggerId) => resolveNotificationTriggerIds(triggerId, allowedTriggerIds).length === 0,
      );
      if (invalidTriggers.length > 0) {
        sendErrorResponse(
          res,
          400,
          `Unsupported notification triggers: ${invalidTriggers.join(', ')}`,
        );
        return;
      }
      notificationRuleToUpdate.value.templates = normalizeTemplateOverrides(
        templatesRequested,
        allowedTriggerIds,
      );
    }

    const notificationRuleUpdated = notificationStore.updateNotificationRule(
      id,
      notificationRuleToUpdate.value,
    );
    if (!notificationRuleUpdated) {
      sendErrorResponse(res, 404, 'Notification rule not found');
      return;
    }

    res.status(200).json(sanitizeRuleForResponse(notificationRuleUpdated, allowedTriggerIds));
  } catch (e: unknown) {
    sendErrorResponse(res, 500, sanitizeApiError(e));
  }
}

function previewNotificationTemplates(req, res) {
  const previewRequest = notificationTemplatePreviewSchema.validate(req.body || {}, {
    stripUnknown: true,
  });
  if (previewRequest.error) {
    sendErrorResponse(res, 400, sanitizeApiError(previewRequest.error));
    return;
  }

  try {
    const ruleId = req.params.id?.toLowerCase();
    if (!notificationStore.getNotificationRule(ruleId)) {
      sendErrorResponse(res, 404, 'Notification rule not found');
      return;
    }
    const { triggerId, templates } = previewRequest.value;
    const triggerIds = resolveNotificationTriggerIds(triggerId, getAllowedNotificationTriggerIds());
    if (triggerIds.length !== 1) {
      sendErrorResponse(res, 400, `Unsupported notification trigger: ${triggerId}`);
      return;
    }
    const trigger = registry.getState().trigger[triggerIds[0]];
    if (!trigger || typeof trigger.previewNotificationTemplates !== 'function') {
      sendErrorResponse(res, 400, `Notification trigger cannot render previews: ${triggerId}`);
      return;
    }
    res.status(200).json(trigger.previewNotificationTemplates(ruleId, templates));
  } catch (e: unknown) {
    sendErrorResponse(res, 500, sanitizeApiError(e));
  }
}

/**
 * Init router.
 */
export function init() {
  router.use(nocache());
  router.get('/', getNotificationRules);
  router.patch('/:id', updateNotificationRule);
  router.post('/:id/preview', previewNotificationTemplates);
  return router;
}
