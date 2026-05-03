import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  POST_START_LIVENESS_GRACE_MS,
  PostStartLivenessFailedError,
  parsePostStartLivenessGraceMs,
  verifyContainerStillRunning,
} from './post-start-liveness.js';

describe('parsePostStartLivenessGraceMs', () => {
  test('returns undefined for absent or empty values', () => {
    expect(parsePostStartLivenessGraceMs(undefined)).toBeUndefined();
    expect(parsePostStartLivenessGraceMs('')).toBeUndefined();
    expect(parsePostStartLivenessGraceMs('   ')).toBeUndefined();
  });

  test('returns 0 for explicit opt-out', () => {
    expect(parsePostStartLivenessGraceMs('0')).toBe(0);
  });

  test('returns parsed value at or above the minimum', () => {
    expect(parsePostStartLivenessGraceMs('100')).toBe(100);
    expect(parsePostStartLivenessGraceMs('5000')).toBe(5000);
  });

  test('throws for values below the minimum (and above 0)', () => {
    expect(() => parsePostStartLivenessGraceMs('99')).toThrow(
      'DD_UPDATE_POST_START_LIVENESS_GRACE_MS must be 0 or at least 100',
    );
    expect(() => parsePostStartLivenessGraceMs('1')).toThrow(
      'DD_UPDATE_POST_START_LIVENESS_GRACE_MS must be 0 or at least 100',
    );
  });

  test('throws for non-integer values', () => {
    expect(() => parsePostStartLivenessGraceMs('abc')).toThrow(
      'DD_UPDATE_POST_START_LIVENESS_GRACE_MS must be a non-negative integer',
    );
    expect(() => parsePostStartLivenessGraceMs('-5')).toThrow(
      'DD_UPDATE_POST_START_LIVENESS_GRACE_MS must be a non-negative integer',
    );
    expect(() => parsePostStartLivenessGraceMs('1.5')).toThrow(
      'DD_UPDATE_POST_START_LIVENESS_GRACE_MS must be a non-negative integer',
    );
  });
});

describe('POST_START_LIVENESS_GRACE_MS module-level constant', () => {
  test('defaults to 2000 when env var is absent', () => {
    expect(typeof POST_START_LIVENESS_GRACE_MS).toBe('number');
    expect(POST_START_LIVENESS_GRACE_MS).toBe(2_000);
  });

  test('reflects the env-var value when DD_UPDATE_POST_START_LIVENESS_GRACE_MS is set', async () => {
    const prev = process.env.DD_UPDATE_POST_START_LIVENESS_GRACE_MS;
    process.env.DD_UPDATE_POST_START_LIVENESS_GRACE_MS = '5000';
    vi.resetModules();
    try {
      const mod = await import('./post-start-liveness.js?env5000');
      expect(mod.POST_START_LIVENESS_GRACE_MS).toBe(5000);
    } finally {
      if (prev === undefined) {
        delete process.env.DD_UPDATE_POST_START_LIVENESS_GRACE_MS;
      } else {
        process.env.DD_UPDATE_POST_START_LIVENESS_GRACE_MS = prev;
      }
      vi.resetModules();
    }
  });

  test('is 0 when DD_UPDATE_POST_START_LIVENESS_GRACE_MS is "0" (explicit disable)', async () => {
    const prev = process.env.DD_UPDATE_POST_START_LIVENESS_GRACE_MS;
    process.env.DD_UPDATE_POST_START_LIVENESS_GRACE_MS = '0';
    vi.resetModules();
    try {
      const mod = await import('./post-start-liveness.js?env0');
      expect(mod.POST_START_LIVENESS_GRACE_MS).toBe(0);
    } finally {
      if (prev === undefined) {
        delete process.env.DD_UPDATE_POST_START_LIVENESS_GRACE_MS;
      } else {
        process.env.DD_UPDATE_POST_START_LIVENESS_GRACE_MS = prev;
      }
      vi.resetModules();
    }
  });
});

