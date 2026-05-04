import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  HEALTH_GATE_HEARTBEAT_MS,
  parseHealthGateHeartbeatMs,
  startHealthGateHeartbeat,
} from './health-gate-heartbeat.js';

describe('parseHealthGateHeartbeatMs', () => {
  test('returns undefined for undefined (absent — use default)', () => {
    expect(parseHealthGateHeartbeatMs(undefined)).toBeUndefined();
  });

  test('returns undefined for empty string (absent — use default)', () => {
    expect(parseHealthGateHeartbeatMs('')).toBeUndefined();
    expect(parseHealthGateHeartbeatMs('   ')).toBeUndefined();
  });

  test('returns null for "0" (explicit disable)', () => {
    expect(parseHealthGateHeartbeatMs('0')).toBeNull();
    expect(parseHealthGateHeartbeatMs('  0  ')).toBeNull();
  });

  test('returns parsed value for valid integer >= 1000', () => {
    expect(parseHealthGateHeartbeatMs('1000')).toBe(1000);
    expect(parseHealthGateHeartbeatMs('10000')).toBe(10000);
    expect(parseHealthGateHeartbeatMs('  5000  ')).toBe(5000);
    expect(parseHealthGateHeartbeatMs('60000')).toBe(60000);
  });

  test('throws for non-integer strings', () => {
    expect(() => parseHealthGateHeartbeatMs('abc')).toThrow(
      'DD_UPDATE_HEALTH_GATE_HEARTBEAT_MS must be a non-negative integer (got "abc")',
    );
    expect(() => parseHealthGateHeartbeatMs('1.5')).toThrow(
      'DD_UPDATE_HEALTH_GATE_HEARTBEAT_MS must be a non-negative integer (got "1.5")',
    );
    expect(() => parseHealthGateHeartbeatMs('-1')).toThrow(
      'DD_UPDATE_HEALTH_GATE_HEARTBEAT_MS must be a non-negative integer (got "-1")',
    );
  });

  test('throws for a number that exceeds MAX_SAFE_INTEGER', () => {
    // 2^53 passes the digit-only regex but fails Number.isSafeInteger.
    const huge = String(Number.MAX_SAFE_INTEGER + 1);
    expect(() => parseHealthGateHeartbeatMs(huge)).toThrow(
      `DD_UPDATE_HEALTH_GATE_HEARTBEAT_MS must be a non-negative integer (got "${huge}")`,
    );
  });

  test('throws for positive integer below minimum (1000)', () => {
    expect(() => parseHealthGateHeartbeatMs('999')).toThrow(
      'DD_UPDATE_HEALTH_GATE_HEARTBEAT_MS must be at least 1000 (got "999")',
    );
    expect(() => parseHealthGateHeartbeatMs('1')).toThrow(
      'DD_UPDATE_HEALTH_GATE_HEARTBEAT_MS must be at least 1000 (got "1")',
    );
  });
});

describe('HEALTH_GATE_HEARTBEAT_MS module-level constant', () => {
  test('is a positive number (default 10000 when env var is absent)', () => {
    // The env var is not set in the test environment, so the default applies.
    expect(typeof HEALTH_GATE_HEARTBEAT_MS).toBe('number');
    expect(HEALTH_GATE_HEARTBEAT_MS).toBe(10_000);
  });

  test('reflects the env-var value when DD_UPDATE_HEALTH_GATE_HEARTBEAT_MS is set', async () => {
    // vi.resetModules() + dynamic import forces module-level code to re-run
    // with the new process.env value, exercising the non-null constant branch.
    const prev = process.env.DD_UPDATE_HEALTH_GATE_HEARTBEAT_MS;
    process.env.DD_UPDATE_HEALTH_GATE_HEARTBEAT_MS = '5000';
    vi.resetModules();
    try {
      const mod = await import('./health-gate-heartbeat.js?env5000');
      expect(mod.HEALTH_GATE_HEARTBEAT_MS).toBe(5000);
    } finally {
      if (prev === undefined) {
        delete process.env.DD_UPDATE_HEALTH_GATE_HEARTBEAT_MS;
      } else {
        process.env.DD_UPDATE_HEALTH_GATE_HEARTBEAT_MS = prev;
      }
      vi.resetModules();
    }
  });

  test('is null when DD_UPDATE_HEALTH_GATE_HEARTBEAT_MS is "0" (explicit disable)', async () => {
    // vi.resetModules() + dynamic import forces module-level code to re-run
    // with env=0, which should yield HEALTH_GATE_HEARTBEAT_MS === null.
    const prev = process.env.DD_UPDATE_HEALTH_GATE_HEARTBEAT_MS;
    process.env.DD_UPDATE_HEALTH_GATE_HEARTBEAT_MS = '0';
    vi.resetModules();
    try {
      const mod = await import('./health-gate-heartbeat.js?env0');
      expect(mod.HEALTH_GATE_HEARTBEAT_MS).toBeNull();
    } finally {
      if (prev === undefined) {
        delete process.env.DD_UPDATE_HEALTH_GATE_HEARTBEAT_MS;
      } else {
        process.env.DD_UPDATE_HEALTH_GATE_HEARTBEAT_MS = prev;
      }
      vi.resetModules();
    }
  });
});

