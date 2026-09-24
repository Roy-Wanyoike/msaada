/**
 * In-memory token-bucket rate limiter for /api/triage.
 *
 * Production-hardening TODO #4 from README. Per-CHV bucket: max N requests
 * per window, refilling continuously. Returns 429 with a Retry-After header
 * when the bucket is empty. Falls back to a global bucket if no actor id
 * (shouldn't happen since /api/triage requires auth, but defensive).
 *
 * NOTE: In-memory — fine for a single-instance demo. Production would use
 * Redis so the limit is shared across instances. The API is intentionally
 * identical so the swap is a one-line change.
 */

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const DEFAULT_CAPACITY = 10; // max 10 triage submissions
const DEFAULT_WINDOW_MS = 60_000; // per 60 seconds
const REFILL_RATE = DEFAULT_CAPACITY / DEFAULT_WINDOW_MS; // tokens per ms

const buckets = new Map<string, Bucket>();

// Prevent unbounded growth — sweep stale buckets every 5 minutes.
const SWEEP_INTERVAL_MS = 5 * 60_000;
const STALE_MS = 10 * 60_000;
let lastSweep = Date.now();

function sweep(now: number) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, b] of buckets) {
    if (now - b.lastRefill > STALE_MS) {
      buckets.delete(key);
    }
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export function checkRateLimit(
  key: string,
  opts: { capacity?: number; windowMs?: number } = {}
): RateLimitResult {
  const capacity = opts.capacity ?? DEFAULT_CAPACITY;
  const windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;
  const refillRate = capacity / windowMs;

  const now = Date.now();
  sweep(now);

  let b = buckets.get(key);
  if (!b) {
    b = { tokens: capacity, lastRefill: now };
    buckets.set(key, b);
  }

  // Refill based on elapsed time.
  const elapsed = now - b.lastRefill;
  b.tokens = Math.min(capacity, b.tokens + elapsed * refillRate);
  b.lastRefill = now;

  if (b.tokens >= 1) {
    b.tokens -= 1;
    return { allowed: true, remaining: Math.floor(b.tokens), retryAfterMs: 0 };
  }

  // Not enough tokens — compute when the next one will be available.
  const needed = 1 - b.tokens;
  const retryAfterMs = Math.ceil((needed / refillRate) / 1000) * 1000;
  return { allowed: false, remaining: 0, retryAfterMs };
}

/** Test helper — reset all buckets. */
export function _resetRateLimit(): void {
  buckets.clear();
}
