import type { ContainerLifecycleEventPayload } from '../event/index.js';
import type { Container } from '../model/container.js';
import {
  computeUpdateEligibility,
  type UpdateEligibilityContext,
} from '../model/update-eligibility.js';
import * as registry from '../registry/index.js';
import {
  getActiveOperationByContainerId,
  getActiveOperationByContainerName,
} from '../store/update-operation.js';
import { isSelfUpdateAvailable } from '../triggers/providers/docker/self-update-availability.js';

function buildEligibilityContext(container: Container): UpdateEligibilityContext {
  return {
    triggers: registry.getState().trigger,
    isSelfUpdateAvailable: isSelfUpdateAvailable(container),
    getActiveOperation: (c: Container) => {
      const byId = getActiveOperationByContainerId(c.id);
      const byName = byId ? undefined : getActiveOperationByContainerName(c.name);
      const isLegacyOperation = byName && typeof byName === 'object' && !('containerId' in byName);
      const matched = byId ?? (isLegacyOperation ? byName : undefined);
      if (!matched || typeof matched !== 'object') return undefined;
      const m = matched as Record<string, unknown>;
      const id = typeof m.id === 'string' ? m.id : undefined;
      const status = m.status === 'queued' || m.status === 'in-progress' ? m.status : undefined;
      if (!id || !status) return undefined;
      return {
        id,
        status,
        updatedAt: typeof m.updatedAt === 'string' ? m.updatedAt : undefined,
      };
    },
  };
}

export function enrichContainerLifecyclePayloadWithEligibility(
  payload: ContainerLifecycleEventPayload,
): ContainerLifecycleEventPayload {
  if (!payload || typeof payload !== 'object' || typeof payload.id !== 'string') {
    return payload;
  }
  try {
    const container = payload as unknown as Container;
    const eligibility = computeUpdateEligibility(container, buildEligibilityContext(container));
    return { ...payload, updateEligibility: eligibility };
  } catch {
    return payload;
  }
}
