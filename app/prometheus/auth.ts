import { Counter, Gauge, Histogram, register } from 'prom-client';

export type AuthLoginOutcome = 'success' | 'invalid' | 'locked' | 'error';
export type AuthProvider = 'basic' | 'oidc';

let authLoginCounter: Counter<string> | undefined;
let authLoginDurationHistogram: Histogram<string> | undefined;
let authUsernameMismatchCounter: Counter<string> | undefined;
let authAccountLockedGauge: Gauge<string> | undefined;
let authIpLockedGauge: Gauge<string> | undefined;

export function init() {
  if (authLoginCounter) {
    register.removeSingleMetric(authLoginCounter.name);
  }
  authLoginCounter = new Counter({
    name: 'drydock_auth_login_total',
    help: 'Authentication login attempts by outcome and provider',
    labelNames: ['outcome', 'provider'],
  });

  if (authLoginDurationHistogram) {
    register.removeSingleMetric(authLoginDurationHistogram.name);
  }
  authLoginDurationHistogram = new Histogram({
    name: 'drydock_auth_login_duration_seconds',
    help: 'Authentication login verification duration by outcome and provider',
    labelNames: ['outcome', 'provider'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  });

  if (authUsernameMismatchCounter) {
    register.removeSingleMetric(authUsernameMismatchCounter.name);
  }
  authUsernameMismatchCounter = new Counter({
    name: 'drydock_auth_username_mismatch_total',
    help: 'Authentication username mismatches detected during login verification',
  });

  if (authAccountLockedGauge) {
    register.removeSingleMetric(authAccountLockedGauge.name);
  }
  authAccountLockedGauge = new Gauge({
    name: 'drydock_auth_account_locked_total',
    help: 'Current number of locked accounts',
  });

  if (authIpLockedGauge) {
    register.removeSingleMetric(authIpLockedGauge.name);
  }
  authIpLockedGauge = new Gauge({
    name: 'drydock_auth_ip_locked_total',
    help: 'Current number of locked IPs',
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

export function recordAuthUsernameMismatch(): void {
  authUsernameMismatchCounter?.inc();
}

export function setAuthAccountLockedTotal(total: number): void {
  authAccountLockedGauge?.set(total);
}

export function setAuthIpLockedTotal(total: number): void {
  authIpLockedGauge?.set(total);
}

export function _resetAuthPrometheusStateForTests(): void {
  if (authLoginCounter) {
    register.removeSingleMetric(authLoginCounter.name);
  }
  if (authLoginDurationHistogram) {
    register.removeSingleMetric(authLoginDurationHistogram.name);
  }
  if (authUsernameMismatchCounter) {
    register.removeSingleMetric(authUsernameMismatchCounter.name);
  }
  if (authAccountLockedGauge) {
    register.removeSingleMetric(authAccountLockedGauge.name);
  }
  if (authIpLockedGauge) {
    register.removeSingleMetric(authIpLockedGauge.name);
  }

  authLoginCounter = undefined;
  authLoginDurationHistogram = undefined;
  authUsernameMismatchCounter = undefined;
  authAccountLockedGauge = undefined;
  authIpLockedGauge = undefined;
}
