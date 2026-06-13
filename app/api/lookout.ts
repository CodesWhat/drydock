/**
 * Lookout pubkey management REST API.
 *
 * Mounted at /api/v1/lookout (and /api/lookout) AFTER requireAuthentication
 * + requireSameOriginForMutations in api.ts. Operators use these routes to
 * manage which Ed25519 public keys are authorized for edge agent connections.
 */
import express, { type Request, type Response } from 'express';
import * as agentKeys from '../store/agent-keys.js';
import { sendErrorResponse } from './error-response.js';

const router = express.Router();

/**
 * GET /lookout/keys
 * List all keys (active + revoked).
 */
router.get('/keys', (_req: Request, res: Response) => {
  const keys = agentKeys.listKeys();
  res.json(keys);
});

/**
 * POST /lookout/keys
 * Add a new authorized key.
 * Body: { pubkeyBase64: string, label: string }
 * Returns 201 { keyId, label, createdAt }
 */
router.post('/keys', (req: Request, res: Response) => {
  const { pubkeyBase64, label } = req.body as { pubkeyBase64?: unknown; label?: unknown };

  if (typeof pubkeyBase64 !== 'string' || !pubkeyBase64) {
    sendErrorResponse(res, 400, 'pubkeyBase64 must be a non-empty string');
    return;
  }

  if (typeof label !== 'string' || !label) {
    sendErrorResponse(res, 400, 'label must be a non-empty string');
    return;
  }

  let pubkeyBuffer: Buffer;
  try {
    pubkeyBuffer = Buffer.from(pubkeyBase64, 'base64');
    // Verify it actually decoded (empty base64 or non-base64)
    if (pubkeyBuffer.length === 0) {
      sendErrorResponse(res, 400, 'pubkeyBase64 does not decode to any bytes');
      return;
    }
  } catch {
    sendErrorResponse(res, 400, 'pubkeyBase64 is not valid base64');
    return;
  }

  if (pubkeyBuffer.length !== 32) {
    sendErrorResponse(
      res,
      400,
      `Ed25519 public key must be exactly 32 bytes; got ${pubkeyBuffer.length}`,
    );
    return;
  }

  let record: agentKeys.AgentKeyRecord;
  try {
    record = agentKeys.addKey(pubkeyBuffer, label);
  } catch (error: unknown) {
    sendErrorResponse(res, 409, String(error));
    return;
  }

  res.status(201).json({
    keyId: record.keyId,
    label: record.label,
    createdAt: record.createdAt,
  });
});

/**
 * DELETE /lookout/keys/:keyId
 * Revoke a key. Returns 204 on success, 404 if not found.
 */
router.delete('/keys/:keyId', (req: Request, res: Response) => {
  const { keyId } = req.params as { keyId: string };
  const revoked = agentKeys.revokeKey(keyId);
  if (!revoked) {
    sendErrorResponse(res, 404, `Key ${keyId} not found`);
    return;
  }
  res.status(204).send();
});

/**
 * Init the lookout router.
 */
export function init(): express.Router {
  return router;
}
