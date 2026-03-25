// ─── Token Bucket Rate Limiter ──────────────────────────────────────
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per ms

  constructor(maxCalls: number, windowMs: number) {
    this.maxTokens = maxCalls;
    this.tokens = maxCalls;
    this.lastRefill = Date.now();
    this.refillRate = maxCalls / windowMs;
  }

  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    // Wait until a token is available
    const waitMs = Math.ceil((1 - this.tokens) / this.refillRate);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    this.refill();
    this.tokens -= 1;
  }

  private refill() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }
}

// ─── Cached Fetcher ─────────────────────────────────────────────────
interface CacheEntry<T> {
  data: T;
  expiry: number;
}

export class CachedFetcher {
  private cache = new Map<string, CacheEntry<unknown>>();
  private limiter: RateLimiter;
  private defaultTtlMs: number;

  constructor(limiter: RateLimiter, defaultTtlMs: number) {
    this.limiter = limiter;
    this.defaultTtlMs = defaultTtlMs;
  }

  async fetch<T>(url: string, ttlMs?: number): Promise<T | null> {
    const ttl = ttlMs ?? this.defaultTtlMs;
    const cached = this.cache.get(url);
    if (cached && cached.expiry > Date.now()) {
      return cached.data as T;
    }

    await this.limiter.acquire();
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      this.cache.set(url, { data, expiry: Date.now() + ttl });
      return data as T;
    } catch {
      return null;
    }
  }
}

// ─── Pre-configured limiters ────────────────────────────────────────
export const FINNHUB_LIMITER = new RateLimiter(55, 60_000);       // 60/min with margin
export const FMP_LIMITER = new RateLimiter(240, 86_400_000);      // 250/day with margin
export const AV_LIMITER = new RateLimiter(23, 86_400_000);        // 25/day with margin

// TTL constants
export const TTL = {
  QUOTE: 5 * 60_000,           // 5 minutes
  PRICES: 60 * 60_000,         // 1 hour
  FUNDAMENTALS: 24 * 60 * 60_000, // 24 hours
  TECHNICALS: 24 * 60 * 60_000,   // 24 hours
  ECONOMIC: 24 * 60 * 60_000,     // 24 hours
  NEWS: 15 * 60_000,           // 15 minutes
} as const;
