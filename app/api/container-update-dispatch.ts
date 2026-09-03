/**
 * The one manual container-update admission path, shared by the container action endpoint
 * and the approval queue.
 *
 * Approving a queued row is the manual Update button made durable, not a second way to
 * update a container, so it has to answer exactly what `POST /containers/:id/update`
 * answers for the same container in the same state — the same status code, the same
 * message, the same operation record. A second copy of "call `requestContainerUpdate`,
 * translate `UpdateRequestError`, log the rest" would agree on the day it was written and
 * drift the first time one of them gained a case, so both callers share this instead and
 * the parity is structural rather than asserted.
 *
 * Nothing here decides anything. Every rejection is the admission path's own
 * (`updates/request-update.ts`): the notify-mode 409, the hard-blocker statuses, the
 * active-operation gate. The queue never invents an admission it could not already
 * perform.
 */
import type { Response } from 'express';
import { getServerConfiguration } from '../configuration/index.js';
import logger from '../log/index.js';
import { sanitizeLogParam } from '../log/sanitize.js';
import type { Container } from '../model/container.js';
import { getContainerActionsCounter } from '../prometheus/container-actions.js';
import { requestContainerUpdate, UpdateRequestError } from '../updates/request-update.js';
import { sendErrorResponse } from './error-response.js';

const log = logger.child({ component: 'container-update-dispatch' });

export const CONTAINER_UPDATE_ACCEPTED_MESSAGE = 'Container update accepted';
export const CONTAINER_ACTIONS_DISABLED_MESSAGE = 'Container actions are disabled';
export const CONTAINER_NOT_FOUND_MESSAGE = 'Container not found';
const CONTAINER_UPDATE_UNAVAILABLE_MESSAGE = 'Unable to accept container update';

export type ContainerUpdateDispatchOutcome =
  | { kind: 'accepted'; operationId: string }
  | { kind: 'rejected'; statusCode: number; message: string };

/** The `containeractions` feature flag, which gates every write to a container. */
export function areContainerActionsEnabled(): boolean {
  return Boolean(getServerConfiguration().feature.containeractions);
}

/**
 * Admit and dispatch one manual update, reporting what the caller should answer.
 *
 * Returns rather than writes the response so a caller with bookkeeping of its own — the
 * approval queue has a row to stamp with the operation id and an audit entry to record —
 * can act on the outcome before the response goes out, without either caller
 * reconstructing the other's status codes.
 * @param container
 */
export async function dispatchManualContainerUpdate(
  container: Container,
): Promise<ContainerUpdateDispatchOutcome> {
  try {
    const accepted = await requestContainerUpdate(container);
    getContainerActionsCounter()?.inc({ action: 'container-update' });
    return { kind: 'accepted', operationId: accepted.operationId };
  } catch (error: unknown) {
    if (error instanceof UpdateRequestError) {
      return { kind: 'rejected', statusCode: error.statusCode, message: error.message };
    }

    log.warn(
      `Unexpected error accepting update for container ${sanitizeLogParam(
        container.id,
      )} (${sanitizeLogParam(error instanceof Error ? error.message : String(error))})`,
    );
    return { kind: 'rejected', statusCode: 500, message: CONTAINER_UPDATE_UNAVAILABLE_MESSAGE };
  }
}

/**
 * Write a dispatch outcome as the HTTP response both endpoints return.
 * @param res
 * @param outcome
 */
export function sendContainerUpdateDispatchOutcome(
  res: Response,
  outcome: ContainerUpdateDispatchOutcome,
): void {
  if (outcome.kind === 'accepted') {
    res
      .status(202)
      .json({ message: CONTAINER_UPDATE_ACCEPTED_MESSAGE, operationId: outcome.operationId });
    return;
  }

  sendErrorResponse(res, outcome.statusCode, outcome.message);
}