describe('startHealthGateHeartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('calls emitHeartbeat at the configured interval', () => {
    const emitHeartbeat = vi.fn();
    const cancel = startHealthGateHeartbeat('op-1', emitHeartbeat, 10_000);

    expect(emitHeartbeat).not.toHaveBeenCalled();

    vi.advanceTimersByTime(10_000);
    expect(emitHeartbeat).toHaveBeenCalledTimes(1);
    expect(emitHeartbeat).toHaveBeenCalledWith('op-1');

    vi.advanceTimersByTime(10_000);
    expect(emitHeartbeat).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(10_000);
    expect(emitHeartbeat).toHaveBeenCalledTimes(3);

    cancel();
  });

  test('ceases heartbeats immediately when cancel is called (success path)', () => {
    const emitHeartbeat = vi.fn();
    const cancel = startHealthGateHeartbeat('op-2', emitHeartbeat, 10_000);

    vi.advanceTimersByTime(10_000);
    expect(emitHeartbeat).toHaveBeenCalledTimes(1);

    // Simulate successful health-gate resolution: cancel then verify no more ticks
    cancel();

    vi.advanceTimersByTime(30_000);
    // Still only one call — heartbeat stopped
    expect(emitHeartbeat).toHaveBeenCalledTimes(1);
  });

  test('ceases heartbeats immediately when cancel is called (failure / rollback path)', () => {
    const emitHeartbeat = vi.fn();
    const cancel = startHealthGateHeartbeat('op-3', emitHeartbeat, 10_000);

    vi.advanceTimersByTime(5_000);
    expect(emitHeartbeat).not.toHaveBeenCalled();

    // Simulate a health-gate failure mid-wait
    cancel();

    vi.advanceTimersByTime(60_000);
    expect(emitHeartbeat).not.toHaveBeenCalled();
  });

  test('does not emit any heartbeats when heartbeatMs is null (opt-out)', () => {
    const emitHeartbeat = vi.fn();
    const cancel = startHealthGateHeartbeat('op-4', emitHeartbeat, null);

    vi.advanceTimersByTime(120_000);
    expect(emitHeartbeat).not.toHaveBeenCalled();

    // cancel is a no-op; calling it should not throw
    expect(() => cancel()).not.toThrow();
  });

  test('cancel is idempotent — calling it multiple times does not throw', () => {
    const emitHeartbeat = vi.fn();
    const cancel = startHealthGateHeartbeat('op-5', emitHeartbeat, 10_000);

    cancel();
    cancel();
    cancel();

    vi.advanceTimersByTime(30_000);
    expect(emitHeartbeat).not.toHaveBeenCalled();
  });

  test('uses HEALTH_GATE_HEARTBEAT_MS default when heartbeatMs argument is omitted', () => {
    const emitHeartbeat = vi.fn();
    // Default is 10_000 ms per the module constant
    const cancel = startHealthGateHeartbeat('op-6', emitHeartbeat);

    vi.advanceTimersByTime(9_999);
    expect(emitHeartbeat).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(emitHeartbeat).toHaveBeenCalledTimes(1);

    cancel();
  });

  test('terminal event wins — cancel before the next tick ensures no extra heartbeat', () => {
    const emitHeartbeat = vi.fn();
    const cancel = startHealthGateHeartbeat('op-7', emitHeartbeat, 10_000);

    vi.advanceTimersByTime(9_999);
    expect(emitHeartbeat).not.toHaveBeenCalled();

    // Terminal event fires at t=9999; cancel immediately
    cancel();

    // Advance past where the interval would have fired
    vi.advanceTimersByTime(10_000);
    // No heartbeats should have fired
    expect(emitHeartbeat).not.toHaveBeenCalled();
  });

  test('terminal event wins at the heartbeat boundary before queued ticks run', () => {
    vi.setSystemTime(0);
    const emitHeartbeat = vi.fn();
    const cancel = startHealthGateHeartbeat('op-8', emitHeartbeat, 10_000);

    // Terminal event arrives exactly at t=10000 before timer callbacks are flushed.
    vi.setSystemTime(10_000);
    cancel();

    vi.runOnlyPendingTimers();
    expect(emitHeartbeat).not.toHaveBeenCalled();
  });
});
