import { STATUS_CODES } from 'node:http';
import type { Response } from 'express';

type ErrorDetails = Record<string, unknown>;

type SendErrorResponseOptions = {
  details?: ErrorDetails;
  message?: string;
};

function normalizeSendErrorResponseOptions(
  messageOrOptions?: SendErrorResponseOptions | string | undefined,
): SendErrorResponseOptions {
  if (typeof messageOrOptions === 'string') {
    return { message: messageOrOptions };
  }
  return messageOrOptions ?? {};
}

export function sendErrorResponse(
  res: Response,
  statusCode: number,
  messageOrOptions?: SendErrorResponseOptions | string | undefined,
): void {
  const { details, message } = normalizeSendErrorResponseOptions(messageOrOptions);
  const resolvedMessage = message ?? STATUS_CODES[statusCode] ?? 'Error';
  res.status(statusCode).json({
    error: resolvedMessage,
    ...(details ? { details } : {}),
  });
}
