import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import express from 'express';
import {
  type FailedContainerUpdateOperationPhase,
  isTerminalContainerUpdateOperationPhaseForStatus,
  isTerminalContainerUpdateOperationStatus,
  type RolledBackContainerUpdateOperationPhase,
  type SucceededContainerUpdateOperationPhase,
} from '../model/container-update-operation.js';
import * as updateOperationStore from '../store/update-operation.js';
import { sendErrorResponse } from './error-response.js';

export const SELF_UPDATE_FINALIZE_SECRET_HEADER = 'x-dd-self-update-secret';

const SELF_UPDATE_FINALIZE_SECRET = crypto.randomBytes(32).toString('hex');

type FinalizeSelfUpdateBody = {
  operationId?: unknown;
  status?: unknown;
  phase?: unknown;
  lastError?: unknown;
};

function getFinalizeSecretHeaderValue(req: Request): string | undefined {
  const value = req.header(SELF_UPDATE_FINALIZE_SECRET_HEADER);
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function secretsMatch(expectedSecret: string, providedSecret: string | undefined): boolean {
  if (!providedSecret) {
    return false;
  }

  const expectedBuffer = Buffer.from(expectedSecret, 'utf8');
  const providedBuffer = Buffer.from(providedSecret, 'utf8');
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

export function getSelfUpdateFinalizeSecret(): string {
  return SELF_UPDATE_FINALIZE_SECRET;
}

export function isLoopbackAddress(address: string | undefined): boolean {
  if (typeof address !== 'string') {
    return false;
  }

  const normalizedAddress = address.trim();
  return (
    normalizedAddress === '127.0.0.1' ||
    normalizedAddress === '::1' ||
    normalizedAddress.startsWith('127.') ||
    normalizedAddress.startsWith('::ffff:127.')
  );
}

function getFinalizeRequestBody(
  req: Request,
): Required<Pick<FinalizeSelfUpdateBody, 'operationId' | 'status'>> &
  Pick<FinalizeSelfUpdateBody, 'phase' | 'lastError'> {
  const body = (req.body || {}) as FinalizeSelfUpdateBody;
  return {
    operationId: body.operationId,
    status: body.status,
    phase: body.phase,
    lastError: body.lastError,
  };
}

export function createFinalizeSelfUpdateHandler() {
  return function finalizeSelfUpdate(req: Request, res: Response): void {
    if (!isLoopbackAddress(req.socket?.remoteAddress)) {
      sendErrorResponse(res, 403, 'Loopback access required');
      return;
    }
    if (!secretsMatch(SELF_UPDATE_FINALIZE_SECRET, getFinalizeSecretHeaderValue(req))) {
      sendErrorResponse(res, 403, 'Valid self-update finalize secret required');
      return;
    }

    const body = getFinalizeRequestBody(req);
    const operationId = String(body.operationId || '').trim();
    if (!operationId) {
      sendErrorResponse(res, 400, 'operationId is required');
      return;
    }
    if (!isTerminalContainerUpdateOperationStatus(body.status)) {
      sendErrorResponse(res, 400, 'status must be a terminal update-operation status');
      return;
    }
    if (
      body.phase !== undefined &&
      !isTerminalContainerUpdateOperationPhaseForStatus(body.status, body.phase)
    ) {
      sendErrorResponse(res, 400, 'phase must be valid for the supplied terminal status');
      return;
    }

    const operation = updateOperationStore.getOperationById(operationId);
    if (!operation) {
      sendErrorResponse(res, 404, 'Update operation not found');
      return;
    }
    if (operation.kind !== 'self-update') {
      sendErrorResponse(res, 409, 'Update operation is not a self-update operation');
      return;
    }
    if (
      operation.status === 'succeeded' ||
      operation.status === 'rolled-back' ||
      operation.status === 'failed'
    ) {
      res.status(202).json({
        status: 'ignored',
        operationId,
        reason: 'already-terminal',
      });
      return;
    }

    const lastError =
      typeof body.lastError === 'string' && body.lastError.trim() !== ''
        ? body.lastError.trim()
        : undefined;

    switch (body.status) {
      case 'succeeded': {
        const phase =
          body.phase !== undefined
            ? (body.phase as SucceededContainerUpdateOperationPhase)
            : undefined;
        updateOperationStore.markOperationTerminal(operationId, {
          status: 'succeeded',
          ...(phase ? { phase } : {}),
          ...(lastError ? { lastError } : {}),
        });
        break;
      }
      case 'rolled-back': {
        const phase =
          body.phase !== undefined
            ? (body.phase as RolledBackContainerUpdateOperationPhase)
            : undefined;
        updateOperationStore.markOperationTerminal(operationId, {
          status: 'rolled-back',
          ...(phase ? { phase } : {}),
          ...(lastError ? { lastError } : {}),
        });
        break;
      }
      case 'failed': {
        const phase =
          body.phase !== undefined
            ? (body.phase as FailedContainerUpdateOperationPhase)
            : undefined;
        updateOperationStore.markOperationTerminal(operationId, {
          status: 'failed',
          ...(phase ? { phase } : {}),
          ...(lastError ? { lastError } : {}),
        });
        break;
      }
    }

    res.status(202).json({
      status: 'accepted',
      operationId,
    });
  };
}

export function init(): express.Router {
  const router = express.Router();
  router.post('/self-update/finalize', createFinalizeSelfUpdateHandler());
  return router;
}
