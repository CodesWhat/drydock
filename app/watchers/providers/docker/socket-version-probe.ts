import http from 'node:http';

const PROBE_TIMEOUT_MS = 5000;

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
    function makeRequest(requestPath: string, followedRedirect: boolean): void {
      const req = http.request(
        {
          socketPath,
          path: requestPath,
          method: 'GET',
          timeout: PROBE_TIMEOUT_MS,
        },
        (res) => {
          if (
            !followedRedirect &&
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            makeRequest(res.headers.location, true);
            return;
          }

          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            body += chunk;
          });
          res.on('end', () => {
            try {
              const data = JSON.parse(body);
              if (data.ApiVersion && typeof data.ApiVersion === 'string') {
                resolve(data.ApiVersion);
              } else {
                resolve(undefined);
              }
            } catch {
              resolve(undefined);
            }
          });
          res.on('error', () => resolve(undefined));
        },
      );
      req.on('error', () => resolve(undefined));
      req.on('timeout', () => {
        req.destroy();
        resolve(undefined);
      });
      req.end();
    }

    makeRequest('/version', false);
  });
}
