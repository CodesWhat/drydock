import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import {
  DEFAULT_DOCKER_SOCKET_PATH,
  ROOTFUL_PODMAN_SOCKET_PATH,
  resolveDockerSocketPath,
} from './docker-socket-resolution.js';

describe('resolveDockerSocketPath', () => {
  test('returns the default socket unchanged when it exists', () => {
    const fsAccess = vi.fn((path: string) => path === DEFAULT_DOCKER_SOCKET_PATH);
    const onInfo = vi.fn();
    const onError = vi.fn();

    const result = resolveDockerSocketPath(DEFAULT_DOCKER_SOCKET_PATH, {
      fsAccess,
      onInfo,
      onError,
    });

    expect(result).toBe(DEFAULT_DOCKER_SOCKET_PATH);
    expect(onInfo).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  test('falls back to the rootful Podman socket when the default is absent', () => {
    const fsAccess = vi.fn((path: string) => path === ROOTFUL_PODMAN_SOCKET_PATH);
    const onInfo = vi.fn();
    const onError = vi.fn();

    const result = resolveDockerSocketPath(DEFAULT_DOCKER_SOCKET_PATH, {
      fsAccess,
      onInfo,
      onError,
      xdgRuntimeDir: undefined,
    });

    expect(result).toBe(ROOTFUL_PODMAN_SOCKET_PATH);
    expect(onInfo).toHaveBeenCalledWith(
      expect.stringContaining(`using detected Podman socket ${ROOTFUL_PODMAN_SOCKET_PATH}`),
    );
    expect(onError).not.toHaveBeenCalled();
  });

  test('falls back to the rootless XDG_RUNTIME_DIR Podman socket when the default and rootful socket are both absent', () => {
    const xdgRuntimeDir = '/run/user/1000';
    const rootlessSocket = `${xdgRuntimeDir}/podman/podman.sock`;
    const fsAccess = vi.fn((path: string) => path === rootlessSocket);
    const onInfo = vi.fn();
    const onError = vi.fn();

    const result = resolveDockerSocketPath(DEFAULT_DOCKER_SOCKET_PATH, {
      fsAccess,
      onInfo,
      onError,
      xdgRuntimeDir,
    });

    expect(result).toBe(rootlessSocket);
    expect(onInfo).toHaveBeenCalledWith(expect.stringContaining(rootlessSocket));
    expect(onError).not.toHaveBeenCalled();
  });

  test('keeps the configured default and logs an error when no socket is found', () => {
    const fsAccess = vi.fn(() => false);
    const onInfo = vi.fn();
    const onError = vi.fn();

    const result = resolveDockerSocketPath(DEFAULT_DOCKER_SOCKET_PATH, {
      fsAccess,
      onInfo,
      onError,
      xdgRuntimeDir: '/run/user/1000',
    });

    expect(result).toBe(DEFAULT_DOCKER_SOCKET_PATH);
    expect(onInfo).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining(`Docker socket not found at ${DEFAULT_DOCKER_SOCKET_PATH}`),
    );
  });

  test('returns an explicitly configured non-default socket unchanged without probing', () => {
    const fsAccess = vi.fn(() => false);
    const onInfo = vi.fn();
    const onError = vi.fn();

    const result = resolveDockerSocketPath('/run/docker-local.sock', {
      fsAccess,
      onInfo,
      onError,
    });

    expect(result).toBe('/run/docker-local.sock');
    expect(fsAccess).not.toHaveBeenCalled();
    expect(onInfo).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  test('uses process.env.XDG_RUNTIME_DIR when no override is supplied', () => {
    const previousXdgRuntimeDir = process.env.XDG_RUNTIME_DIR;
    process.env.XDG_RUNTIME_DIR = '/run/user/2000';
    try {
      const rootlessSocket = '/run/user/2000/podman/podman.sock';
      const fsAccess = vi.fn((path: string) => path === rootlessSocket);

      const result = resolveDockerSocketPath(DEFAULT_DOCKER_SOCKET_PATH, { fsAccess });

      expect(result).toBe(rootlessSocket);
    } finally {
      if (previousXdgRuntimeDir === undefined) {
        delete process.env.XDG_RUNTIME_DIR;
      } else {
        process.env.XDG_RUNTIME_DIR = previousXdgRuntimeDir;
      }
    }
  });

  test('uses default log-backed callbacks when none are supplied', () => {
    const fsAccess = vi.fn(() => false);

    const result = resolveDockerSocketPath(DEFAULT_DOCKER_SOCKET_PATH, { fsAccess });

    expect(result).toBe(DEFAULT_DOCKER_SOCKET_PATH);
  });

  test('uses the real filesystem via the default fsAccess implementation', () => {
    const previousXdgRuntimeDir = process.env.XDG_RUNTIME_DIR;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drydock-podman-socket-'));
    const podmanDir = path.join(tempDir, 'podman');
    fs.mkdirSync(podmanDir);
    const rootlessSocketPath = path.join(podmanDir, 'podman.sock');
    // A plain file stands in for a real unix socket — accessSync only checks
    // that the path exists, it doesn't care what kind of file it is.
    fs.writeFileSync(rootlessSocketPath, '');
    process.env.XDG_RUNTIME_DIR = tempDir;

    try {
      // No fsAccess override: exercises the real fs.accessSync-backed default,
      // both its "exists" branch (this candidate) and "absent" branch (the
      // Docker default and rootful Podman paths, neither present on a test box).
      const result = resolveDockerSocketPath(DEFAULT_DOCKER_SOCKET_PATH);

      expect(result).toBe(rootlessSocketPath);
    } finally {
      if (previousXdgRuntimeDir === undefined) {
        delete process.env.XDG_RUNTIME_DIR;
      } else {
        process.env.XDG_RUNTIME_DIR = previousXdgRuntimeDir;
      }
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
