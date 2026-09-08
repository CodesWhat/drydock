import fs from 'node:fs';
import log from '../../../log/index.js';

export const DEFAULT_DOCKER_SOCKET_PATH = '/var/run/docker.sock';
export const ROOTFUL_PODMAN_SOCKET_PATH = '/run/podman/podman.sock';

function defaultFsAccess(path: string): boolean {
  try {
    fs.accessSync(path);
    return true;
  } catch {
    return false;
  }
}

export interface DockerSocketResolutionOptions {
  /** Filesystem existence check, injectable so tests never touch real sockets. */
  fsAccess?: (path: string) => boolean;
  /** Overrides `process.env.XDG_RUNTIME_DIR` for testing. */
  xdgRuntimeDir?: string;
  onInfo?: (message: string) => void;
  onError?: (message: string) => void;
}

/**
 * Resolve the socket path a local Docker watcher should connect to.
 *
 * Podman ships a Docker-compatible API but doesn't listen on
 * `/var/run/docker.sock` by default — the docs tell Podman users to mount
 * their socket there so drydock's existing default keeps working, but an
 * operator who hasn't done that (or can't) gets a confusing "socket not
 * found" failure with no hint that Podman's own socket paths exist.
 *
 * Only kicks in when the configured socket is still the schema default AND
 * that default is absent — any explicitly configured socket (including one
 * that happens to already point at a Podman path) is returned unchanged, no
 * probing. This keeps "explicit configuration always wins" true: a `host`
 * watcher never calls this at all (see docker-remote-auth.ts), and a
 * watcher with a non-default `socket` is never second-guessed.
 *
 * Probe order: rootful Podman socket, then the rootless XDG-runtime-dir
 * socket when `XDG_RUNTIME_DIR` is set. First existing path wins. If
 * neither exists, the configured default is returned unchanged and an error
 * is logged (not thrown) — the existing "can't connect" failure further
 * down the Dockerode init path is unchanged.
 */
export function resolveDockerSocketPath(
  configuredSocket: string,
  options: DockerSocketResolutionOptions = {},
): string {
  const fsAccess = options.fsAccess ?? defaultFsAccess;
  const onInfo = options.onInfo ?? ((message: string) => log.info(message));
  const onError = options.onError ?? ((message: string) => log.error(message));

  if (configuredSocket !== DEFAULT_DOCKER_SOCKET_PATH) {
    return configuredSocket;
  }

  if (fsAccess(configuredSocket)) {
    return configuredSocket;
  }

  const xdgRuntimeDir = options.xdgRuntimeDir ?? process.env.XDG_RUNTIME_DIR;
  const candidatePaths = [ROOTFUL_PODMAN_SOCKET_PATH];
  if (xdgRuntimeDir) {
    candidatePaths.push(`${xdgRuntimeDir}/podman/podman.sock`);
  }

  for (const candidatePath of candidatePaths) {
    if (fsAccess(candidatePath)) {
      onInfo(
        `Docker socket not found at ${DEFAULT_DOCKER_SOCKET_PATH}; using detected Podman socket ${candidatePath}`,
      );
      return candidatePath;
    }
  }

  onError(
    `Docker socket not found at ${DEFAULT_DOCKER_SOCKET_PATH} and no Podman socket detected ` +
      `(checked ${candidatePaths.join(', ')}). Set DD_WATCHER_<name>_SOCKET to the correct path.`,
  );
  return configuredSocket;
}
