// A small in-memory rate limiter (fixed windows), used to slow down sign-in link requests.
//
// It lives in the server's memory: counts are lost on restart and are not shared between several
// server processes. That is enough for one API process; with more than one, move the counters to
// the database or Redis (same `hit()` interface).

export interface RateLimit {
  /** Requests allowed per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly rule: RateLimit,
    private readonly now: () => number = Date.now,
  ) {}

  /** Counts one request for `key`. `ok: false` once the limit is passed, with seconds to wait. */
  hit(key: string): { ok: boolean; retryAfter: number } {
    const t = this.now();
    if (this.hits.size > 10_000) this.prune(t);
    let entry = this.hits.get(key);
    if (!entry || entry.resetAt <= t) {
      entry = { count: 0, resetAt: t + this.rule.windowMs };
      this.hits.set(key, entry);
    }
    entry.count++;
    return { ok: entry.count <= this.rule.limit, retryAfter: Math.max(1, Math.ceil((entry.resetAt - t) / 1000)) };
  }

  private prune(t: number) {
    for (const [k, v] of this.hits) if (v.resetAt <= t) this.hits.delete(k);
  }
}
