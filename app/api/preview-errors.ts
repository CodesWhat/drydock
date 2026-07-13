import type { Response } from 'express';
import type { Container } from '../model/container.js';
import { scrubAuthorizationHeaderValues } from '../util/auth-redaction.js';
import { getErrorMessage } from '../util/error.js';

export type PreviewErrorCode =
  | 'container-not-found'
  | 'container-runtime-not-found'
  | 'manifest-fetch-failed'
  | 'no-trigger-configured'
  | 'preview-runtime-error'
  | 'registry-auth-failed'
  | 'registry-network-error'
  | 'registry-not-found';

export interface PreviewErrorAction {
  label: string;
  href: '/registries' | '/triggers';
}

export interface PreviewErrorPayload {
  code: PreviewErrorCode;
  message: string;
  details?: {
    reason: string;
    registry?: string;
  };
  action?: PreviewErrorAction;
}

interface ErrorLike {
  code?: unknown;
  status?: unknown;
  statusCode?: unknown;
  response?: { status?: unknown };
}

const NETWORK_ERROR_CODES = new Set([
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENETUNREACH',
  'ENOTFOUND',
  'ETIMEDOUT',
]);

const REGISTRY_ACTION: PreviewErrorAction = {
  label: 'Open registry settings',
  href: '/registries',
};

export const TRIGGER_ACTION: PreviewErrorAction = {
  label: 'Open trigger settings',
  href: '/triggers',
};

function asErrorLike(error: unknown): ErrorLike {
  return error && typeof error === 'object' ? (error as ErrorLike) : {};
}

function getHttpStatus(error: unknown): number | undefined {
  const errorLike = asErrorLike(error);
  const candidates = [errorLike.response?.status, errorLike.status, errorLike.statusCode];
  return candidates.find(
    (candidate): candidate is number =>
      typeof candidate === 'number' && candidate >= 400 && candidate <= 599,
  );
}

function getErrorCode(error: unknown): string | undefined {
  const code = asErrorLike(error).code;
  return typeof code === 'string' ? code : undefined;
}

function sanitizeReason(error: unknown): string {
  const withScrubbedHeaders = scrubAuthorizationHeaderValues(getErrorMessage(error));
  return withScrubbedHeaders.replace(/(https?:\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi, '$1[REDACTED]@');
}

function getRegistryHost(container: Container): string | undefined {
  const registryUrl = container.image?.registry?.url;
  if (typeof registryUrl !== 'string' || registryUrl.trim() === '') {
    return undefined;
  }
  const value = registryUrl.trim();
  try {
    return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).host;
  } catch {
    return value.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  }
}

function getImageReference(container: Container, registryHost?: string): string {
  const imageName = typeof container.image?.name === 'string' ? container.image.name : '';
  if (!imageName) {
    return registryHost || 'this image';
  }
  if (!registryHost || imageName.startsWith(`${registryHost}/`)) {
    return imageName;
  }
  return `${registryHost}/${imageName}`;
}

export function classifyPreviewError(
  error: unknown,
  container: Container,
): {
  status: number;
  payload: PreviewErrorPayload;
} {
  const reason = sanitizeReason(error);
  const registry = getRegistryHost(container);
  const details = { reason, ...(registry ? { registry } : {}) };
  const errorCode = getErrorCode(error);
  const status = getHttpStatus(error);

  if (status === 401 || status === 403) {
    return {
      status,
      payload: {
        code: 'registry-auth-failed',
        message: `Authentication failed for ${registry ?? 'the image registry'}: ${status} ${
          status === 401 ? 'Unauthorized' : 'Forbidden'
        }`,
        details,
        action: REGISTRY_ACTION,
      },
    };
  }

  if (
    errorCode === 'registry-manager-unsupported' ||
    errorCode === 'registry-manager-misconfigured'
  ) {
    return {
      status: 422,
      payload: {
        code: 'registry-not-found',
        message: `No matching registry configured for ${getImageReference(container, registry)}`,
        details,
        action: REGISTRY_ACTION,
      },
    };
  }

  if (
    (errorCode && NETWORK_ERROR_CODES.has(errorCode)) ||
    /\b(?:ECONNREFUSED|ENOTFOUND|ETIMEDOUT)\b/i.test(reason)
  ) {
    return {
      status: 503,
      payload: {
        code: 'registry-network-error',
        message: `Unable to reach ${registry ?? 'the container runtime'} while preparing the update preview`,
        details,
        ...(registry ? { action: REGISTRY_ACTION } : {}),
      },
    };
  }

  if (status === 404 || /manifest (?:unknown|not found)/i.test(reason)) {
    return {
      status: 422,
      payload: {
        code: 'manifest-fetch-failed',
        message: `No image manifest was found for ${getImageReference(container, registry)}`,
        details,
        action: REGISTRY_ACTION,
      },
    };
  }

  return {
    status: 500,
    payload: {
      code: 'preview-runtime-error',
      message: 'Unable to prepare this update preview',
      details: { reason },
    },
  };
}

export function sendPreviewError(
  res: Response,
  status: number,
  payload: PreviewErrorPayload,
): void {
  res.status(status).json(payload);
}
