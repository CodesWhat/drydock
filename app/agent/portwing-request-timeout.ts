/**
 * Controller half of the Portwing `dd:request-timeout` contract.
 *
 * The hint is advisory and only ever sent to an agent that advertised the
 * capability. The controller arms its own timer at hint + 5 s so the agent's
 * coded `request_timeout` error wins the race over a generic local timeout.
 */
export const CAPABILITY_REQUEST_TIMEOUT = 'dd:request-timeout';
export const CAPABILITY_CANCEL = 'dd:cancel';
export const TIMEOUT_HINT_HEADER = 'X-Portwing-Timeout-Ms';

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const MIN_TIMEOUT_HINT_MS = 1_000;
const MAX_TIMEOUT_HINT_MS = 900_000;
const TIMEOUT_HINT_MARGIN_MS = 5_000;
const STOP_GRACE_MS = 15_000;

export function clampTimeoutHintMs(hintMs: number): number {
  return Math.min(MAX_TIMEOUT_HINT_MS, Math.max(MIN_TIMEOUT_HINT_MS, Math.trunc(hintMs)));
}

/** Controller-side timer: hint + 5 s, or the 30 s default without a hint. */
export function controllerTimeoutForHint(hintMs: number | undefined): number {
  return hintMs === undefined
    ? DEFAULT_REQUEST_TIMEOUT_MS
    : clampTimeoutHintMs(hintMs) + TIMEOUT_HINT_MARGIN_MS;
}

/**
 * Per-request timeout hint for the long Docker calls: stop/restart with `t`,
 * wait, image load, archive upload and prune. Returns undefined when the 30 s
 * default is enough.
 */
export function longRequestTimeoutHintMs(method: string, target: string): number | undefined {
  const [rawPath, query = ''] = target.split('?', 2);
  const path = rawPath.replace(/\/+$/, '');
  const verb = method.toUpperCase();
  if (verb === 'PUT') {
    return /\/containers\/[^/]+\/archive$/.test(path) ? MAX_TIMEOUT_HINT_MS : undefined;
  }
  if (verb !== 'POST') {
    return undefined;
  }
  if (/\/containers\/[^/]+\/(stop|restart)$/.test(path)) {
    const raw = new URLSearchParams(query).get('t');
    if (raw === null || !/^-?\d+$/.test(raw)) {
      return undefined;
    }
    const seconds = Number(raw);
    if (seconds < 0) {
      return MAX_TIMEOUT_HINT_MS;
    }
    const hint = seconds * 1000 + STOP_GRACE_MS;
    return hint > DEFAULT_REQUEST_TIMEOUT_MS - TIMEOUT_HINT_MARGIN_MS
      ? clampTimeoutHintMs(hint)
      : undefined;
  }
  if (
    /\/containers\/[^/]+\/wait$/.test(path) ||
    /\/images\/load$/.test(path) ||
    /\/prune$/.test(path)
  ) {
    return MAX_TIMEOUT_HINT_MS;
  }
  return undefined;
}
