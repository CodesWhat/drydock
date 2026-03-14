import type { Request, Response } from 'express';
import type { Container, ContainerUpdatePolicy } from '../../model/container.js';
import { sendErrorResponse } from '../error-response.js';
import { getPathParamValue } from './request-helpers.js';

interface UpdatePolicyStoreContainerApi {
  getContainer: (id: string) => Container | undefined;
  updateContainer: (container: Container) => Container;
}

export interface UpdatePolicyHandlerDependencies {
  storeContainer: UpdatePolicyStoreContainerApi;
  uniqStrings: (values: string[]) => string[];
  getErrorMessage: (error: unknown) => string;
  redactContainerRuntimeEnv: (container: Container) => Container;
}

const INVALID_SNOOZE_UNTIL_ERROR = 'Invalid snoozeUntil date';
const INVALID_SNOOZE_DAYS_ERROR = 'Invalid snooze days value';
const GENERIC_UPDATE_POLICY_ERROR = 'Failed to update container policy';
const SAFE_CLIENT_ERRORS = new Set([INVALID_SNOOZE_UNTIL_ERROR, INVALID_SNOOZE_DAYS_ERROR]);

type UpdatePolicyActionResult = { policy: ContainerUpdatePolicy } | { error: string };
type UniqStringsFn = UpdatePolicyHandlerDependencies['uniqStrings'];

function normalizeUpdatePolicy(
  updatePolicy: ContainerUpdatePolicy = {},
  uniqStrings: UniqStringsFn,
): ContainerUpdatePolicy {
  const normalizedPolicy: ContainerUpdatePolicy = {};

  if (Array.isArray(updatePolicy.skipTags)) {
    const skipTags = uniqStrings(updatePolicy.skipTags);
    if (skipTags.length > 0) {
      normalizedPolicy.skipTags = skipTags;
    }
  }

  if (Array.isArray(updatePolicy.skipDigests)) {
    const skipDigests = uniqStrings(updatePolicy.skipDigests);
    if (skipDigests.length > 0) {
      normalizedPolicy.skipDigests = skipDigests;
    }
  }

  if (updatePolicy.snoozeUntil) {
    const snoozeUntil = new Date(updatePolicy.snoozeUntil);
    if (!Number.isNaN(snoozeUntil.getTime())) {
      normalizedPolicy.snoozeUntil = snoozeUntil.toISOString();
    }
  }

  return normalizedPolicy;
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
  const snoozeUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return snoozeUntil.toISOString();
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
    default:
      return { error: `Unknown action ${action}` };
  }
}

function getActionBody(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
}

function createPatchContainerUpdatePolicy({
  storeContainer,
  uniqStrings,
  getErrorMessage,
  redactContainerRuntimeEnv,
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
      const updatePolicy = normalizeUpdatePolicy(container.updatePolicy || {}, uniqStrings);
      const result = applyPolicyAction(action, container, updatePolicy, actionBody, uniqStrings);

      if ('error' in result) {
        sendErrorResponse(res, 400, result.error);
        return;
      }

      const normalizedPolicy = normalizeUpdatePolicy(result.policy, uniqStrings);
      container.updatePolicy =
        Object.keys(normalizedPolicy).length > 0 ? normalizedPolicy : undefined;
      const containerUpdated = storeContainer.updateContainer(container);
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
