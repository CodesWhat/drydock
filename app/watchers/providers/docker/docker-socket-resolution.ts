import fs from 'node:fs';
import log from '../../../log/index.js';

export const DEFAULT_DOCKER_SOCKET_PATH = '/var/run/docker.sock';
export const ROOTFUL_PODMAN_SOCKET_PATH = '/run/podman/podman.sock';

/**
 * Stat-backed default `fsAccess` implementation: true only when `path`
 * exists and is a unix socket. Exported so tests can exercise the real
 * `fs.statSync` behavior directly instead of depending on host state (a
 * candidate path existing, or not, on whatever machine runs the suite).
 */
export function isUnixSocket(path: string): boolean {
  try {
    const stats = fs.statSync(path);
    if (!stats.isSocket()) {
      log.debug(`Skipping Podman socket candidate ${path}: exists but is not a socket`);
      return false;
    }
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
  /** Overrides `process.env` for testing, so an ambient XDG_RUNTIME_DIR never leaks into a test. */
  env?: Record<string, string | undefined>;
  /**
   * Whether `configuredSocket` was explicitly set by the operator (env var or
   * config file) rather than left for the Joi schema default to fill in.
   * When true, probing never runs — even if the explicit value happens to
   * equal the schema default — because "unset" and "explicitly set to the
   * default" must not collapse into the same behavior (#10.4 forward-port
   * review finding 1).
   */
  socketExplicit?: boolean;
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
 * Only kicks in when the socket was never explicitly configured AND the
 * configured (default) socket is absent — any explicitly configured socket
 * (including one that happens to equal the schema default, or one that
 * already points at a Podman path) is returned unchanged, no probing. This
 * keeps "explicit configuration always wins" true: a `host` watcher never
 * calls this at all (see docker-remote-auth.ts), and a watcher with an
 * explicit `socket` is never second-guessed, whatever value it was set to.
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
  const fsAccess = options.fsAccess ?? isUnixSocket;
  const onInfo = options.onInfo ?? ((message: string) => log.info(message));
  const onError = options.onError ?? ((message: string) => log.error(message));

  if (options.socketExplicit || configuredSocket !== DEFAULT_DOCKER_SOCKET_PATH) {
    return configuredSocket;
  }

  if (fsAccess(configuredSocket)) {
    return configuredSocket;
  }

  const env = options.env ?? process.env;
  const xdgRuntimeDir = options.xdgRuntimeDir ?? env.XDG_RUNTIME_DIR;
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
