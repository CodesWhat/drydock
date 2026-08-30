import { getErrorMessage } from '../../../util/error.js';
import { toPositiveInteger } from '../../../util/parse.js';
import { finalizeSelfUpdateOperation } from './self-update-finalize-client.js';

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

export async function runSelfUpdateFinalizeEntrypoint(): Promise<void> {
  const config = readFinalizeConfigFromEnv();
  await finalizeSelfUpdateOperation(config);
}

void runSelfUpdateFinalizeEntrypoint().catch((error: unknown) => {
  globalThis.console.error(
    `[self-update-finalize] callback failed: ${getErrorMessage(error, String(error))}`,
  );
  process.exitCode = 1;
});
