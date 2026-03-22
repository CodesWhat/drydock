import type { Request, Response } from 'express';
import express from 'express';
import nocache from 'nocache';
import { collectDebugDump, getDebugDumpFilename, serializeDebugDump } from '../debug/dump.js';
import { sendErrorResponse } from './error-response.js';

const router = express.Router();

function parseRecentMinutes(rawValue: unknown): number {
  const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
  if (typeof value !== 'string') {
    return 30;
  }
  const parsedValue = Number.parseInt(value, 10);
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return 30;
  }
  return parsedValue;
}

async function getDebugDump(req: Request, res: Response): Promise<void> {
  try {
    const recentMinutes = parseRecentMinutes(req.query.minutes);
    const dump = await collectDebugDump({
      recentMinutes,
    });
    const dumpBody = serializeDebugDump(dump);

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${getDebugDumpFilename()}"`);
    res.status(200).send(dumpBody);
  } catch {
    sendErrorResponse(res, 500, 'Unable to generate debug dump');
  }
}

export function init() {
  router.use(nocache());
  router.get('/dump', getDebugDump);
  return router;
}
