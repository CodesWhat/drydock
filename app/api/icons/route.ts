const ICON_PROXY_API_PREFIX = 'icons';
const ICON_PROXY_ROUTE_SEGMENTS = ['provider', 'slug'] as const;

export const ICON_PROXY_ROUTE_PATH = `/${ICON_PROXY_ROUTE_SEGMENTS.map((segment) => `:${segment}`).join('/')}`;

export function isIconProxyApiPath(path: string): boolean {
  const normalizedPath = path.endsWith('/') ? path.slice(0, -1) : path;
  const segments = normalizedPath.split('/');

  return (
    segments.length === ICON_PROXY_ROUTE_SEGMENTS.length + 2 &&
    segments[0] === '' &&
    segments[1] === ICON_PROXY_API_PREFIX &&
    segments.slice(2).every((segment) => segment.length > 0)
  );
}
