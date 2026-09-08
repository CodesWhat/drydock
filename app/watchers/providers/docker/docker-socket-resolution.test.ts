import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import {
  DEFAULT_DOCKER_SOCKET_PATH,
  isUnixSocket,
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
      // An empty injected env, not `xdgRuntimeDir: undefined` — the latter
      // falls through to the real process.env via `??` and would make this
      // test's outcome depend on whatever XDG_RUNTIME_DIR happens to be set
      // to on whatever machine runs it (#10.4 finding 4).
      env: {},
    });

    expect(result).toBe(ROOTFUL_PODMAN_SOCKET_PATH);
    expect(onInfo).toHaveBeenCalledWith(
      expect.stringContaining(`using detected Podman socket ${ROOTFUL_PODMAN_SOCKET_PATH}`),
    );
    expect(onError).not.toHaveBeenCalled();
  });

  test('never probes and returns the configured socket unchanged when explicitly configured, even when it equals the schema default (#10.4 finding 1)', () => {
    const fsAccess = vi.fn(() => false);
    const onInfo = vi.fn();
    const onError = vi.fn();

    const result = resolveDockerSocketPath(DEFAULT_DOCKER_SOCKET_PATH, {
      fsAccess,
      onInfo,
      onError,
      socketExplicit: true,
    });

    expect(result).toBe(DEFAULT_DOCKER_SOCKET_PATH);
    expect(fsAccess).not.toHaveBeenCalled();
    expect(onInfo).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  test('uses an injected env object over process.env for XDG_RUNTIME_DIR (#10.4 finding 4)', () => {
    const previousXdgRuntimeDir = process.env.XDG_RUNTIME_DIR;
    process.env.XDG_RUNTIME_DIR = '/should-not-be-used';
    try {
      const fsAccess = vi.fn((path: string) => path === ROOTFUL_PODMAN_SOCKET_PATH);
      const onInfo = vi.fn();

      const result = resolveDockerSocketPath(DEFAULT_DOCKER_SOCKET_PATH, {
        fsAccess,
        onInfo,
        env: {},
      });

      expect(fsAccess).not.toHaveBeenCalledWith('/should-not-be-used/podman/podman.sock');
      expect(result).toBe(ROOTFUL_PODMAN_SOCKET_PATH);
    } finally {
      if (previousXdgRuntimeDir === undefined) {
        delete process.env.XDG_RUNTIME_DIR;
      } else {
        process.env.XDG_RUNTIME_DIR = previousXdgRuntimeDir;
      }
    }
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

  test('defaults fsAccess to the real isUnixSocket implementation without invoking it on the early-return path', () => {
    // No fsAccess override: exercises the `options.fsAccess ?? isUnixSocket`
    // default assignment. The explicit non-default socket short-circuits
    // before fsAccess is ever called, so this stays host-independent.
    const result = resolveDockerSocketPath('/run/docker-local.sock');

    expect(result).toBe('/run/docker-local.sock');
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
});

describe('isUnixSocket', () => {
  test('returns false for a plain file at the candidate path (#10.4 finding 3)', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drydock-podman-socket-'));
    const filePath = path.join(tempDir, 'podman.sock');
    // A stale plain file must never be treated as a usable socket, even
    // though it exists at the exact candidate path.
    fs.writeFileSync(filePath, '');

    try {
      expect(isUnixSocket(filePath)).toBe(false);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('returns true for a real unix socket at the candidate path (#10.4 finding 3)', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drydock-podman-socket-'));
    const socketPath = path.join(tempDir, 'podman.sock');
    const server = net.createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, () => resolve());
    });

    try {
      expect(isUnixSocket(socketPath)).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('returns false for a nonexistent path', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drydock-podman-socket-'));
    const missingPath = path.join(tempDir, 'does-not-exist.sock');

    try {
      expect(isUnixSocket(missingPath)).toBe(false);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
