import { STATUS_CODES } from 'node:http';
import type { Response } from 'express';

export function sendErrorResponse(
  res: Response,
  statusCode: number,
  message?: string | undefined,
): void {
  res.status(statusCode).json({
    error: message ?? STATUS_CODES[statusCode] ?? 'Error',
  });
}