describe('verifyContainerStillRunning', () => {
  let logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };
  let sleep: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    logger = { info: vi.fn(), warn: vi.fn() };
    sleep = vi.fn().mockResolvedValue(undefined);
  });

  test('no-ops when graceMs is 0', async () => {
    const inspect = vi.fn().mockResolvedValue({ State: { Running: false, ExitCode: 1 } });
    await expect(
      verifyContainerStillRunning({
        container: { inspect },
        containerName: 'web',
        graceMs: 0,
        logger,
        sleep,
      }),
    ).resolves.toBeUndefined();
    expect(sleep).not.toHaveBeenCalled();
    expect(inspect).not.toHaveBeenCalled();
  });

  test('no-ops when graceMs is negative', async () => {
    const inspect = vi.fn();
    await expect(
      verifyContainerStillRunning({
        container: { inspect },
        containerName: 'web',
        graceMs: -1,
        logger,
        sleep,
      }),
    ).resolves.toBeUndefined();
    expect(inspect).not.toHaveBeenCalled();
  });

  test('throws when container exited with an exit code', async () => {
    const inspect = vi.fn().mockResolvedValue({
      State: { Running: false, ExitCode: 127, Status: 'exited' },
    });
    await expect(
      verifyContainerStillRunning({
        container: { inspect },
        containerName: 'web',
        graceMs: 2000,
        logger,
        sleep,
      }),
    ).rejects.toBeInstanceOf(PostStartLivenessFailedError);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  test('throws with State.Error detail when present', async () => {
    const inspect = vi.fn().mockResolvedValue({
      State: { Running: false, ExitCode: 0, Error: 'OCI runtime create failed', Status: 'exited' },
    });
    await expect(
      verifyContainerStillRunning({
        container: { inspect },
        containerName: 'web',
        graceMs: 1500,
        logger,
        sleep,
      }),
    ).rejects.toThrow(/OCI runtime create failed/);
  });

  test('throws with default detail when ExitCode is missing', async () => {
    const inspect = vi.fn().mockResolvedValue({ State: { Running: false } });
    await expect(
      verifyContainerStillRunning({
        container: { inspect },
        containerName: 'web',
        graceMs: 500,
        logger,
        sleep,
      }),
    ).rejects.toThrow(/exited within 500ms of start \(status: exited\)/);
  });

  test('passes when container is still running', async () => {
    const inspect = vi.fn().mockResolvedValue({ State: { Running: true, ExitCode: 0 } });
    await expect(
      verifyContainerStillRunning({
        container: { inspect },
        containerName: 'web',
        graceMs: 2000,
        logger,
        sleep,
      }),
    ).resolves.toBeUndefined();
  });

  test('passes when inspection returns no State (cannot prove failure)', async () => {
    const inspect = vi.fn().mockResolvedValue({});
    await expect(
      verifyContainerStillRunning({
        container: { inspect },
        containerName: 'web',
        graceMs: 2000,
        logger,
        sleep,
      }),
    ).resolves.toBeUndefined();
  });

  test('passes when inspect throws (warns but does not fail update)', async () => {
    const inspect = vi.fn().mockRejectedValue(new Error('connection lost'));
    await expect(
      verifyContainerStillRunning({
        container: { inspect },
        containerName: 'web',
        graceMs: 2000,
        logger,
        sleep,
      }),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      'Unable to verify post-start liveness for container web (connection lost)',
    );
  });

  test('handles non-Error inspect rejection', async () => {
    const inspect = vi.fn().mockRejectedValue('string failure');
    await expect(
      verifyContainerStillRunning({
        container: { inspect },
        containerName: 'web',
        graceMs: 2000,
        logger,
        sleep,
      }),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      'Unable to verify post-start liveness for container web (string failure)',
    );
  });

  test('uses default sleep when not provided', async () => {
    vi.useFakeTimers();
    const inspect = vi.fn().mockResolvedValue({ State: { Running: true } });
    const promise = verifyContainerStillRunning({
      container: { inspect },
      containerName: 'web',
      graceMs: 100,
      logger,
    });
    await vi.advanceTimersByTimeAsync(100);
    await expect(promise).resolves.toBeUndefined();
    vi.useRealTimers();
  });
});
