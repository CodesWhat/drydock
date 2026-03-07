import { STATUS_CODES } from 'node:http';
import type { NextFunction, Request, Response } from 'express';

type ErrorDetails = Record<string, unknown>;

type SendErrorResponseOptions = {
  details?: ErrorDetails;
  message?: string;
};

const STATUS_TO_ERROR_CODE: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'TOO_MANY_REQUESTS',
  500: 'INTERNAL_SERVER_ERROR',
  501: 'NOT_IMPLEMENTED',
  502: 'BAD_GATEWAY',
  503: 'SERVICE_UNAVAILABLE',
};

const MESSAGE_TO_ERROR_CODE: Record<string, string> = {
  'action is required': 'ACTION_REQUIRED',
  'agent is not connected': 'AGENT_NOT_CONNECTED',
  'agent not found': 'AGENT_NOT_FOUND',
  'backup not found for this container': 'BACKUP_NOT_FOUND',
  'component not found': 'COMPONENT_NOT_FOUND',
  'container actions are disabled': 'CONTAINER_ACTIONS_DISABLED',
  'container not found': 'CONTAINER_NOT_FOUND',
  'content-type must be application/json': 'INVALID_CONTENT_TYPE',
  'csrf validation failed': 'CSRF_VALIDATION_FAILED',
  'internal server error': 'INTERNAL_SERVER_ERROR',
  'invalid component query parameter': 'INVALID_COMPONENT_QUERY_PARAMETER',
  'invalid level query parameter': 'INVALID_LEVEL_QUERY_PARAMETER',
  'no docker trigger found for this container': 'DOCKER_TRIGGER_NOT_FOUND',
  'no update available for this container': 'NO_UPDATE_AVAILABLE',
  'notification rule not found': 'NOTIFICATION_RULE_NOT_FOUND',
  'route not found': 'ROUTE_NOT_FOUND',
  'security scanner is not configured': 'SECURITY_SCANNER_NOT_CONFIGURED',
  unauthorized: 'UNAUTHORIZED',
};

function getErrorCodeFromMessage(message: string): string | undefined {
  const normalizedMessage = message.trim().toLowerCase();
  return MESSAGE_TO_ERROR_CODE[normalizedMessage];
}

function deriveErrorCode(statusCode: number, message: string): string {
  const messageCode = getErrorCodeFromMessage(message);
  if (messageCode) return messageCode;
  return STATUS_TO_ERROR_CODE[statusCode] ?? 'ERROR';
}

function toErrorResponseBody({
  code,
  details,
  message,
}: {
  code: string;
  details?: ErrorDetails;
  message: string;
}) {
  return {
    error: message,
    code,
    message,
    ...(details ? { details } : {}),
  };
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeLegacyErrorBody(statusCode: number, body: unknown): unknown {
  if (statusCode < 400 || !isRecord(body) || typeof body.error !== 'string') {
    return body;
  }

  const message = typeof body.message === 'string' ? body.message : body.error;
  const code = typeof body.code === 'string' ? body.code : deriveErrorCode(statusCode, message);
  const details = isRecord(body.details) ? body.details : undefined;

  return {
    ...body,
    ...toErrorResponseBody({
      code,
      details,
      message,
    }),
  };
}

export function normalizeErrorResponsePayload(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  const originalJson = res.json.bind(res);

  res.json = ((body: unknown) => {
    const normalizedBody = normalizeLegacyErrorBody(res.statusCode, body);
    return originalJson(normalizedBody);
  }) as typeof res.json;

  next();
}
