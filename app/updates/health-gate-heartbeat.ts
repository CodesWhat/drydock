/**
 * Health-gate SSE heartbeat.
 *
 * While an update lifecycle waits for a new container to pass its health
 * gate, the backend goes silent on the SSE pipeline for the entire wait.
 * For images with long healthcheck intervals the UI receives no events
 * between `phase: 'health-gate'` (start of wait) and
 * `phase: 'health-gate-passed'` (end of wait).
 *
 * This module emits periodic `dd:update-operation-changed` heartbeats
 * so that the UI stays informed in near-real-time and REST reconciliation
 * is not on the critical path.
 */

const DEFAULT_HEALTH_GATE_HEARTBEAT_MS = 10_000;
const MIN_HEALTH_GATE_HEARTBEAT_MS = 1_000;

/**
 * Parse DD_UPDATE_HEALTH_GATE_HEARTBEAT_MS from the environment.
 *
 * Returns `null` when the variable is absent, empty, or `"0"` (opt-out).
 * Returns the parsed positive integer (≥ 1000) when a valid interval is set.
 * Throws a descriptive Error for invalid values so the process fails fast at
 * startup rather than silently ignoring operator intent.
 */
export function parseHealthGateHeartbeatMs(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '' || raw.trim() === '0') {
    return null;
  }
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(
      `DD_UPDATE_HEALTH_GATE_HEARTBEAT_MS must be a non-negative integer (got "${raw}")`,
    );
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(
      `DD_UPDATE_HEALTH_GATE_HEARTBEAT_MS must be a non-negative integer (got "${raw}")`,
    );
  }
  // parsed === 0 is already handled by the trim check above, so parsed >= 1 here.
  if (parsed < MIN_HEALTH_GATE_HEARTBEAT_MS) {
    throw new Error(
      `DD_UPDATE_HEALTH_GATE_HEARTBEAT_MS must be at least ${MIN_HEALTH_GATE_HEARTBEAT_MS} (got "${raw}")`,
    );
  }
  return parsed;
}

const _rawHeartbeatMs = parseHealthGateHeartbeatMs(process.env.DD_UPDATE_HEALTH_GATE_HEARTBEAT_MS);

export const HEALTH_GATE_HEARTBEAT_MS: number | null =
  _rawHeartbeatMs !== null ? _rawHeartbeatMs : DEFAULT_HEALTH_GATE_HEARTBEAT_MS;

export type HeartbeatEmitFn = (operationId: string) => void;

/**
 * Start a heartbeat that calls `emitHeartbeat(operationId)` every
 * `heartbeatMs` milliseconds.
 *
 * Returns a cancel function that stops the heartbeat immediately. The
 * caller MUST invoke the cancel function before (or immediately after) the
 * wait resolves — whether via success, failure, or rollback — so that the
 * heartbeat cannot race a real terminal event.
 *
 * When `heartbeatMs` is `null` the heartbeat is disabled; the cancel
 * function is a no-op.
 */
export function startHealthGateHeartbeat(
  operationId: string,
  emitHeartbeat: HeartbeatEmitFn,
  heartbeatMs: number | null = HEALTH_GATE_HEARTBEAT_MS,
): () => void {
  if (heartbeatMs === null) {
    return () => undefined;
  }

  const timer = setInterval(() => {
    emitHeartbeat(operationId);
  }, heartbeatMs);

  return () => {
    clearInterval(timer);
  };
}
