import { Counter, Gauge, Histogram, register } from 'prom-client';

export type AuthLoginOutcome = 'success' | 'invalid' | 'locked' | 'error';
export type AuthProvider = 'basic' | 'oidc';

const METRIC_LOGIN_TOTAL = 'drydock_auth_login_total';
const METRIC_LOGIN_DURATION = 'drydock_auth_login_duration_seconds';
const METRIC_USERNAME_MISMATCH = 'drydock_auth_username_mismatch_total';
const METRIC_ACCOUNT_LOCKED = 'drydock_auth_account_locked_total';
const METRIC_IP_LOCKED = 'drydock_auth_ip_locked_total';
// API key authentication failures. The audit trail records at most one entry
// per source key per minute so a sprayer cannot fill the collection; this
// counter takes every attempt, including the suppressed ones, so the audit
// throttle never hides the volume of an attack.
const METRIC_API_KEY_FAILURE = 'drydock_auth_api_key_failure_total';

let authLoginCounter: Counter<string> | undefined;
let authLoginDurationHistogram: Histogram<string> | undefined;
let authUsernameMismatchCounter: Counter<string> | undefined;
let authAccountLockedGauge: Gauge<string> | undefined;
let authIpLockedGauge: Gauge<string> | undefined;
let authApiKeyFailureCounter: Counter<string> | undefined;

export function init() {
  if (authLoginCounter) {
    register.removeSingleMetric(METRIC_LOGIN_TOTAL);
  }
  authLoginCounter = new Counter({
    name: METRIC_LOGIN_TOTAL,
    help: 'Authentication login attempts by outcome and provider',
    labelNames: ['outcome', 'provider'],
  });

  if (authLoginDurationHistogram) {
    register.removeSingleMetric(METRIC_LOGIN_DURATION);
  }
  authLoginDurationHistogram = new Histogram({
    name: METRIC_LOGIN_DURATION,
    help: 'Authentication login verification duration by outcome and provider',
    labelNames: ['outcome', 'provider'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  });

  if (authUsernameMismatchCounter) {
    register.removeSingleMetric(METRIC_USERNAME_MISMATCH);
  }
  authUsernameMismatchCounter = new Counter({
    name: METRIC_USERNAME_MISMATCH,
    help: 'Authentication username mismatches detected during login verification',
  });

  if (authAccountLockedGauge) {
    register.removeSingleMetric(METRIC_ACCOUNT_LOCKED);
  }
  authAccountLockedGauge = new Gauge({
    name: METRIC_ACCOUNT_LOCKED,
    help: 'Current number of locked accounts',
  });

  if (authIpLockedGauge) {
    register.removeSingleMetric(METRIC_IP_LOCKED);
  }
  authIpLockedGauge = new Gauge({
    name: METRIC_IP_LOCKED,
    help: 'Current number of locked IPs',
  });

  if (authApiKeyFailureCounter) {
    register.removeSingleMetric(METRIC_API_KEY_FAILURE);
  }
  authApiKeyFailureCounter = new Counter({
    name: METRIC_API_KEY_FAILURE,
    help: 'API key authentication failures, including those suppressed by the audit throttle',
  });
}

export function getAuthLoginCounter() {
  return authLoginCounter;
}

export function getAuthLoginDurationHistogram() {
  return authLoginDurationHistogram;
}

export function getAuthUsernameMismatchCounter() {
  return authUsernameMismatchCounter;
}

export function getAuthAccountLockedGauge() {
  return authAccountLockedGauge;
}

export function getAuthIpLockedGauge() {
  return authIpLockedGauge;
}

export function recordAuthLogin(outcome: AuthLoginOutcome, provider: AuthProvider): void {
  authLoginCounter?.inc({ outcome, provider });
}

export function observeAuthLoginDuration(
  outcome: AuthLoginOutcome,
  provider: AuthProvider,
  durationSeconds: number,
): void {
  authLoginDurationHistogram?.observe({ outcome, provider }, durationSeconds);
}

export function getAuthApiKeyFailureCounter() {
  return authApiKeyFailureCounter;
}

export function recordAuthUsernameMismatch(): void {
  authUsernameMismatchCounter?.inc();
}

export function recordAuthApiKeyFailure(): void {
  authApiKeyFailureCounter?.inc();
}

export function setAuthAccountLockedTotal(total: number): void {
  authAccountLockedGauge?.set(total);
}

export function setAuthIpLockedTotal(total: number): void {
  authIpLockedGauge?.set(total);
}

export function _resetAuthPrometheusStateForTests(): void {
  if (authLoginCounter) {
    register.removeSingleMetric(METRIC_LOGIN_TOTAL);
  }
  if (authLoginDurationHistogram) {
    register.removeSingleMetric(METRIC_LOGIN_DURATION);
  }
  if (authUsernameMismatchCounter) {
    register.removeSingleMetric(METRIC_USERNAME_MISMATCH);
  }
  if (authAccountLockedGauge) {
    register.removeSingleMetric(METRIC_ACCOUNT_LOCKED);
  }
  if (authIpLockedGauge) {
    register.removeSingleMetric(METRIC_IP_LOCKED);
  }
  if (authApiKeyFailureCounter) {
    register.removeSingleMetric(METRIC_API_KEY_FAILURE);
  }

  authLoginCounter = undefined;
  authLoginDurationHistogram = undefined;
  authUsernameMismatchCounter = undefined;
  authAccountLockedGauge = undefined;
  authIpLockedGauge = undefined;
  authApiKeyFailureCounter = undefined;
}
