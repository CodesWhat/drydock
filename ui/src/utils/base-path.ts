/**
 * Sub-path hosting (DD_SERVER_BASEPATH).
 *
 * The server publishes the configured base path in
 * `<meta name="dd-base-path" content="/drydock">` of the index.html it serves
 * (inline scripts are blocked by the CSP). Without the tag the app is served
 * from the root and every helper here is a no-op.
 */
const META_NAME = 'dd-base-path';

/** The base path without a trailing slash, or '' when served from the root. */
export function getBasePath(): string {
  const content = document
    .querySelector(`meta[name="${META_NAME}"]`)
    ?.getAttribute('content')
    ?.trim();
  if (!content || content === '/') {
    return '';
  }
  return `/${content.replace(/^\/+|\/+$/g, '')}`;
}

function isRootRelative(url: string): boolean {
  return url.startsWith('/') && !url.startsWith('//');
}

/** Prefix a root-relative URL ("/api/v1/...") with the base path; other URLs pass through. */
export function withBasePath(url: string): string {
  const basePath = getBasePath();
  if (!basePath || !isRootRelative(url)) {
    return url;
  }
  if (url === basePath || url.startsWith(`${basePath}/`) || url.startsWith(`${basePath}?`)) {
    return url;
  }
  return `${basePath}${url}`;
}

/** Inverse of withBasePath for a pathname the browser reports ("/drydock/api/v1/x" -> "/api/v1/x"). */
export function stripBasePath(pathname: string): string {
  const basePath = getBasePath();
  if (basePath && (pathname === basePath || pathname.startsWith(`${basePath}/`))) {
    return pathname.slice(basePath.length) || '/';
  }
  return pathname;
}

let installed = false;

/**
 * Make every root-relative `fetch('/api/v1/...')` in the app honour the base
 * path. Must run before anything else wraps `fetch`, so wrappers keep seeing
 * the unprefixed URLs the services pass in.
 */
export function installBasePathFetch(): void {
  if (installed || !getBasePath()) {
    return;
  }
  installed = true;
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    originalFetch(
      typeof input === 'string' ? withBasePath(input) : input,
      init,
    )) as typeof globalThis.fetch;
}

/** @internal test hook: allow installBasePathFetch to run again. */
export function resetBasePathFetchForTests(): void {
  installed = false;
}
