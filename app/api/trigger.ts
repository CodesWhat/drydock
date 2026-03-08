import type { Request, Response } from 'express';
import * as agent from '../agent/index.js';
import logger from '../log/index.js';
import { sanitizeLogParam } from '../log/sanitize.js';
import * as registry from '../registry/index.js';
import { getErrorMessage } from '../util/error.js';
import * as component from './component.js';
import { sendErrorResponse } from './error-response.js';

const log = logger.child({ component: 'trigger' });

interface RunTriggerParams {
  type: string;
  name: string;
}

interface RunRemoteTriggerParams extends RunTriggerParams {
  agent: string;
}

/**
 * Run a specific trigger on a specific container provided in the payload.
 */
export async function runTrigger(req: Request<RunTriggerParams>, res: Response) {
  const triggerType = req.params.type;
  const triggerName = req.params.name;
  const containerToTrigger = req.body;

  if (!containerToTrigger) {
    log.warn(
      `Trigger cannot be executed without container (type=${sanitizeLogParam(triggerType)}, name=${sanitizeLogParam(triggerName)})`,
    );
    sendErrorResponse(
      res,
      400,
      `Error when running trigger ${triggerType}.${triggerName} (container is undefined)`,
    );
    return;
  }

  // Running local triggers on remote containers is not supported
  if (containerToTrigger.agent) {
    log.warn(
      `Cannot execute local trigger ${sanitizeLogParam(triggerType)}.${sanitizeLogParam(triggerName)} on remote container ${sanitizeLogParam(containerToTrigger.agent)}.${sanitizeLogParam(containerToTrigger.id)}`,
    );
    sendErrorResponse(
      res,
      400,
      `Cannot execute local trigger ${triggerType}.${triggerName} on remote container ${containerToTrigger.agent}.${containerToTrigger.id}`,
    );
    return;
  }

  const triggerToRun = registry.getState().trigger[`${triggerType}.${triggerName}`];
  if (!triggerToRun) {
    log.warn(
      `No trigger found(type=${sanitizeLogParam(triggerType)}, name=${sanitizeLogParam(triggerName)})`,
    );
    sendErrorResponse(
      res,
      404,
      `Error when running trigger ${triggerType}.${triggerName} (trigger not found)`,
    );
    return;
  }

  // Ensure updateKind exists for template rendering (test containers
  // from the API don't have the computed getter that validate() adds)
  if (!containerToTrigger.updateKind) {
    containerToTrigger.updateKind = {
      kind: 'unknown',
      localValue: undefined,
      remoteValue: undefined,
      semverDiff: 'unknown',
    };
  }

  try {
    log.debug(
      `Running trigger ${sanitizeLogParam(triggerType)}.${sanitizeLogParam(triggerName)} (container=${sanitizeLogParam(JSON.stringify(containerToTrigger), 500)})`,
    );
    await triggerToRun.trigger(containerToTrigger);
    log.info(
      `Trigger executed with success (type=${sanitizeLogParam(triggerType)}, name=${sanitizeLogParam(triggerName)}, container=${sanitizeLogParam(JSON.stringify(containerToTrigger), 500)})`,
    );
    res.status(200).json({});
  } catch (e) {
    const errorMessage = getErrorMessage(e);
    log.warn(
      `Error when running trigger ${sanitizeLogParam(triggerType)}.${sanitizeLogParam(triggerName)} (${sanitizeLogParam(errorMessage)})`,
    );
    sendErrorResponse(res, 500, `Error when running trigger ${triggerType}.${triggerName}`);
  }
}

/**
 * Run a specifically targeted remote trigger.
 */
async function runRemoteTrigger(req: Request<RunRemoteTriggerParams>, res: Response) {
  const { agent: agentName, type: triggerType, name: triggerName } = req.params;
  const containerToTrigger = req.body;

  const agentClient = agent.getAgent(agentName);
  if (!agentClient) {
    sendErrorResponse(res, 404, `Agent ${agentName} not found`);
    return;
  }

  if (!containerToTrigger?.id) {
    sendErrorResponse(res, 400, 'Container with ID is required in body');
    return;
  }

  try {
    await agentClient.runRemoteTrigger(containerToTrigger, triggerType, triggerName);
    log.info(
      `Remote trigger executed with success (agent=${sanitizeLogParam(agentName)}, type=${sanitizeLogParam(triggerType)}, name=${sanitizeLogParam(triggerName)}, container=${sanitizeLogParam(containerToTrigger.id)})`,
    );
    res.status(200).json({});
  } catch (e) {
    const errorMessage = getErrorMessage(e);
    log.warn(
      `Error when running remote trigger ${sanitizeLogParam(triggerType)}.${sanitizeLogParam(triggerName)} on agent ${sanitizeLogParam(agentName)} (${sanitizeLogParam(errorMessage)})`,
    );
    sendErrorResponse(
      res,
      500,
      `Error when running remote trigger ${triggerType}.${triggerName} on agent ${agentName}`,
    );
  }
}

/**
 * Init Router.
 * @returns {*}
 */
export function init() {
  const router = component.init('trigger');
  router.post('/:type/:name', runTrigger);
  router.post('/:type/:name/:agent', runRemoteTrigger);
  return router;
}
