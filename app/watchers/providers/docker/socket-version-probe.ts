import http from 'node:http';

const PROBE_TIMEOUT_MS = 5000;
const MAX_BODY_BYTES = 64 * 1024;

/**
 * Probe a container daemon's API version over a unix socket.
 *
 * Podman's Docker-compatible API redirects unversioned endpoints
 * (e.g. `/images/…` → `/v5.0.0/images/…`).  docker-modem's built-in
 * redirect follower cannot handle redirects over unix sockets — it
 * misparses the Location header and tries to DNS-resolve path segments
 * as hostnames, crashing the process with `getaddrinfo EAI_AGAIN`.
 *
 * By probing `/version` first and pinning Dockerode to the returned
 * `ApiVersion`, every subsequent request uses a versioned path that
 * the daemon serves directly — no redirect, no crash.
 *
 * The probe uses Node's raw `http.request` (not docker-modem) so it
 * is immune to the redirect bug.  If the probe itself is redirected
 * (unlikely for `/version`, but possible), we follow one hop.
 */
export function probeSocketApiVersion(socketPath: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    sendProbeRequest(socketPath, '/version', false, resolve);
  });
}

function sendProbeRequest(
  socketPath: string,
  requestPath: string,
  followedRedirect: boolean,
  resolve: (version: string | undefined) => void,
): void {
  const req = http.request(
    {
      socketPath,
      path: requestPath,
      method: 'GET',
      timeout: PROBE_TIMEOUT_MS,
    },
    (res) => {
      if (shouldFollowRedirect(res, followedRedirect)) {
        sendProbeRequest(socketPath, res.headers.location, true, resolve);
        return;
      }

      collectProbeResponse(req, res, resolve);
    },
  );

  wireProbeRequest(req, resolve);
  req.end();
}

function shouldFollowRedirect(res: http.IncomingMessage, followedRedirect: boolean): boolean {
  return (
    !followedRedirect &&
    isRedirectStatus(res.statusCode) &&
    typeof res.headers.location === 'string'
  );
}

function isRedirectStatus(statusCode: number | undefined): boolean {
  return typeof statusCode === 'number' && statusCode >= 300 && statusCode < 400;
}

function wireProbeRequest(
  req: http.ClientRequest,
  resolve: (version: string | undefined) => void,
): void {
  req.on('error', () => resolve(undefined));
  req.on('timeout', () => {
    req.destroy();
    resolve(undefined);
  });
}

function collectProbeResponse(
  req: http.ClientRequest,
  res: http.IncomingMessage,
  resolve: (version: string | undefined) => void,
): void {
  let body = '';

  res.setEncoding('utf8');
  res.on('data', (chunk: string) => {
    body += chunk;
    if (body.length > MAX_BODY_BYTES) {
      req.destroy();
      resolve(undefined);
    }
  });
  res.on('end', () => resolve(parseProbeApiVersion(body)));
  res.on('error', () => resolve(undefined));
}

function parseProbeApiVersion(body: string): string | undefined {
  try {
    const data = JSON.parse(body) as { ApiVersion?: unknown };
    return typeof data.ApiVersion === 'string' ? data.ApiVersion : undefined;
  } catch {
    return undefined;
  }
}
