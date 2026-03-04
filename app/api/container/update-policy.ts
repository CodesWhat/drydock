import type { Request, Response } from 'express';
import type { Container, ContainerUpdatePolicy } from '../../model/container.js';
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

export function createUpdatePolicyHandlers({
  storeContainer,
  uniqStrings,
  getErrorMessage,
  redactContainerRuntimeEnv,
}: UpdatePolicyHandlerDependencies) {
  function normalizeUpdatePolicy(updatePolicy: ContainerUpdatePolicy = {}): ContainerUpdatePolicy {
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

  function getCurrentUpdateValue(
    container: Container,
    kind: Container['updateKind']['kind'] | undefined,
  ): string | undefined {
    if (kind === 'tag') {
      return container.updateKind?.remoteValue || container.result?.tag;
    }
    if (kind === 'digest') {
      return container.updateKind?.remoteValue || container.result?.digest;
    }
    return undefined;
  }

  function getSnoozeUntilFromActionPayload(payload: Record<string, unknown> = {}): string {
    if (payload.snoozeUntil) {
      const customDate = new Date(`${payload.snoozeUntil}`);
      if (Number.isNaN(customDate.getTime())) {
        throw new TypeError('Invalid snoozeUntil date');
      }
      return customDate.toISOString();
    }
    const days = Number(payload.days ?? 7);
    if (!Number.isFinite(days) || days <= 0 || days > 365) {
      throw new Error('Invalid snooze days value');
    }
    const snoozeUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    return snoozeUntil.toISOString();
  }

  /**
   * Update container update policy (skip/snooze controls).
   * @param req
   * @param res
   */
  function applySkipCurrentAction(
    container: Container,
    updatePolicy: ContainerUpdatePolicy,
  ): { policy: ContainerUpdatePolicy } | { error: string } {
    const updateKind = container.updateKind?.kind;
    const updateValue = getCurrentUpdateValue(container, updateKind);
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
    body: Record<string, unknown> = {},
  ): { policy: ContainerUpdatePolicy } | { error: string } {
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
    body: Record<string, unknown> = {},
  ): { policy: ContainerUpdatePolicy } | { error: string } {
    switch (action) {
      case 'skip-current':
        return applySkipCurrentAction(container, updatePolicy);
      case 'remove-skip':
        return applyRemoveSkipAction(updatePolicy, body);
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

  function patchContainerUpdatePolicy(req: Request, res: Response) {
    const id = getPathParamValue(req.params.id);
    const { action } = (req.body || {}) as { action?: string };
    const container = storeContainer.getContainer(id);

    if (!container) {
      res.sendStatus(404);
      return;
    }

    if (!action) {
      res.status(400).json({ error: 'Action is required' });
      return;
    }

    try {
      let updatePolicy = normalizeUpdatePolicy(container.updatePolicy || {});
      const actionBody =
        req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
      const result = applyPolicyAction(action, container, updatePolicy, actionBody);

      if ('error' in result) {
        res.status(400).json({ error: result.error });
        return;
      }

      updatePolicy = normalizeUpdatePolicy(result.policy);
      container.updatePolicy = Object.keys(updatePolicy).length > 0 ? updatePolicy : undefined;
      const containerUpdated = storeContainer.updateContainer(container);
      res.status(200).json(redactContainerRuntimeEnv(containerUpdated));
    } catch (error: unknown) {
      res.status(400).json({ error: getErrorMessage(error) });
    }
  }

  return {
    patchContainerUpdatePolicy,
  };
}
