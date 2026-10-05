import type { Request, Response } from 'express';
import type { ActionPolicyTrigger } from '../../../model/action-policy.js';
import type { Container } from '../../../model/container.js';
import { resolveEffectiveContainerPolicy } from '../../../model/effective-policy.js';
import type { UpdateMode } from '../../../store/settings.js';
import { sendErrorResponse } from '../../error-response.js';
import { getPathParamValue } from '../request-helpers.js';

export interface EffectivePolicyHandlerDependencies {
  getContainer: (id: string) => Container | undefined;
  /** The registered triggers, as dispatch sees them. */
  getTriggers: () => Record<string, unknown> | undefined;
  getUpdateMode: () => UpdateMode;
  /** The container with its group snapshot brought up to the policy as it stands now. */
  withCurrentGroupPolicy: (container: Container) => Container;
  /** The same projection and runtime env redaction every other container response gets. */
  toApiContainer: <T>(container: T) => T;
}

/**
 * `GET /containers/:id/effective-policy`: where each update-policy field and action
 * restriction on one container comes from, and what dispatch will do with it. It reads the
 * group rule live, as the trigger paths do, and asks the model's own resolvers rather than
 * re-deriving anything.
 */
export function createEffectivePolicyHandler(deps: EffectivePolicyHandlerDependencies) {
  return function getContainerEffectivePolicy(req: Request, res: Response) {
    const container = deps.getContainer(getPathParamValue(req.params.id));
    if (!container) {
      sendErrorResponse(res, 404, 'Container not found');
      return;
    }
    const projected = deps.toApiContainer(deps.withCurrentGroupPolicy(container));
    res.status(200).json(
      resolveEffectiveContainerPolicy(projected, {
        globalUpdateMode: deps.getUpdateMode(),
        triggers: deps.getTriggers() as Record<string, ActionPolicyTrigger> | undefined,
      }),
    );
  };
}
