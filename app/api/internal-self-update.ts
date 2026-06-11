import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import express from 'express';
import {
  type ExpiredContainerUpdateOperationPhase,
  type FailedContainerUpdateOperationPhase,
  isTerminalContainerUpdateOperationPhaseForStatus,
  isTerminalContainerUpdateOperationStatus,
  type RolledBackContainerUpdateOperationPhase,
  type SucceededContainerUpdateOperationPhase,
  type TerminalContainerUpdateOperationPhase,
  type TerminalContainerUpdateOperationStatus,
} from '../model/container-update-operation.js';
import * as updateOperationStore from '../store/update-operation.js';
import { sendErrorResponse } from './error-response.js';

export const SELF_UPDATE_FINALIZE_SECRET_HEADER = 'x-dd-self-update-secret';

const SELF_UPDATE_FINALIZE_SECRET = crypto.randomBytes(32).toString('hex');

// Per-operation finalize secrets. Key = operationId, value = plaintext secret.
// Populated by issueSelfUpdateFinalizeSecret; cleaned up after finalization.
const operationFinalizeSecrets = new Map<string, string>();

type FinalizeSelfUpdateBody = {
  operationId?: unknown;
  status?: unknown;
  phase?: unknown;
  lastError?: unknown;
};

type FinalizeSelfUpdateRequest = {
  operationId: string;
  status: TerminalContainerUpdateOperationStatus;
  phase?: TerminalContainerUpdateOperationPhase;
  lastError?: string;
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

export function issueSelfUpdateFinalizeSecret(operationId: string): {
  secret: string;
  secretHash: string;
} {
  const secret = crypto.randomBytes(32).toString('hex');
  const secretHash = crypto.createHash('sha256').update(secret).digest('hex');
  operationFinalizeSecrets.set(operationId, secret);
  return { secret, secretHash };
}

export function getSelfUpdateFinalizeSecretForOperation(operationId: string): string {
  return operationFinalizeSecrets.get(operationId) ?? SELF_UPDATE_FINALIZE_SECRET;
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

function trimNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmedValue = value.trim();
  return trimmedValue !== '' ? trimmedValue : undefined;
}

function validateFinalizeRequestBody(
  body: ReturnType<typeof getFinalizeRequestBody>,
  res: Response,
): FinalizeSelfUpdateRequest | undefined {
  const operationId = String(body.operationId || '').trim();
  if (!operationId) {
    sendErrorResponse(res, 400, 'operationId is required');
    return undefined;
  }
  if (!isTerminalContainerUpdateOperationStatus(body.status)) {
    sendErrorResponse(res, 400, 'status must be a terminal update-operation status');
    return undefined;
  }
  if (
    body.phase !== undefined &&
    !isTerminalContainerUpdateOperationPhaseForStatus(body.status, body.phase)
  ) {
    sendErrorResponse(res, 400, 'phase must be valid for the supplied terminal status');
    return undefined;
  }

  const lastError = trimNonEmptyString(body.lastError);

  return {
    operationId,
    status: body.status,
    ...(body.phase !== undefined
      ? { phase: body.phase as TerminalContainerUpdateOperationPhase }
      : {}),
    ...(lastError ? { lastError } : {}),
  };
}

function applyFinalizeTerminalPatch(body: FinalizeSelfUpdateRequest): void {
  const lastErrorPatch = body.lastError ? { lastError: body.lastError } : {};
  switch (body.status) {
    case 'succeeded':
      updateOperationStore.markOperationTerminal(body.operationId, {
        status: 'succeeded',
        ...(body.phase ? { phase: body.phase as SucceededContainerUpdateOperationPhase } : {}),
        ...lastErrorPatch,
      });
      return;
    case 'rolled-back':
      updateOperationStore.markOperationTerminal(body.operationId, {
        status: 'rolled-back',
        ...(body.phase ? { phase: body.phase as RolledBackContainerUpdateOperationPhase } : {}),
        ...lastErrorPatch,
      });
      return;
    case 'failed':
      updateOperationStore.markOperationTerminal(body.operationId, {
        status: 'failed',
        ...(body.phase ? { phase: body.phase as FailedContainerUpdateOperationPhase } : {}),
        ...lastErrorPatch,
      });
      return;
    case 'expired':
      updateOperationStore.markOperationTerminal(body.operationId, {
        status: 'expired',
        ...(body.phase ? { phase: body.phase as ExpiredContainerUpdateOperationPhase } : {}),
        ...lastErrorPatch,
      });
      return;
  }
}

function findFinalizeSelfUpdateOperation(operationId: string, res: Response) {
  const operation = updateOperationStore.getOperationById(operationId);
  if (!operation) {
    sendErrorResponse(res, 404, 'Update operation not found');
    return undefined;
  }
  if (operation.kind !== 'self-update') {
    sendErrorResponse(res, 409, 'Update operation is not a self-update operation');
    return undefined;
  }

  return operation;
}

function isAlreadyTerminalOperation(operation: { status: string }): boolean {
  return (
    operation.status === 'succeeded' ||
    operation.status === 'rolled-back' ||
    operation.status === 'failed' ||
    operation.status === 'expired'
  );
}

export function createFinalizeSelfUpdateHandler() {
  return function finalizeSelfUpdate(req: Request, res: Response): void {
    if (!isLoopbackAddress(req.socket?.remoteAddress)) {
      sendErrorResponse(res, 403, 'Loopback access required');
      return;
    }

    const body = validateFinalizeRequestBody(getFinalizeRequestBody(req), res);
    if (!body) {
      return;
    }

    const operation = findFinalizeSelfUpdateOperation(body.operationId, res);
    if (!operation) {
      return;
    }

    const providedSecret = getFinalizeSecretHeaderValue(req);
    const storedHash =
      typeof (operation as { finalizeSecretHash?: unknown }).finalizeSecretHash === 'string' &&
      (operation as { finalizeSecretHash: string }).finalizeSecretHash.trim() !== ''
        ? (operation as { finalizeSecretHash: string }).finalizeSecretHash
        : undefined;

    if (storedHash) {
      // Validate by comparing sha256(providedSecret) against the stored hash.
      if (!providedSecret) {
        sendErrorResponse(res, 403, 'Valid self-update finalize secret required');
        return;
      }
      const providedHash = crypto.createHash('sha256').update(providedSecret).digest('hex');
      const storedHashBuffer = Buffer.from(storedHash, 'utf8');
      const providedHashBuffer = Buffer.from(providedHash, 'utf8');
      if (
        storedHashBuffer.length !== providedHashBuffer.length ||
        !crypto.timingSafeEqual(storedHashBuffer, providedHashBuffer)
      ) {
        sendErrorResponse(res, 403, 'Valid self-update finalize secret required');
        return;
      }
    } else {
      // Legacy: row without a stored hash — fall back to process-level secret.
      if (!secretsMatch(SELF_UPDATE_FINALIZE_SECRET, providedSecret)) {
        sendErrorResponse(res, 403, 'Valid self-update finalize secret required');
        return;
      }
    }

    if (isAlreadyTerminalOperation(operation)) {
      operationFinalizeSecrets.delete(body.operationId);
      res.status(202).json({
        status: 'ignored',
        operationId: body.operationId,
        reason: 'already-terminal',
      });
      return;
    }

    applyFinalizeTerminalPatch(body);
    operationFinalizeSecrets.delete(body.operationId);

    res.status(202).json({
      status: 'accepted',
      operationId: body.operationId,
    });
  };
}

export function init(): express.Router {
  const router = express.Router();
  router.post('/self-update/finalize', createFinalizeSelfUpdateHandler());
  return router;
}
