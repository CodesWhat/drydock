import type { Request, Response } from 'express';
import joi from 'joi';
import * as agent from '../agent/index.js';
import logger from '../log/index.js';
import { sanitizeLogParam } from '../log/sanitize.js';
import type { Container } from '../model/container.js';
import * as registry from '../registry/index.js';
import Trigger from '../triggers/providers/Trigger.js';
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

interface TriggerUpdateKind {
  kind: string;
  localValue?: unknown;
  remoteValue?: unknown;
  semverDiff?: string;
}

interface TriggerRequestBody extends Record<string, unknown> {
  id: string;
  agent?: string;
  updateKind?: TriggerUpdateKind;
}

interface ErrorResponsePayload {
  error?: unknown;
  details?: unknown;
}

const triggerRequestBodySchema = joi
  .object<TriggerRequestBody>({
    id: joi.string().trim().min(1).required(),
    agent: joi.string().trim().min(1),
  })
  .unknown(true);

const INVALID_TRIGGER_REQUEST_BODY_ERROR = 'Invalid trigger request body';

function validateTriggerRequestBody(body: unknown): {
  value?: TriggerRequestBody;
  error?: string;
} {
  const validationResult = triggerRequestBodySchema.validate(body, {
    abortEarly: false,
    convert: false,
  });

  if (validationResult.error) {
    return {
      error: validationResult.error.message,
    };
  }

  return {
    value: validationResult.value,
  };
}

function getRemoteErrorStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  const response = (error as { response?: unknown }).response;
  if (!response || typeof response !== 'object') {
    return undefined;
  }
  const status = (response as { status?: unknown }).status;
  if (typeof status !== 'number' || status < 400 || status > 599) {
    return undefined;
  }
  return status;
}

function getRemoteErrorPayload(error: unknown): ErrorResponsePayload | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  const response = (error as { response?: unknown }).response;
  if (!response || typeof response !== 'object') {
    return undefined;
  }
  const data = (response as { data?: unknown }).data;
  return data && typeof data === 'object' ? (data as ErrorResponsePayload) : undefined;
}

function getRemoteErrorMessage(error: unknown): string | undefined {
  const payload = getRemoteErrorPayload(error);
  return typeof payload?.error === 'string' ? payload.error : undefined;
}

function getRemoteErrorDetails(error: unknown): Record<string, unknown> | undefined {
  const payload = getRemoteErrorPayload(error);
  return payload?.details && typeof payload.details === 'object'
    ? (payload.details as Record<string, unknown>)
    : undefined;
}

/**
 * Run a specific trigger on a specific container provided in the payload.
 */
export async function runTrigger(req: Request<RunTriggerParams>, res: Response) {
  const triggerType = req.params.type;
  const triggerName = req.params.name;
  const validationResult = validateTriggerRequestBody(req.body);
  if (validationResult.error || !validationResult.value) {
    log.warn(
      `Invalid trigger request body (type=${sanitizeLogParam(triggerType)}, name=${sanitizeLogParam(triggerName)}, error=${sanitizeLogParam(validationResult.error)})`,
    );
    sendErrorResponse(res, 400, INVALID_TRIGGER_REQUEST_BODY_ERROR);
    return;
  }
  const containerToTrigger = validationResult.value as unknown as Container;

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

  if (Trigger.isRollbackContainer(containerToTrigger)) {
    sendErrorResponse(res, 409, 'Cannot update temporary rollback container');
    return;
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
    sendErrorResponse(res, 500, {
      message: `Error when running trigger ${triggerType}.${triggerName}`,
      details: errorMessage ? { reason: errorMessage } : undefined,
    });
  }
}

/**
 * Run a specifically targeted remote trigger.
 */
async function runRemoteTrigger(req: Request<RunRemoteTriggerParams>, res: Response) {
  const { agent: agentName, type: triggerType, name: triggerName } = req.params;

  const agentClient = agent.getAgent(agentName);
  if (!agentClient) {
    sendErrorResponse(res, 404, `Agent ${agentName} not found`);
    return;
  }

  const validationResult = validateTriggerRequestBody(req.body);
  if (validationResult.error || !validationResult.value) {
    log.warn(
      `Invalid remote trigger request body (agent=${sanitizeLogParam(agentName)}, type=${sanitizeLogParam(triggerType)}, name=${sanitizeLogParam(triggerName)}, error=${sanitizeLogParam(validationResult.error)})`,
    );
    sendErrorResponse(res, 400, INVALID_TRIGGER_REQUEST_BODY_ERROR);
    return;
  }
  const containerToTrigger = validationResult.value as unknown as Container;

  if (Trigger.isRollbackContainer(containerToTrigger)) {
    sendErrorResponse(res, 409, 'Cannot update temporary rollback container');
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
    const remoteStatusCode = getRemoteErrorStatusCode(e);
    const remoteErrorMessage = getRemoteErrorMessage(e);
    const remoteErrorDetails = getRemoteErrorDetails(e);
    if (remoteStatusCode && remoteErrorMessage) {
      sendErrorResponse(res, remoteStatusCode, {
        message: remoteErrorMessage,
        details: remoteErrorDetails,
      });
      return;
    }
    sendErrorResponse(res, 500, {
      message: `Error when running remote trigger ${triggerType}.${triggerName} on agent ${agentName}`,
      details: errorMessage ? { reason: errorMessage } : undefined,
    });
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
