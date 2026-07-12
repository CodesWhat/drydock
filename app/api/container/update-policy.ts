import type { Request, Response } from 'express';
import type { Container, ContainerUpdatePolicy } from '../../model/container.js';
import {
  DEFAULT_MATURITY_MIN_AGE_DAYS,
  daysToMs,
  normalizeMaturityMode,
  parseMaturityMinAgeDays,
  resolveMaturityMinAgeDays,
} from '../../model/maturity-policy.js';
import {
  applyUpdatePolicyOverrides,
  DECLARATIVE_UPDATE_POLICY_FIELDS,
  type DeclarativeUpdatePolicyField,
  getUpdatePolicyOverrides,
} from '../../model/update-policy.js';
import { sendErrorResponse } from '../error-response.js';
import { getPathParamValue } from './request-helpers.js';

interface UpdatePolicyStoreContainerApi {
  getContainer: (id: string) => Container | undefined;
  updateContainer: (container: Container) => Container;
}

interface UpdatePolicyHandlerDependencies {
  storeContainer: UpdatePolicyStoreContainerApi;
  uniqStrings: (values: string[]) => string[];
  getErrorMessage: (error: unknown) => string;
  redactContainerRuntimeEnv: (container: Container) => Container;
  recordAuditEvent: typeof import('../audit-events.js').recordAuditEvent;
}

const INVALID_SNOOZE_UNTIL_ERROR = 'Invalid snoozeUntil date';
const INVALID_SNOOZE_DAYS_ERROR = 'Invalid snooze days value';
const INVALID_MATURITY_MODE_ERROR = 'Invalid maturity mode; expected "all" or "mature"';
const INVALID_MATURITY_DAYS_ERROR = 'Invalid maturity minAgeDays value';
const GENERIC_UPDATE_POLICY_ERROR = 'Failed to update container policy';
const SAFE_CLIENT_ERRORS = new Set([
  INVALID_SNOOZE_UNTIL_ERROR,
  INVALID_SNOOZE_DAYS_ERROR,
  INVALID_MATURITY_MODE_ERROR,
  INVALID_MATURITY_DAYS_ERROR,
]);

type UpdatePolicyActionResult = { policy: ContainerUpdatePolicy } | { error: string };
type UniqStringsFn = UpdatePolicyHandlerDependencies['uniqStrings'];

function normalizeUpdatePolicy(
  updatePolicy: ContainerUpdatePolicy = {},
  uniqStrings: UniqStringsFn,
  preserveEmptyArrays = false,
): ContainerUpdatePolicy {
  const normalizedPolicy: ContainerUpdatePolicy = {};

  if (Array.isArray(updatePolicy.skipTags)) {
    const skipTags = uniqStrings(updatePolicy.skipTags);
    if (skipTags.length > 0 || preserveEmptyArrays) {
      normalizedPolicy.skipTags = skipTags;
    }
  }

  if (Array.isArray(updatePolicy.skipDigests)) {
    const skipDigests = uniqStrings(updatePolicy.skipDigests);
    if (skipDigests.length > 0 || preserveEmptyArrays) {
      normalizedPolicy.skipDigests = skipDigests;
    }
  }

  if (updatePolicy.snoozeUntil) {
    const snoozeUntil = new Date(updatePolicy.snoozeUntil);
    if (!Number.isNaN(snoozeUntil.getTime())) {
      normalizedPolicy.snoozeUntil = snoozeUntil.toISOString();
    }
  }

  const maturityMode = normalizeMaturityMode(updatePolicy.maturityMode);
  if (maturityMode) {
    normalizedPolicy.maturityMode = maturityMode;
  }

  const maturityMinAgeDays = parseMaturityMinAgeDays(updatePolicy.maturityMinAgeDays);
  if (maturityMinAgeDays !== undefined) {
    normalizedPolicy.maturityMinAgeDays = maturityMinAgeDays;
  }

  return normalizedPolicy;
}

function isDeclarativeField(value: unknown): value is DeclarativeUpdatePolicyField {
  return DECLARATIVE_UPDATE_POLICY_FIELDS.includes(value as DeclarativeUpdatePolicyField);
}

