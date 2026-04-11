import http from 'node:http';
import https from 'node:https';
import { SELF_UPDATE_FINALIZE_SECRET_HEADER } from '../../../api/internal-self-update.js';
import { getErrorMessage } from '../../../util/error.js';
import { toPositiveInteger } from '../../../util/parse.js';
import { sleep } from '../../../util/sleep.js';

const DEFAULT_FINALIZE_TIMEOUT_MS = 30_000;
const DEFAULT_FINALIZE_RETRY_INTERVAL_MS = 500;

type FinalizeConfig = {
  finalizeUrl: string;
  finalizeSecret: string;
  operationId: string;
  status: string;
  phase?: string;
  lastError?: string;
  timeoutMs: number;
  retryIntervalMs: number;
};

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function readFinalizeConfigFromEnv(): FinalizeConfig {
  return {
    finalizeUrl: getRequiredEnv('DD_SELF_UPDATE_FINALIZE_URL'),
    finalizeSecret: getRequiredEnv('DD_SELF_UPDATE_FINALIZE_SECRET'),
    operationId: getRequiredEnv('DD_SELF_UPDATE_OPERATION_ID'),
    status: getRequiredEnv('DD_SELF_UPDATE_STATUS'),
    phase: process.env.DD_SELF_UPDATE_PHASE?.trim() || undefined,
    lastError: process.env.DD_SELF_UPDATE_LAST_ERROR?.trim() || undefined,
    timeoutMs: toPositiveInteger(
      process.env.DD_SELF_UPDATE_FINALIZE_TIMEOUT_MS,
      DEFAULT_FINALIZE_TIMEOUT_MS,
    ),
    retryIntervalMs: toPositiveInteger(
      process.env.DD_SELF_UPDATE_FINALIZE_RETRY_INTERVAL_MS,
      DEFAULT_FINALIZE_RETRY_INTERVAL_MS,
    ),
  };
}

function postFinalizeCallback(config: FinalizeConfig): Promise<void> {
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

    request.once('error', reject);
    request.write(requestBody);
    request.end();
  });
}

export async function runSelfUpdateFinalizeEntrypoint(): Promise<void> {
  const config = readFinalizeConfigFromEnv();
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

void runSelfUpdateFinalizeEntrypoint().catch((error: unknown) => {
  globalThis.console.error(
    `[self-update-finalize] callback failed: ${getErrorMessage(error, String(error))}`,
  );
  process.exitCode = 1;
});
