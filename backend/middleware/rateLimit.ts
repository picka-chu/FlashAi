export type RateLimitBucket = { count: number; resetAt: number };

export class InMemoryRateLimiter {
  private readonly buckets = new Map<string, RateLimitBucket>();

  constructor(
    private readonly windowMs: number,
    private readonly maxRequests: number,
    cleanupEveryMs = 5 * 60 * 1000,
  ) {
    const timer = setInterval(() => this.cleanup(), cleanupEveryMs);
    // Never keep the process alive solely for cache cleanup.
    timer.unref?.();
  }

  isRateLimited(identifier: string): boolean {
    const now = Date.now();
    const current = this.buckets.get(identifier);

    if (!current || now > current.resetAt) {
      // Bound memory usage if an attacker rotates identifiers/IPs.
      if (!current && this.buckets.size >= 50_000) {
        const oldestKey = this.buckets.keys().next().value;
        if (oldestKey !== undefined) this.buckets.delete(oldestKey);
      }
      this.buckets.set(identifier, { count: 1, resetAt: now + this.windowMs });
      return false;
    }

    current.count += 1;
    this.buckets.set(identifier, current);
    return current.count > this.maxRequests;
  }

  private cleanup() {
    const now = Date.now();
    for (const [key, bucket] of this.buckets.entries()) {
      if (now > bucket.resetAt) this.buckets.delete(key);
    }
  }
}
