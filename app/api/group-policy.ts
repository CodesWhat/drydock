/**
 * Group policy API (spec 7.3): persistent, Drydock-owned policies keyed by the exact
 * server-derived group name. Reads are `read` scoped. Writes are `admin`, like notification
 * rules, because one write changes every current and future member of a group.
 *
 * A policy write and its audit row commit in one transaction, so a saved change is never
 * reported as failed and an unaudited change is never saved. Member containers are
 * re-resolved right after the commit, through the container store's own write path.
 */
import express, { type Request, type Response } from 'express';
import joi from 'joi';
import nocache from 'nocache';
import logger from '../log/index.js';
import { sanitizeLogParam } from '../log/sanitize.js';
import type { Container } from '../model/container.js';
import { getContainerGroup } from '../model/container-group.js';
import {
  type GroupPolicy,
  type GroupPolicyBody,
  GroupPolicyValidationError,
  isValidGroupPolicyName,
  normalizeGroupPolicyBody,
} from '../model/group-policy.js';
import { DECLARATIVE_UPDATE_POLICY_FIELDS } from '../model/update-policy.js';
import * as registry from '../registry/index.js';
import * as storeContainer from '../store/container.js';
import * as groupPolicyStore from '../store/group-policy.js';
import { doesReferenceMatchId } from '../triggers/providers/trigger-reference-matching.js';
import { getTriggerCategoryForType } from '../triggers/trigger-category.js';
import { recordAuditEvent } from './audit-events.js';
import { sendErrorResponse } from './error-response.js';
import { sanitizeApiError } from './helpers.js';
import { toTriggerInfos } from './label-override/references.js';
import { scoped } from './route-scopes.js';

const log = logger.child({ component: 'api.group-policy' });

const NOT_FOUND_MESSAGE = 'Group policy not found';
const STALE_REVISION_MESSAGE =
  'Group policy was changed by someone else. Reload it and apply the change again';
const GROUP_IMMUTABLE_MESSAGE =
  'The group of a policy cannot change. Delete the policy and create one for the new group';
const NO_MEMBERS_WARNING =
  'No current containers are in this group. The policy applies to future members.';
const RE_RESOLVE_FAILED_WARNING =
  'The policy was saved, but updating current members failed. They pick it up on their next write or at restart.';

/**
 * `updatePolicy` and `actions` are validated by the model, which owns their rules. The
 * request schema only fixes the envelope, so an unknown top-level field fails like any other.
 */
const createSchema = joi
  .object({
    group: joi.string().required(),
    updatePolicy: joi.any(),
    actions: joi.any(),
  })
  .required();

const replaceSchema = joi
  .object({
    group: joi.string(),
    revision: joi.number().integer().min(1).required(),
    updatePolicy: joi.any(),
    actions: joi.any(),
  })
  .required();

const deleteQuerySchema = joi.object({
  revision: joi.number().integer().min(1).required(),
});

type AuditOperation = 'created' | 'replaced' | 'deleted';

interface Members {
  count: number;
  /** Agent names, with `null` for the controller. */
  agents: (string | null)[];
}

function getPrincipalName(req: Request): string {
  const principal = req.principal;
  return principal?.kind === 'api-key'
    ? `api-key:${principal.keyId}`
    : `user:${principal?.username ?? 'unknown'}`;
}

type MembersByGroup = Map<string, { count: number; agents: Set<string | null> }>;

function collectMembers(containers: Container[]): MembersByGroup {
  const byGroup: MembersByGroup = new Map();
  for (const container of containers) {
    const group = getContainerGroup(container);
    if (group === null) {
      continue;
    }
    const entry = byGroup.get(group) ?? { count: 0, agents: new Set() };
    entry.count += 1;
    entry.agents.add(container.agent ?? null);
    byGroup.set(group, entry);
  }
  return byGroup;
}

function membersOf(collected: MembersByGroup, group: string): Members {
  const entry = collected.get(group);
  const named = [...(entry?.agents ?? [])]
    .filter((agent): agent is string => agent !== null)
    .sort();
  return {
    count: entry?.count ?? 0,
    agents: entry?.agents.has(null) ? [null, ...named] : named,
  };
}

function withMembers(policy: GroupPolicy, collected: MembersByGroup) {
  return { ...policy, members: membersOf(collected, policy.group) };
}

const ACTION_FIELDS = ['updateMode', 'exclude'] as const;

/**
 * The fields whose value differs between two policy bodies, as before and after. Action
 * rules are keyed `actions.<field>` so they never collide with an update-policy field.
 */
