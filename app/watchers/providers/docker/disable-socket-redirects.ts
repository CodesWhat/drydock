import type Dockerode from 'dockerode';

interface ModemLike {
  socketPath?: string | (() => string | Promise<string>);
  buildRequest: (
    options: Record<string, unknown>,
    context: unknown,
    data: unknown,
    callback: unknown,
  ) => void;
}

/**
 * Disable docker-modem's built-in redirect follower for socket connections.
 *
 * docker-modem wraps Node's native HTTP with a redirect-following layer
 * (`lib/http.js`).  When following a redirect over a unix socket, it
 * constructs a new URL via `url.resolve(reqUrl, location)` — but because
 * the original request used `socketPath` (no hostname), path segments
 * like "images" get misinterpreted as hostnames.  Node then tries to
 * DNS-resolve them, producing an unhandled `getaddrinfo EAI_AGAIN`.
 *
 * Setting `maxRedirects: 0` on the request options tells the redirect
 * follower to reject any redirect attempt with "Max redirects exceeded"
 * instead of following it.  That error is caught by the modem's normal
 * error handler and propagated cleanly via promise rejection — no crash,
 * no DNS lookup.
 *
 * This is the belt-and-suspenders companion to version pinning: version
 * pinning avoids most 301s; this guard prevents a crash if one slips
 * through for any reason (image name format, Podman version mismatch, etc.).
 *
 * See GitHub issue #182.
 */
export function disableSocketRedirects(dockerApi: Dockerode): void {
  const modem = (dockerApi as unknown as { modem: ModemLike }).modem;
  if (!modem.socketPath) {
    return;
  }
  const original = modem.buildRequest.bind(modem);
  modem.buildRequest = function patchedBuildRequest(
    options: Record<string, unknown>,
    context: unknown,
    data: unknown,
    callback: unknown,
  ) {
    options.maxRedirects = 0;
    return original(options, context, data, callback);
  };
}
