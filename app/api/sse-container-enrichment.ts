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

function buildEligibilityContext(): UpdateEligibilityContext {
  return {
    triggers: registry.getState().trigger,
    getActiveOperation: (container: Container) => {
      const byId = getActiveOperationByContainerId(container.id);
      const byName = byId ? undefined : getActiveOperationByContainerName(container.name);
      const matched = byId ?? byName;
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
    const eligibility = computeUpdateEligibility(
      payload as unknown as Container,
      buildEligibilityContext(),
    );
    return { ...payload, updateEligibility: eligibility };
  } catch {
    return payload;
  }
}