function diffFields(before: GroupPolicyBody, after: GroupPolicyBody) {
  const fields: Record<string, { before: unknown; after: unknown }> = {};
  const compare = (name: string, beforeValue: unknown = null, afterValue: unknown = null) => {
    if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
      fields[name] = { before: beforeValue, after: afterValue };
    }
  };
  for (const field of DECLARATIVE_UPDATE_POLICY_FIELDS) {
    compare(field, before.updatePolicy[field], after.updatePolicy[field]);
  }
  for (const field of ACTION_FIELDS) {
    compare(`actions.${field}`, before.actions[field], after.actions[field]);
  }
  return fields;
}

function isSameBody(policy: GroupPolicy, body: GroupPolicyBody): boolean {
  return JSON.stringify(diffFields(policy, body)) === '{}';
}

/**
 * Exclusion entries that match no registered action trigger. They are accepted, because an
 * agent's triggers may be offline or register later, but the operator is told.
 */
function unmatchedExcludeWarnings(actions: GroupPolicyBody['actions']): string[] {
  const actionTriggers = toTriggerInfos(registry.getState().trigger).filter(
    (candidate) => getTriggerCategoryForType(candidate.type) === 'action',
  );
  return (actions.exclude ?? [])
    .filter((entry) => {
      const reference = entry.split(':')[0].trim();
      return !actionTriggers.some((candidate) => doesReferenceMatchId(reference, candidate.id));
    })
    .map(
      (entry) =>
        `No registered action trigger matches '${entry}'. The rule is kept for triggers that register later or run on an agent.`,
    );
}

/** Write the audit row for a policy change. Runs inside the policy transaction. */
function auditPolicyChange({
  operation,
  policy,
  before,
  after,
  principal,
  members,
}: {
  operation: AuditOperation;
  policy: GroupPolicy;
  before: GroupPolicyBody;
  after: GroupPolicyBody;
  principal: string;
  members: number;
}) {
  recordAuditEvent({
    action: operation === 'deleted' ? 'group-policy-cleared' : 'group-policy-set',
    status: 'success',
    containerName: policy.group,
    details: JSON.stringify({
      policyId: policy.id,
      group: policy.group,
      operation,
      revision: policy.revision,
      by: principal,
      fields: diffFields(before, after),
      members,
    }),
  });
}

/**
 * Re-resolve the group's members after the policy change committed. A failure here does not
 * undo the saved policy: startup reconciliation and the members' next write heal it, so it
 * is reported as a warning.
 */
function applyToMembers(group: string): { applied: { members: number }; warnings: string[] } {
  try {
    return {
      applied: { members: storeContainer.reResolveGroupPolicyMembers(group) },
      warnings: [],
    };
  } catch (error: unknown) {
    log.error(
      `Re-resolving members of group ${sanitizeLogParam(group)} failed (${sanitizeLogParam(String(error), 500)})`,
    );
    return { applied: { members: 0 }, warnings: [RE_RESOLVE_FAILED_WARNING] };
  }
}

function sendValidationError(res: Response, error: unknown) {
  sendErrorResponse(
    res,
    400,
    error instanceof GroupPolicyValidationError ? error.message : sanitizeApiError(error),
  );
}

function listGroupPolicies(_req: Request, res: Response) {
  try {
    const collected = collectMembers(storeContainer.getContainers());
    const data = groupPolicyStore
      .getGroupPolicies()
      .map((policy) => withMembers(policy, collected));
    res.status(200).json({ data, total: data.length });
  } catch (error: unknown) {
    sendErrorResponse(res, 500, sanitizeApiError(error));
  }
}

function getGroupPolicy(req: Request, res: Response) {
  try {
    const policy = groupPolicyStore.getGroupPolicyById(String(req.params.id));
    if (!policy) {
      sendErrorResponse(res, 404, NOT_FOUND_MESSAGE);
      return;
    }
    res.status(200).json(withMembers(policy, collectMembers(storeContainer.getContainers())));
  } catch (error: unknown) {
    sendErrorResponse(res, 500, sanitizeApiError(error));
  }
}

function createGroupPolicy(req: Request, res: Response) {
  const request = createSchema.validate(req.body, { convert: false });
  if (request.error) {
    sendValidationError(res, request.error);
    return;
  }
  const { group, updatePolicy, actions } = request.value as {
    group: string;
    updatePolicy?: unknown;
    actions?: unknown;
  };
  try {
    if (!isValidGroupPolicyName(group)) {
      throw new GroupPolicyValidationError('A group name must be a non-empty string');
    }
    const body = normalizeGroupPolicyBody({ updatePolicy, actions });
    if (groupPolicyStore.getGroupPolicyForGroup(group)) {
      sendErrorResponse(res, 409, `A policy for group '${group}' already exists`);
      return;
    }
    const principal = getPrincipalName(req);
    const memberCount = membersOf(collectMembers(storeContainer.getContainers()), group).count;
    const policy = groupPolicyStore.transaction(() => {
      const created = groupPolicyStore.insertGroupPolicy(group, body, principal);
      auditPolicyChange({
        operation: 'created',
        policy: created,
        before: { updatePolicy: {}, actions: {} },
        after: created,
        principal,
        members: memberCount,
      });
      return created;
    });
    const { applied, warnings } = applyToMembers(group);
    warnings.push(...unmatchedExcludeWarnings(body.actions));
    if (memberCount === 0) {
      warnings.push(NO_MEMBERS_WARNING);
    }
    res.status(201).json({ policy, applied, warnings });
  } catch (error: unknown) {
    if (error instanceof GroupPolicyValidationError) {
      sendValidationError(res, error);
      return;
    }
    sendErrorResponse(res, 500, sanitizeApiError(error));
  }
}

