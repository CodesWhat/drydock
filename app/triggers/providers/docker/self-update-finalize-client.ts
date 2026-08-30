import http from 'node:http';
import https from 'node:https';
import { SELF_UPDATE_FINALIZE_SECRET_HEADER } from '../../../api/internal-self-update.js';
import { sleep } from '../../../util/sleep.js';

export type SelfUpdateFinalizeClientConfig = {
  finalizeUrl: string;
  finalizeSecret: string;
  operationId: string;
  status: string;
  phase?: string;
  lastError?: string;
  timeoutMs: number;
  retryIntervalMs: number;
};

const MAX_FINALIZE_REQUEST_TIMEOUT_MS = 5_000;

export function postFinalizeCallback(config: SelfUpdateFinalizeClientConfig): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const url = new URL(config.finalizeUrl);
    const requestBody = JSON.stringify({
      operationId: config.operationId,
      status: config.status,
      ...(config.phase ? { phase: config.phase } : {}),
      ...(config.lastError ? { lastError: config.lastError } : {}),
    });
    const requestOptions: http.RequestOptions & https.RequestOptions = {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(requestBody),
        [SELF_UPDATE_FINALIZE_SECRET_HEADER]: config.finalizeSecret,
      },
    };

    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.request(requestOptions, (response) => {
      response.resume();
      response.once('end', () => {
        if ((response.statusCode || 500) >= 200 && (response.statusCode || 500) < 300) {
          resolve();
          return;
        }
        reject(new Error(`Finalize callback rejected with status ${response.statusCode || 500}`));
      });
    });
    const requestTimeoutMs = Math.min(config.timeoutMs, MAX_FINALIZE_REQUEST_TIMEOUT_MS);
    request.setTimeout?.(requestTimeoutMs, () => {
      request.destroy(new Error(`Finalize callback request timed out after ${requestTimeoutMs}ms`));
    });
    request.once('error', reject);
    request.write(requestBody);
    request.end();
  });
}

export async function finalizeSelfUpdateOperation(
  config: SelfUpdateFinalizeClientConfig,
): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown;
  while (Date.now() - startedAt < config.timeoutMs) {
    try {
      await postFinalizeCallback(config);
      return;
    } catch (error: unknown) {
      lastError = error;
      await sleep(config.retryIntervalMs);
    }
  }
  throw lastError || new Error('Timed out waiting for self-update finalize callback');
}
