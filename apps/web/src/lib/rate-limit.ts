/**
 * Fixed-window in-memory rate limiter. State lives in one server instance, so on
 * a multi-instance deploy each instance counts separately and a cold start
 * resets it. That is best effort: enough to blunt a single crawler hammering
 * /api/search, not a security boundary.
 */
export type RateLimiter = (key: string, now?: number) => boolean;

export function createRateLimiter(limit: number, windowMs: number, maxKeys = 5000): RateLimiter {
  const hits = new Map<string, { start: number; count: number }>();

  return (key, now = Date.now()) => {
    const entry = hits.get(key);
    if (!entry || now - entry.start >= windowMs) {
      if (hits.size >= maxKeys) {
        for (const [k, v] of hits) if (now - v.start >= windowMs) hits.delete(k);
        if (hits.size >= maxKeys) hits.clear();
      }
      hits.set(key, { start: now, count: 1 });
      return true;
    }
    entry.count += 1;
    return entry.count <= limit;
  };
}

export function clientIp(headers: Headers): string {
  return (
    headers.get("x-real-ip") ?? headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"
  );
}
