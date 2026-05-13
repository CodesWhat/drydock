/**
 * Simple in-memory per-host token bucket rate limiter.
 *
 * Prevents Drydock from self-inflicting 429s by bursting too fast
 * within a cron cycle. Single Map — no cleanup needed in a long-running process.
 */

export interface BucketConfig {
  /** Unique key identifying the bucket (typically the hostname). */
  key: string;
  /** Token refill rate: tokens added per second. */
  ratePerSec: number;
  /** Maximum token capacity (burst size). */
  burst: number;
}

interface Bucket {
  tokens: number;
  lastRefillAt: number;
  ratePerSec: number;
  burst: number;
}

const buckets = new Map<string, Bucket>();

function getOrCreateBucket(config: BucketConfig): Bucket {
  let bucket = buckets.get(config.key);
  if (!bucket) {
    bucket = {
      tokens: config.burst,
      lastRefillAt: Date.now(),
      ratePerSec: config.ratePerSec,
      burst: config.burst,
    };
    buckets.set(config.key, bucket);
  }
  return bucket;
}

function refill(bucket: Bucket): void {
  const now = Date.now();
  const elapsed = (now - bucket.lastRefillAt) / 1000;
  const added = elapsed * bucket.ratePerSec;
  bucket.tokens = Math.min(bucket.burst, bucket.tokens + added);
  bucket.lastRefillAt = now;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Acquire one token for the given bucket, waiting if necessary.
 */
export async function acquireToken(config: BucketConfig): Promise<void> {
  const bucket = getOrCreateBucket(config);

  while (true) {
    refill(bucket);

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return;
    }

    // Wait for enough time to accumulate one token
    const waitMs = Math.ceil(((1 - bucket.tokens) / bucket.ratePerSec) * 1000);
    await sleep(waitMs);
  }
}

/** Conservative per-host rate limits. */
const HOST_CONFIGS: Array<{ pattern: RegExp; ratePerSec: number; burst: number }> = [
  { pattern: /^(ghcr\.io|pkg-containers\.githubusercontent\.com)$/, ratePerSec: 2, burst: 5 },
  {
    pattern: /^(registry-1\.docker\.io|auth\.docker\.io|production\.cloudflare\.docker\.com)$/,
    ratePerSec: 2,
    burst: 5,
  },
  { pattern: /^api\.github\.com$/, ratePerSec: 1, burst: 3 },
];

const DEFAULT_RATE_PER_SEC = 5;
const DEFAULT_BURST = 10;

/**
 * Map a full URL to its bucket config (key + rate limits).
 */
export function getBucketForUrl(url: string): BucketConfig {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    hostname = url;
  }

  for (const { pattern, ratePerSec, burst } of HOST_CONFIGS) {
    if (pattern.test(hostname)) {
      return { key: hostname, ratePerSec, burst };
    }
  }

  return { key: hostname, ratePerSec: DEFAULT_RATE_PER_SEC, burst: DEFAULT_BURST };
}