function applyLayeredPolicyAction(
  action: string,
  container: Container,
  overrides: ContainerUpdatePolicy,
  body: Record<string, unknown>,
  uniqStrings: UniqStringsFn,
): UpdatePolicyActionResult {
  const effective = normalizeUpdatePolicy(container.updatePolicy || {}, uniqStrings);
  switch (action) {
    case 'skip-current': {
      const kind = container.updateKind?.kind;
      const value = getCurrentUpdateValue(container);
      if (kind !== 'tag' && kind !== 'digest') {
        return { error: 'No current update available to skip' };
      }
      if (!value) return { error: 'No update value available to skip' };
      const field = kind === 'tag' ? 'skipTags' : 'skipDigests';
      overrides[field] = uniqStrings([...(overrides[field] ?? effective[field] ?? []), value]);
      return { policy: overrides };
    }
    case 'remove-skip': {
      const kind = body.kind;
      const value = typeof body.value === 'string' ? body.value.trim() : '';
      if (kind !== 'tag' && kind !== 'digest')
        return { error: 'Invalid remove-skip kind; expected "tag" or "digest"' };
      if (!value) return { error: 'Invalid remove-skip value; expected a non-empty string' };
      const field = kind === 'tag' ? 'skipTags' : 'skipDigests';
      overrides[field] = (overrides[field] ?? effective[field] ?? []).filter(
        (entry) => entry !== value,
      );
      return { policy: overrides };
    }
    case 'clear-skips':
      overrides.skipTags = [];
      overrides.skipDigests = [];
      return { policy: overrides };
    case 'snooze':
      overrides.snoozeUntil = getSnoozeUntilFromActionPayload(body);
      return { policy: overrides };
    case 'unsnooze':
      delete overrides.snoozeUntil;
      return { policy: overrides };
    case 'set-maturity-policy': {
      const mode = normalizeMaturityMode(body.mode);
      if (!mode) throw new TypeError(INVALID_MATURITY_MODE_ERROR);
      overrides.maturityMode = mode;
      overrides.maturityMinAgeDays = getMaturityMinAgeDaysFromActionPayload(
        body,
        effective.maturityMinAgeDays ?? DEFAULT_MATURITY_MIN_AGE_DAYS,
      );
      return { policy: overrides };
    }
    case 'clear-maturity-policy':
      overrides.maturityMode = 'all';
      delete overrides.maturityMinAgeDays;
      return { policy: overrides };
    case 'revert-to-declarative':
      if (body.field !== undefined) {
        if (!isDeclarativeField(body.field)) {
          return { error: 'Invalid declarative policy field' };
        }
        delete overrides[body.field];
      } else {
        for (const field of DECLARATIVE_UPDATE_POLICY_FIELDS) delete overrides[field];
      }
      return { policy: overrides };
    case 'clear':
      return { policy: {} };
    default:
      return { error: `Unknown action ${action}` };
  }
}

function getCurrentUpdateValue(container: Container): string | undefined {
  const updateKind = container.updateKind?.kind;
  if (updateKind === 'tag') {
    return container.updateKind?.remoteValue || container.result?.tag;
  }
  if (updateKind === 'digest') {
    return container.updateKind?.remoteValue || container.result?.digest;
  }
  return undefined;
}

function getSnoozeUntilFromActionPayload(payload: Record<string, unknown> = {}): string {
  if (payload.snoozeUntil) {
    const customDate = new Date(`${payload.snoozeUntil}`);
    if (Number.isNaN(customDate.getTime())) {
      throw new TypeError(INVALID_SNOOZE_UNTIL_ERROR);
    }
    return customDate.toISOString();
  }

  const days = Number(payload.days ?? 7);
  if (!Number.isFinite(days) || days <= 0 || days > 365) {
    throw new Error(INVALID_SNOOZE_DAYS_ERROR);
  }
  const snoozeUntil = new Date(Date.now() + daysToMs(days));
  return snoozeUntil.toISOString();
}

function getMaturityMinAgeDaysFromActionPayload(
  payload: Record<string, unknown> = {},
  fallbackDays: number = DEFAULT_MATURITY_MIN_AGE_DAYS,
): number {
  if (payload.minAgeDays === undefined) {
    return resolveMaturityMinAgeDays(undefined, fallbackDays);
  }
  const minAgeDays = parseMaturityMinAgeDays(payload.minAgeDays);
  if (minAgeDays === undefined) {
    throw new Error(INVALID_MATURITY_DAYS_ERROR);
  }
  return minAgeDays;
}