function replaceGroupPolicy(req: Request, res: Response) {
  const request = replaceSchema.validate(req.body, { convert: false });
  if (request.error) {
    sendValidationError(res, request.error);
    return;
  }
  const {
    group,
    revision,
    updatePolicy: requestedUpdatePolicy,
    actions: requestedActions,
  } = request.value as {
    group?: string;
    revision: number;
    updatePolicy?: unknown;
    actions?: unknown;
  };
  try {
    const existing = groupPolicyStore.getGroupPolicyById(String(req.params.id));
    if (!existing) {
      sendErrorResponse(res, 404, NOT_FOUND_MESSAGE);
      return;
    }
    if (group !== undefined && group !== existing.group) {
      sendErrorResponse(res, 400, GROUP_IMMUTABLE_MESSAGE);
      return;
    }
    const body = normalizeGroupPolicyBody({
      updatePolicy: requestedUpdatePolicy,
      actions: requestedActions,
    });
    if (existing.revision === revision && isSameBody(existing, body)) {
      res.status(200).json({
        changed: false,
        policy: existing,
        applied: { members: 0 },
        warnings: [],
      });
      return;
    }
    const principal = getPrincipalName(req);
    const memberCount = membersOf(
      collectMembers(storeContainer.getContainers()),
      existing.group,
    ).count;
    const policy = groupPolicyStore.transaction(() => {
      const replaced = groupPolicyStore.replaceGroupPolicy(existing.id, revision, body, principal);
      if (replaced) {
        auditPolicyChange({
          operation: 'replaced',
          policy: replaced,
          before: existing,
          after: replaced,
          principal,
          members: memberCount,
        });
      }
      return replaced;
    });
    if (!policy) {
      sendErrorResponse(res, 409, STALE_REVISION_MESSAGE);
      return;
    }
    const { applied, warnings } = applyToMembers(policy.group);
    warnings.push(...unmatchedExcludeWarnings(body.actions));
    if (memberCount === 0) {
      warnings.push(NO_MEMBERS_WARNING);
    }
    res.status(200).json({ changed: true, policy, applied, warnings });
  } catch (error: unknown) {
    if (error instanceof GroupPolicyValidationError) {
      sendValidationError(res, error);
      return;
    }
    sendErrorResponse(res, 500, sanitizeApiError(error));
  }
}

function deleteGroupPolicy(req: Request, res: Response) {
  const query = deleteQuerySchema.validate(req.query);
  if (query.error) {
    sendValidationError(res, query.error);
    return;
  }
  const { revision } = query.value as { revision: number };
  try {
    const existing = groupPolicyStore.getGroupPolicyById(String(req.params.id));
    if (!existing) {
      sendErrorResponse(res, 404, NOT_FOUND_MESSAGE);
      return;
    }
    const principal = getPrincipalName(req);
    const memberCount = membersOf(
      collectMembers(storeContainer.getContainers()),
      existing.group,
    ).count;
    const deleted = groupPolicyStore.transaction(() => {
      const removed = groupPolicyStore.deleteGroupPolicy(existing.id, revision);
      if (removed) {
        auditPolicyChange({
          operation: 'deleted',
          policy: removed,
          before: removed,
          after: { updatePolicy: {}, actions: {} },
          principal,
          members: memberCount,
        });
      }
      return removed;
    });
    if (!deleted) {
      sendErrorResponse(res, 409, STALE_REVISION_MESSAGE);
      return;
    }
    const { applied, warnings } = applyToMembers(deleted.group);
    res.status(200).json({ changed: true, policy: deleted, applied, warnings });
  } catch (error: unknown) {
    sendErrorResponse(res, 500, sanitizeApiError(error));
  }
}

/**
 * Init router.
 */
export function init() {
  const router = express.Router();
  router.use(nocache());
  router.get('/', scoped('read', listGroupPolicies));
  router.get('/:id', scoped('read', getGroupPolicy));
  router.post('/', scoped('admin', createGroupPolicy));
  router.put('/:id', scoped('admin', replaceGroupPolicy));
  router.delete('/:id', scoped('admin', deleteGroupPolicy));
  return router;
}
