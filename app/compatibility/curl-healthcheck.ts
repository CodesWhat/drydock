import fs from 'node:fs';
import Dockerode from 'dockerode';
import { disableSocketRedirects } from '../watchers/providers/docker/disable-socket-redirects.js';
import { probeSocketApiVersion } from '../watchers/providers/docker/socket-version-probe.js';

const DEFAULT_SOCKET_PATH = '/var/run/docker.sock';
const SELF_CONTAINER_IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
// Boundary characters bracket the `curl` token: whitespace/quotes plus the
// shell metacharacters that can sit directly next to a command with no
// surrounding whitespace (e.g. `true&&curl ...`, `curl>/dev/null`). Any path
// prefix ending in `/curl` counts (`/bin/curl`, `/usr/local/bin/curl`, …).
const CURL_HEALTHCHECK_PATTERN =
  /(^|[\s"'`;|&()<>])(?:[^\s"'`;|&()<>]*\/)?curl(?=$|[\s"'`;|&()<>])/i;
const COMMAND_PREVIEW_MAX_LENGTH = 160;

type HealthcheckInspect = {
  Name?: string;
  Config?: {
    Healthcheck?: {
      Test?: unknown;
    };
  };
};

export interface CurlHealthcheckOverrideCompatibility {
  detected: boolean;
  commandPreview?: string;
  containerName?: string;
}

function getSelfContainerIdentifier(hostname = process.env.HOSTNAME): string | null {
  const normalizedHostname = hostname?.trim();
  if (!normalizedHostname || !SELF_CONTAINER_IDENTIFIER_PATTERN.test(normalizedHostname)) {
    return null;
  }
  return normalizedHostname;
}

function normalizeContainerName(name: unknown): string | undefined {
  if (typeof name !== 'string') {
    return undefined;
  }
  const trimmed = name.trim().replace(/^\/+/, '');
  return trimmed || undefined;
}

function joinHealthcheckCommand(test: unknown): string | undefined {
  if (!Array.isArray(test) || test.length === 0) {
    return undefined;
  }

  const command = test
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(' ')
    .trim();

  return command || undefined;
}

/**
 * Display-only preview of the healthcheck command, truncated so a very long
 * override doesn't blow up the UI banner or a log line. Detection never uses
 * this — it scans the full, untruncated command so curl past the cutoff is
 * still caught.
 */
export function getHealthcheckCommandPreview(test: unknown): string | undefined {
  const command = joinHealthcheckCommand(test);
  if (!command) {
    return undefined;
  }

  if (command.length <= COMMAND_PREVIEW_MAX_LENGTH) {
    return command;
  }

  return `${command.slice(0, COMMAND_PREVIEW_MAX_LENGTH - 1)}…`;
}

function usesCurlHealthcheckOverride(test: unknown): boolean {
  const command = joinHealthcheckCommand(test);
  return typeof command === 'string' && CURL_HEALTHCHECK_PATTERN.test(command);
}

export async function getCurlHealthcheckOverrideCompatibility(): Promise<CurlHealthcheckOverrideCompatibility> {
  const selfContainerIdentifier = getSelfContainerIdentifier();
  if (!selfContainerIdentifier || !fs.existsSync(DEFAULT_SOCKET_PATH)) {
    return { detected: false };
  }

  try {
    const apiVersion = await probeSocketApiVersion(DEFAULT_SOCKET_PATH);
    const dockerOptions: Dockerode.DockerOptions = {
      socketPath: DEFAULT_SOCKET_PATH,
    };
    if (apiVersion) {
      dockerOptions.version = `v${apiVersion}`;
    }

    const dockerApi = new Dockerode(dockerOptions);
    disableSocketRedirects(dockerApi);

    const inspect = (await dockerApi
      .getContainer(selfContainerIdentifier)
      .inspect()) as HealthcheckInspect;
    const healthcheckTest = inspect?.Config?.Healthcheck?.Test;

    if (!usesCurlHealthcheckOverride(healthcheckTest)) {
      return { detected: false };
    }

    return {
      detected: true,
      commandPreview: getHealthcheckCommandPreview(healthcheckTest),
      containerName: normalizeContainerName(inspect?.Name),
    };
  } catch {
    return { detected: false };
  }
}

/**
 * Build a startup log warning when the current container's own HEALTHCHECK
 * override still shells out to curl. curl was removed from the Docker image
 * in v1.7.0, so those overrides will start failing; point the operator at
 * the compiled healthcheck binary that replaces it.
 *
 * Deliberately omits the command itself: a curl-based healthcheck can carry
 * basic-auth credentials (curl's -u flag) or a signed URL, and this warning
 * goes to stdout and the in-app log buffer. The container name
 * is enough for the operator to go inspect the override themselves.
 *
 * Returns `undefined` when no override is detected, so callers can log
 * unconditionally without an extra `if`.
 */
export async function getCurlHealthcheckOverrideStartupWarning(): Promise<string | undefined> {
  const compatibility = await getCurlHealthcheckOverrideCompatibility();
  if (!compatibility.detected) {
    return undefined;
  }

  // A resolvable identifier is guaranteed once `detected` is true:
  // `getCurlHealthcheckOverrideCompatibility()` only sets it after
  // `getSelfContainerIdentifier()` already matched. Prefer the real
  // container name from the inspect payload; fall back to that identifier
  // (the HOSTNAME-derived value) when the inspect payload had none.
  const containerName = compatibility.containerName ?? getSelfContainerIdentifier();

  return (
    `Container '${containerName}' has a HEALTHCHECK override that shells out to curl. ` +
    'curl was removed from the Docker image in v1.7.0, so this override will start failing. ' +
    "Switch it to 'test: /bin/healthcheck $${DD_SERVER_PORT:-3000}' or drop the override to use " +
    'the built-in healthcheck.'
  );
}