function applySkipCurrentAction(
  container: Container,
  updatePolicy: ContainerUpdatePolicy,
  uniqStrings: UniqStringsFn,
): UpdatePolicyActionResult {
  const updateKind = container.updateKind?.kind;
  const updateValue = getCurrentUpdateValue(container);
  if (updateKind !== 'tag' && updateKind !== 'digest') {
    return { error: 'No current update available to skip' };
  }
  if (!updateValue) {
    return { error: 'No update value available to skip' };
  }
  if (updateKind === 'tag') {
    updatePolicy.skipTags = uniqStrings([...(updatePolicy.skipTags || []), updateValue]);
  } else {
    updatePolicy.skipDigests = uniqStrings([...(updatePolicy.skipDigests || []), updateValue]);
  }
  return { policy: updatePolicy };
}

function applyRemoveSkipAction(
  updatePolicy: ContainerUpdatePolicy,
  body: Record<string, unknown>,
  uniqStrings: UniqStringsFn,
): UpdatePolicyActionResult {
  const kind = body.kind;
  const value = typeof body.value === 'string' ? body.value.trim() : '';

  if (kind !== 'tag' && kind !== 'digest') {
    return { error: 'Invalid remove-skip kind; expected "tag" or "digest"' };
  }
  if (!value) {
    return { error: 'Invalid remove-skip value; expected a non-empty string' };
  }

  if (kind === 'tag') {
    const nextSkipTags = (updatePolicy.skipTags || []).filter((entry) => entry !== value);
    if (nextSkipTags.length > 0) {
      updatePolicy.skipTags = uniqStrings(nextSkipTags);
    } else {
      delete updatePolicy.skipTags;
    }
    return { policy: updatePolicy };
  }

  const nextSkipDigests = (updatePolicy.skipDigests || []).filter((entry) => entry !== value);
  if (nextSkipDigests.length > 0) {
    updatePolicy.skipDigests = uniqStrings(nextSkipDigests);
  } else {
    delete updatePolicy.skipDigests;
  }
  return { policy: updatePolicy };
}

function applyPolicyAction(
  action: string,
  container: Container,
  updatePolicy: ContainerUpdatePolicy,
  body: Record<string, unknown>,
  uniqStrings: UniqStringsFn,
): UpdatePolicyActionResult {
  switch (action) {
    case 'skip-current':
      return applySkipCurrentAction(container, updatePolicy, uniqStrings);
    case 'remove-skip':
      return applyRemoveSkipAction(updatePolicy, body, uniqStrings);
    case 'clear-skips':
      delete updatePolicy.skipTags;
      delete updatePolicy.skipDigests;
      return { policy: updatePolicy };
    case 'snooze':
      updatePolicy.snoozeUntil = getSnoozeUntilFromActionPayload(body);
      return { policy: updatePolicy };
    case 'unsnooze':
      delete updatePolicy.snoozeUntil;
      return { policy: updatePolicy };
    case 'clear':
      return { policy: {} };
    case 'set-maturity-policy': {
      const mode = normalizeMaturityMode(body.mode);
      if (!mode) {
        throw new TypeError(INVALID_MATURITY_MODE_ERROR);
      }
      updatePolicy.maturityMode = mode;
      updatePolicy.maturityMinAgeDays = getMaturityMinAgeDaysFromActionPayload(
        body,
        updatePolicy.maturityMinAgeDays ?? DEFAULT_MATURITY_MIN_AGE_DAYS,
      );
      return { policy: updatePolicy };
    }
    case 'clear-maturity-policy':
      delete updatePolicy.maturityMode;
      delete updatePolicy.maturityMinAgeDays;
      return { policy: updatePolicy };
    default:
      return { error: `Unknown action ${action}` };
  }
}

function getActionBody(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
}

function policyFieldChanged(
  before: ContainerUpdatePolicy,
  after: ContainerUpdatePolicy,
  field: DeclarativeUpdatePolicyField,
) {
  const beforeHasField = Object.hasOwn(before, field);
  const afterHasField = Object.hasOwn(after, field);
  if (beforeHasField !== afterHasField) return true;
  return beforeHasField && JSON.stringify(before[field]) !== JSON.stringify(after[field]);
}

function getPolicyFieldAuditValue(
  policy: ContainerUpdatePolicy | undefined,
  field: DeclarativeUpdatePolicyField,
) {
  return policy && Object.hasOwn(policy, field) ? (policy[field] ?? null) : null;
}

