import { describe, expect, test, vi } from 'vitest';

const REQUIRED_ENV_KEYS = [
  'DD_SELF_UPDATE_OLD_CONTAINER_ID',
  'DD_SELF_UPDATE_NEW_CONTAINER_ID',
  'DD_SELF_UPDATE_OP_ID',
  'DD_SELF_UPDATE_OLD_CONTAINER_NAME',
  'DD_SELF_UPDATE_START_TIMEOUT_MS',
  'DD_SELF_UPDATE_HEALTH_TIMEOUT_MS',
  'DD_SELF_UPDATE_POLL_INTERVAL_MS',
] as const;

describe('self-update-controller entrypoint', () => {
  test('should execute entrypoint on module load and set exit code on failure', async () => {
    vi.resetModules();

    const originalExitCode = process.exitCode;
    const savedEnv = new Map<string, string | undefined>();
    for (const key of REQUIRED_ENV_KEYS) {
      savedEnv.set(key, process.env[key]);
      delete process.env[key];
    }

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    process.exitCode = undefined;

    try {
      await import('./self-update-controller-entrypoint.js?entrypoint-test');
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[self-update] controller failed:'),
      );
      expect(process.exitCode).toBe(1);
    } finally {
      errorSpy.mockRestore();
      process.exitCode = originalExitCode;
      for (const [key, value] of savedEnv.entries()) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });
});
