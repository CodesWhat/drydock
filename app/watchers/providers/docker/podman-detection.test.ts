import { describe, expect, test, vi } from 'vitest';
import {
  detectPodmanCompatibility,
  detectPodmanFromVersionPayload,
  PODMAN_COMPAT_DOCS_URL,
} from './podman-detection.js';

describe('detectPodmanFromVersionPayload', () => {
  test('reports no Podman for a plain Docker payload', () => {
    const result = detectPodmanFromVersionPayload({
      Version: '27.3.1',
      Components: [{ Name: 'Engine' }, { Name: 'containerd' }],
      Platform: { Name: 'Docker Engine - Community' },
    });

    expect(result).toEqual({ isPodman: false });
  });

  test('detects Podman from a Components entry and captures the version', () => {
    const result = detectPodmanFromVersionPayload({
      Version: '5.6.0',
      Components: [{ Name: 'Podman Engine' }],
    });

    expect(result).toEqual({ isPodman: true, podmanVersion: '5.6.0' });
  });

  test('detects Podman from Platform.Name alone', () => {
    const result = detectPodmanFromVersionPayload({
      Version: '5.6.0',
      Platform: { Name: 'Podman' },
    });

    expect(result).toEqual({ isPodman: true, podmanVersion: '5.6.0' });
  });

  test('tolerates a missing Components array', () => {
    const result = detectPodmanFromVersionPayload({
      Version: '5.6.0',
      Platform: { Name: 'Podman' },
      Components: undefined,
    });

    expect(result).toEqual({ isPodman: true, podmanVersion: '5.6.0' });
  });

  test('tolerates a non-array Components field', () => {
    const result = detectPodmanFromVersionPayload({
      Version: '5.6.0',
      Components: 'not-an-array',
      Platform: { Name: 'Podman' },
    });

    expect(result).toEqual({ isPodman: true, podmanVersion: '5.6.0' });
  });

  test('tolerates Components entries with no Name', () => {
    const result = detectPodmanFromVersionPayload({
      Components: [{}, { Name: 42 }],
    });

    expect(result).toEqual({ isPodman: false });
  });

  test('tolerates a non-object Platform field', () => {
    const result = detectPodmanFromVersionPayload({
      Components: [],
      Platform: 'not-an-object',
    });

    expect(result).toEqual({ isPodman: false });
  });

  test('omits podmanVersion when Version is not a string', () => {
    const result = detectPodmanFromVersionPayload({
      Version: 12345,
      Platform: { Name: 'Podman' },
    });

    expect(result).toEqual({ isPodman: true, podmanVersion: undefined });
  });

  test('returns no-Podman for a non-object payload', () => {
    expect(detectPodmanFromVersionPayload(undefined)).toEqual({ isPodman: false });
    expect(detectPodmanFromVersionPayload(null)).toEqual({ isPodman: false });
    expect(detectPodmanFromVersionPayload('nope')).toEqual({ isPodman: false });
  });
});

describe('detectPodmanCompatibility', () => {
  test('does not warn for a Docker daemon', async () => {
    const warn = vi.fn();
    const watcher: any = {
      dockerApi: { version: vi.fn().mockResolvedValue({ Version: '27.3.1', Components: [] }) },
      log: { warn },
    };

    await detectPodmanCompatibility(watcher);

    expect(watcher.isPodman).toBe(false);
    expect(watcher.podmanVersion).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  test('warns once with the version for a Podman daemon', async () => {
    const warn = vi.fn();
    const watcher: any = {
      dockerApi: {
        version: vi
          .fn()
          .mockResolvedValue({ Version: '5.6.0', Components: [{ Name: 'Podman Engine' }] }),
      },
      log: { warn },
    };

    await detectPodmanCompatibility(watcher);

    expect(watcher.isPodman).toBe(true);
    expect(watcher.podmanVersion).toBe('5.6.0');
    expect(warn).toHaveBeenCalledTimes(1);
    const [message] = warn.mock.calls[0];
    expect(message).toContain('Podman detected (5.6.0)');
    expect(message).toContain('rootless networking');
    expect(message).toContain('volume driver differences');
    expect(message).toContain(
      'containers managed by a systemd unit (Quadlet) are recreated by the Docker action outside their unit',
    );
    expect(message).toContain(PODMAN_COMPAT_DOCS_URL);
  });

  test('falls back to "unknown version" when Podman does not report a version', async () => {
    const warn = vi.fn();
    const watcher: any = {
      dockerApi: {
        version: vi.fn().mockResolvedValue({ Components: [{ Name: 'Podman Engine' }] }),
      },
      log: { warn },
    };

    await detectPodmanCompatibility(watcher);

    expect(warn.mock.calls[0][0]).toContain('Podman detected (unknown version)');
  });

  test('is a no-op when dockerApi has no version() method', async () => {
    const warn = vi.fn();
    const watcher: any = { dockerApi: {}, log: { warn } };

    await detectPodmanCompatibility(watcher);

    expect(watcher.isPodman).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  test('is a best-effort no-op when version() rejects', async () => {
    const warn = vi.fn();
    const watcher: any = {
      dockerApi: { version: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) },
      log: { warn },
    };

    await detectPodmanCompatibility(watcher);

    expect(watcher.isPodman).toBeUndefined();
    expect(watcher.podmanVersion).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });
});