function createOverrideAuditDetails(
  operation: string,
  container: Container,
  overrides: ContainerUpdatePolicy,
  fields: DeclarativeUpdatePolicyField[],
) {
  return JSON.stringify({
    operation,
    fields: Object.fromEntries(
      fields.map((field) => [
        field,
        {
          env: getPolicyFieldAuditValue(container.updatePolicyDeclarative?.env, field),
          label: getPolicyFieldAuditValue(container.updatePolicyDeclarative?.label, field),
          override: getPolicyFieldAuditValue(overrides, field),
          effective: getPolicyFieldAuditValue(container.updatePolicy, field),
          source: container.updatePolicySources?.[field] ?? null,
        },
      ]),
    ),
  });
}

function recordOverrideAuditEvents(
  recordAuditEvent: UpdatePolicyHandlerDependencies['recordAuditEvent'],
  operation: string,
  container: Container,
  before: ContainerUpdatePolicy,
  after: ContainerUpdatePolicy,
) {
  const changedFields = DECLARATIVE_UPDATE_POLICY_FIELDS.filter((field) =>
    policyFieldChanged(before, after, field),
  );
  const setFields = changedFields.filter((field) => Object.hasOwn(after, field));
  const clearedFields = changedFields.filter((field) => !Object.hasOwn(after, field));
  if (setFields.length > 0) {
    recordAuditEvent({
      action: 'update-policy-override-set',
      status: 'success',
      container,
      details: createOverrideAuditDetails(operation, container, after, setFields),
    });
  }
  if (clearedFields.length > 0) {
    recordAuditEvent({
      action: 'update-policy-override-cleared',
      status: 'success',
      container,
      details: createOverrideAuditDetails(operation, container, after, clearedFields),
    });
  }
}

function createPatchContainerUpdatePolicy({
  storeContainer,
  uniqStrings,
  getErrorMessage,
  redactContainerRuntimeEnv,
  recordAuditEvent,
}: UpdatePolicyHandlerDependencies) {
  return function patchContainerUpdatePolicy(req: Request, res: Response) {
    const id = getPathParamValue(req.params.id);
    const { action } = (req.body || {}) as { action?: string };
    const container = storeContainer.getContainer(id);

    if (!container) {
      sendErrorResponse(res, 404, 'Container not found');
      return;
    }
    if (!action) {
      sendErrorResponse(res, 400, 'Action is required');
      return;
    }

    try {
      const actionBody = getActionBody(req.body);
      const hasLayeredPolicy = container.updatePolicyDeclarative !== undefined;
      const updatePolicy = hasLayeredPolicy
        ? normalizeUpdatePolicy(getUpdatePolicyOverrides(container), uniqStrings, true)
        : normalizeUpdatePolicy(container.updatePolicy || {}, uniqStrings);
      const previousOverrides = hasLayeredPolicy ? structuredClone(updatePolicy) : undefined;
      const result = hasLayeredPolicy
        ? applyLayeredPolicyAction(action, container, updatePolicy, actionBody, uniqStrings)
        : applyPolicyAction(action, container, updatePolicy, actionBody, uniqStrings);

      if ('error' in result) {
        sendErrorResponse(res, 400, result.error);
        return;
      }

      const normalizedPolicy = normalizeUpdatePolicy(result.policy, uniqStrings, hasLayeredPolicy);
      if (hasLayeredPolicy) {
        applyUpdatePolicyOverrides(container, normalizedPolicy);
      } else {
        container.updatePolicy =
          Object.keys(normalizedPolicy).length > 0 ? normalizedPolicy : undefined;
      }
      const containerUpdated = storeContainer.updateContainer(container);
      if (previousOverrides) {
        recordOverrideAuditEvents(
          recordAuditEvent,
          action,
          containerUpdated,
          previousOverrides,
          normalizedPolicy,
        );
      }
      res.status(200).json(redactContainerRuntimeEnv(containerUpdated));
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error);
      if (SAFE_CLIENT_ERRORS.has(errorMessage)) {
        sendErrorResponse(res, 400, errorMessage);
        return;
      }
      sendErrorResponse(res, 400, GENERIC_UPDATE_POLICY_ERROR);
    }
  };
}

export function createUpdatePolicyHandlers(dependencies: UpdatePolicyHandlerDependencies) {
  return {
    patchContainerUpdatePolicy: createPatchContainerUpdatePolicy(dependencies),
  };
}
